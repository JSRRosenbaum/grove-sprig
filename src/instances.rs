//! Per-process window leases and isolated frontend state.
use std::fs::{self, File, OpenOptions, TryLockError};
use std::io::{self, ErrorKind};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

#[cfg(unix)]
use std::os::unix::net::UnixStream;
#[cfg(windows)]
use uds_windows::UnixStream;

struct Lease {
    id: u32,
    _file: File,
}

static INSTANCE: OnceLock<Lease> = OnceLock::new();
static ALERT: Mutex<Option<File>> = Mutex::new(None);

fn lock_file(path: &Path) -> io::Result<File> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    OpenOptions::new().read(true).write(true).create(true).open(path)
}

fn startup_guard_at(home: &Path) -> io::Result<File> {
    let file = lock_file(&home.join("instances/startup.lock"))?;
    file.lock()?;
    Ok(file)
}

/// Serialize short startup operations that modify shared configuration.
pub fn startup_guard() -> io::Result<File> {
    startup_guard_at(&crate::mods::app_dir())
}

pub(crate) fn socket_at(home: &Path, id: u32) -> PathBuf {
    if id == 1 { home.join("herdr-app.sock") } else { home.join("views").join(id.to_string()).join("herdr-app.sock") }
}

pub fn socket_for(id: u32) -> PathBuf {
    socket_at(&crate::mods::app_dir(), id)
}

fn state_at(home: &Path, id: u32) -> PathBuf {
    if id == 1 { home.to_path_buf() } else { home.join("views").join(id.to_string()) }
}

pub fn state_dir() -> PathBuf {
    state_at(&crate::mods::app_dir(), id())
}

pub fn id() -> u32 {
    INSTANCE.get().map_or(1, |lease| lease.id)
}

// Copy only regular JSON files, never following symlinks or replacing state
// from a previous attempt. Partial seeding can safely resume after a crash.
fn seed_file(source: &Path, target: &Path) -> io::Result<()> {
    let meta = match fs::symlink_metadata(source) {
        Ok(meta) => meta,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    if !meta.file_type().is_file() { return Ok(()); }
    match fs::symlink_metadata(target) {
        Ok(_) => return Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => {},
        Err(e) => return Err(e),
    }
    // Publish a complete copy without replacing an existing destination. A
    // process killed during the copy leaves only an ignored temporary file.
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let mut name = target.as_os_str().to_os_string();
    name.push(format!(".seed-{}-{}", std::process::id(), NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
    let temporary = PathBuf::from(name);
    let result = (|| {
        let mut src = File::open(source)?;
        let mut dst = OpenOptions::new().write(true).create_new(true).open(&temporary)?;
        io::copy(&mut src, &mut dst)?;
        drop(dst);
        match fs::hard_link(&temporary, target) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == ErrorKind::AlreadyExists => Ok(()),
            Err(e) => Err(e),
        }
    })();
    let _ = fs::remove_file(temporary);
    result
}

fn seed_tree(source: &Path, target: &Path) -> io::Result<()> {
    let meta = match fs::symlink_metadata(source) {
        Ok(meta) => meta,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    if !meta.file_type().is_dir() { return Ok(()); }
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let dest = target.join(entry.file_name());
        if ty.is_dir() {
            seed_tree(&entry.path(), &dest)?;
        } else if ty.is_file() && entry.path().extension().is_some_and(|ext| ext.eq_ignore_ascii_case("json")) {
            fs::create_dir_all(target)?;
            seed_file(&entry.path(), &dest)?;
        }
    }
    Ok(())
}

fn seed(home: &Path, id: u32) -> io::Result<()> {
    let dest = state_at(home, id);
    fs::create_dir_all(&dest)?;
    let marker = dest.join(".seeded");
    if marker.exists() { return Ok(()); }
    for name in ["view.json", "seen.json", "shared.json", "window.json", "windows.json"] {
        seed_file(&home.join(name), &dest.join(name))?;
    }
    seed_tree(&home.join("data"), &dest.join("data"))?;
    let layouts = home.join("layouts");
    match fs::symlink_metadata(&layouts) {
        Ok(meta) if meta.file_type().is_dir() => seed_tree(&layouts.join(".state"), &dest.join("layouts/.state"))?,
        Ok(_) => {},
        Err(e) if e.kind() == ErrorKind::NotFound => {},
        Err(e) => return Err(e),
    }
    OpenOptions::new().write(true).create_new(true).open(marker)?;
    Ok(())
}

fn claim_at(home: &Path) -> io::Result<Lease> {
    let _startup = startup_guard_at(home)?;
    for id in 1..=u32::MAX {
        let file = lock_file(&home.join("instances").join(format!("{id}.lock")))?;
        match file.try_lock() {
            Ok(()) => {},
            Err(TryLockError::WouldBlock) => continue,
            Err(TryLockError::Error(e)) => return Err(e),
        }
        // A pre-multiwindow process does not hold a lease. Never take its slot.
        match UnixStream::connect(socket_at(home, id)) {
            Ok(_) => continue,
            Err(e) if matches!(e.kind(), ErrorKind::NotFound | ErrorKind::ConnectionRefused) => {},
            Err(e) => return Err(io::Error::new(e.kind(), format!("cannot inspect window {id} socket: {e}"))),
        }
        if id != 1 { seed(home, id)?; }
        return Ok(Lease { id, _file: file });
    }
    Err(io::Error::other("no window slots available"))
}

/// Claim once, before starting threads; retain the OS lock for process lifetime.
pub fn claim() -> io::Result<()> {
    if INSTANCE.get().is_some() { return Err(io::Error::other("window slot already claimed")); }
    let lease = claim_at(&crate::mods::app_dir())?;
    INSTANCE.set(lease).map_err(|_| io::Error::other("window slot already claimed"))
}

/// Include the legacy socket and all allocated slot paths, whether live or stale.
pub fn candidate_ids() -> io::Result<Vec<u32>> {
    candidate_ids_at(&crate::mods::app_dir())
}

fn candidate_ids_at(home: &Path) -> io::Result<Vec<u32>> {
    let mut ids = vec![1];
    for dir in [home.join("instances"), home.join("views")] {
        let entries = match fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(e) if e.kind() == ErrorKind::NotFound => continue,
            Err(e) => return Err(e),
        };
        for entry in entries {
            let entry = entry?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            let name = name.strip_suffix(".lock").unwrap_or(name);
            if let Ok(id) = name.parse::<u32>() {
                if id > 1 && name == id.to_string() { ids.push(id); }
            }
        }
    }
    ids.sort_unstable();
    ids.dedup();
    Ok(ids)
}
/// A lease without a reachable socket may be a window still starting up.
pub(crate) fn lease_active_at(home: &Path, id: u32) -> io::Result<bool> {
    let path = home.join("instances").join(format!("{id}.lock"));
    let file = match OpenOptions::new().read(true).write(true).open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e),
    };
    match file.try_lock() {
        Ok(()) => Ok(false),
        Err(TryLockError::WouldBlock) => Ok(true),
        Err(TryLockError::Error(e)) => Err(e),
    }
}


/// One automatic alert leader, with retry on subsequent events after it exits.
pub fn may_alert() -> bool {
    let Ok(mut held) = ALERT.lock() else { return false };
    if held.is_some() { return true; }
    let result = lock_file(&crate::mods::app_dir().join("instances/alerts.lock"))
        .and_then(|file| match file.try_lock() {
            Ok(()) => Ok(Some(file)),
            Err(TryLockError::WouldBlock) => Ok(None),
            Err(TryLockError::Error(e)) => Err(e),
        });
    match result {
        Ok(Some(file)) => { *held = Some(file); true },
        Ok(None) => false,
        Err(e) => { tracing::warn!("cannot acquire alert lease: {e}"); false },
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn home() -> PathBuf {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!("herdr-instance-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn slots_reuse_saved_state_without_overwriting_and_isolate_files() {
        let home = home();
        fs::write(home.join("view.json"), "legacy").unwrap();
        let first = claim_at(&home).unwrap();
        let second = claim_at(&home).unwrap();
        assert_eq!((first.id, second.id), (1, 2));
        assert_eq!(fs::read_to_string(state_at(&home, 2).join("view.json")).unwrap(), "legacy");
        fs::write(state_at(&home, 2).join("view.json"), "second").unwrap();
        drop(second);
        fs::write(home.join("view.json"), "first").unwrap();
        // A released lease only shows as free once the kernel has dropped its
        // lock, which a busy suite can outpace: the claim then walks past the
        // slot and takes a fresh one, while the lock is free a moment later.
        // Retry until the released slot answers; a slot that never answers is
        // the failure this test exists to catch.
        let mut reused = claim_at(&home).unwrap();
        for _ in 0..500 {
            if reused.id == 2 { break; }
            drop(reused);
            std::thread::sleep(std::time::Duration::from_millis(2));
            reused = claim_at(&home).unwrap();
        }
        assert_eq!(reused.id, 2);
        assert_eq!(fs::read_to_string(state_at(&home, 2).join("view.json")).unwrap(), "second");
        assert_eq!(fs::read_to_string(state_at(&home, 1).join("view.json")).unwrap(), "first");
        drop((first, reused));
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn seeding_only_copies_regular_frontend_json() {
        use std::os::unix::fs::symlink;
        let home = home();
        fs::create_dir_all(home.join("data/mod")).unwrap();
        fs::create_dir_all(home.join("layouts/.state")).unwrap();
        fs::write(home.join("data/mod/store.json"), "store").unwrap();
        fs::write(home.join("data/mod/image.png"), "image").unwrap();
        fs::write(home.join("layouts/.state/main.json"), "layout").unwrap();
        fs::write(home.join("settings.json"), "config").unwrap();
        symlink(home.join("settings.json"), home.join("data/mod/link.json")).unwrap();
        seed(&home, 2).unwrap();
        let slot = state_at(&home, 2);
        assert_eq!(fs::read_to_string(slot.join("data/mod/store.json")).unwrap(), "store");
        assert_eq!(fs::read_to_string(slot.join("layouts/.state/main.json")).unwrap(), "layout");
        assert!(!slot.join("data/mod/image.png").exists());
        assert!(!slot.join("data/mod/link.json").exists());
        assert!(!slot.join("settings.json").exists());
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn simultaneous_claims_are_distinct() {
        let home = home();
        let barrier = Arc::new(Barrier::new(9));
        let mut workers = Vec::new();
        for _ in 0..8 {
            let home = home.clone();
            let barrier = barrier.clone();
            workers.push(std::thread::spawn(move || {
                barrier.wait();
                let lease = claim_at(&home).unwrap();
                barrier.wait();
                lease
            }));
        }
        barrier.wait();
        barrier.wait();
        let leases: Vec<_> = workers.into_iter().map(|t| t.join().unwrap()).collect();
        let mut ids: Vec<_> = leases.iter().map(|lease| lease.id).collect();
        ids.sort_unstable();
        assert_eq!(ids, (1..=8).collect::<Vec<_>>());
        drop(leases);
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn live_legacy_socket_reserves_first_slot() {
        let home = home();
        let listener = std::os::unix::net::UnixListener::bind(socket_at(&home, 1)).unwrap();
        let lease = claim_at(&home).unwrap();
        assert_eq!(lease.id, 2);
        drop((lease, listener));
        fs::remove_dir_all(home).unwrap();
    }
}
