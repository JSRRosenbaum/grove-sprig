//! Shell control of independently leased Herdr windows, one JSON line each way.

use crate::mods::Request;
use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
#[cfg(unix)]
use std::os::unix::net::{UnixListener, UnixStream};
#[cfg(windows)]
use uds_windows::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::time::Duration;

/// Serve only the socket belonging to our held slot lease.
pub fn listen(tx: async_channel::Sender<Request>) -> std::io::Result<()> {
    let path = crate::instances::socket_for(crate::instances::id());
    match UnixStream::connect(&path) {
        Ok(_) => return Err(std::io::Error::new(std::io::ErrorKind::AddrInUse, format!("window socket {} is already live", path.display()))),
        Err(e) if matches!(e.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused) => {},
        Err(e) => return Err(e),
    }
    match std::fs::symlink_metadata(&path) {
        Ok(meta) => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::FileTypeExt;
                if !meta.file_type().is_socket() {
                    return Err(std::io::Error::new(std::io::ErrorKind::AlreadyExists, format!("refusing to remove non-socket {}", path.display())));
                }
            }
            std::fs::remove_file(&path)?;
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {},
        Err(e) => return Err(e),
    }
    let listener = UnixListener::bind(&path)?;
    std::thread::Builder::new().name("herdr-app-control".into()).spawn(move || {
        for stream in listener.incoming().flatten() {
            let tx = tx.clone();
            std::thread::spawn(move || serve(stream, tx));
        }
    })?;
    Ok(())
}

fn serve(stream: UnixStream, tx: async_channel::Sender<Request>) {
    let mut line = String::new();
    if BufReader::new(&stream).read_line(&mut line).is_err() {
        return;
    }
    let reply = match serde_json::from_str::<Value>(&line) {
        Ok(cmd) => {
            let timeout = Duration::from_secs(if cmd.get("shot").is_some() { 30 } else { 5 });
            let (reply_tx, reply_rx) = std::sync::mpsc::channel();
            let _ = tx.send_blocking(Request::Control { cmd, reply: reply_tx });
            reply_rx.recv_timeout(timeout).unwrap_or_else(|_| json!({ "error": "the window did not answer" }))
        }
        Err(e) => json!({ "error": format!("bad request: {e}") }),
    };
    let _ = (&stream).write_all(format!("{reply}\n").as_bytes());
}

fn request(mut stream: UnixStream, cmd: &Value, timeout: Duration) -> Result<Value, String> {
    stream.set_read_timeout(Some(timeout)).map_err(|e| e.to_string())?;
    stream.write_all(format!("{cmd}\n").as_bytes()).map_err(|e| e.to_string())?;
    let mut line = String::new();
    BufReader::new(&stream).read_line(&mut line).map_err(|e| e.to_string())?;
    serde_json::from_str(&line).map_err(|e| format!("invalid window reply: {e}"))
}

fn connect(id: u32) -> Result<Option<UnixStream>, String> {
    connect_at(&crate::mods::app_dir(), id)
}

fn connect_at(home: &std::path::Path, id: u32) -> Result<Option<UnixStream>, String> {
    let path = crate::instances::socket_at(home, id);
    match UnixStream::connect(&path) {
        Ok(stream) => Ok(Some(stream)),
        Err(e) if matches!(e.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused) => {
            if crate::instances::lease_active_at(home, id).map_err(|e| format!("cannot inspect window {id} lease: {e}"))? {
                Err(format!("window {id} is starting or not accepting control requests"))
            } else {
                Ok(None)
            }
        },
        Err(e) => Err(format!("cannot connect to window {id} at {}: {e}", path.display())),
    }
}

fn windows() -> Result<Vec<Value>, String> {
    let ids = crate::instances::candidate_ids().map_err(|e| format!("cannot list windows: {e}"))?;
    let mut result = Vec::new();
    for id in ids {
        let Some(stream) = connect(id)? else { continue };
        let mut status = request(stream, &json!({ "status": true }), Duration::from_secs(7))
            .map_err(|e| format!("window {id} did not answer status: {e}"))?;
        if let Some(error) = status.get("error") {
            return Err(format!("window {id} status failed: {error}"));
        }
        let obj = status.as_object_mut().ok_or_else(|| format!("window {id} returned invalid status"))?;
        obj.insert("window_id".into(), json!(id));
        obj.entry("pid").or_insert(Value::Null);
        obj.entry("active").or_insert(Value::Null);
        result.push(status);
    }
    Ok(result)
}

// Unknown activity is not evidence that a different window is uniquely active.
fn choose_window(statuses: &[Value], explicit: Option<u32>) -> Result<Option<usize>, String> {
    if let Some(id) = explicit {
        return statuses.iter().position(|s| s["window_id"].as_u64() == Some(id as u64))
            .map(Some).ok_or_else(|| format!("no live window {id}"));
    }
    match statuses {
        [] => Ok(None),
        [_] => Ok(Some(0)),
        _ => {
            let active: Vec<_> = statuses.iter().enumerate().filter(|(_, s)| s["active"] == true).map(|(i, _)| i).collect();
            if active.len() == 1 && statuses.iter().all(|s| s["active"].is_boolean()) {
                Ok(Some(active[0]))
            } else {
                Err("multiple windows and no uniquely active window; specify --window N".into())
            }
        },
    }
}

/// The client side; returns the process exit code.
pub fn client(args: &[String], target: Option<u32>) -> i32 {
    if args == ["commands"] {
        if target.is_some() { return fail("--window cannot be used with commands"); }
        println!("{}", serde_json::to_string_pretty(&crate::commands::listing()).unwrap());
        return 0;
    }
    if args == ["windows"] {
        let statuses = match windows() { Ok(s) => s, Err(e) => return fail(&e) };
        let statuses = if target.is_some() {
            match choose_window(&statuses, target) {
                Ok(Some(index)) => vec![statuses[index].clone()],
                Ok(None) => Vec::new(),
                Err(e) => return fail(&e),
            }
        } else { statuses };
        println!("{}", serde_json::to_string_pretty(&statuses).unwrap());
        return 0;
    }
    let cmd = match args {
        [verb, rest @ ..] if verb == "shot" && rest.len() <= 1 => {
            let path = PathBuf::from(rest.first().map(String::as_str).unwrap_or("herdr-shot.png"));
            let path = match std::path::absolute(path) {
                Ok(path) => path,
                Err(e) => return fail(&format!("cannot resolve screenshot path: {e}")),
            };
            if path.extension().is_none_or(|ext| !ext.eq_ignore_ascii_case("png")) {
                return fail("screenshot path must end in .png");
            }
            json!({ "shot": path })
        },
        [verb] if verb == "status" => json!({ "status": true }),
        [verb] if verb == "ls" => json!({ "ls": true }),
        [verb, message] if verb == "feedback" => json!({ "do": "app.feedback", "args": { "message": message, "from": "agent" } }),
        [verb, command, rest @ ..] if verb == "do" => match parse_args(rest) {
            Ok(a) => json!({ "do": command, "args": a }),
            Err(e) => return fail(&e),
        },
        _ => return fail("usage: herdr-app ls | herdr-app commands | herdr-app status | herdr-app shot [file.png] | herdr-app do <command> [--arg value ... | json]"),
    };
    let mut cached_status = None;
    let id = if let Some(id) = target {
        id
    } else {
        let statuses = match windows() { Ok(s) => s, Err(e) => return fail(&e) };
        let index = match choose_window(&statuses, None) {
            Ok(Some(index)) => index,
            Ok(None) if args.first().is_some_and(|v| v == "feedback") => {
                let body = crate::feedback::draft(&args[1], "", 0, "agent", "other");
                println!("{}", serde_json::to_string_pretty(&body).unwrap_or_default());
                eprintln!("Herdr must be open to review and send this feedback. Nothing was sent; core version and layout will reflect the open window.");
                return 1;
            },
            Ok(None) => return fail("no Herdr windows are open"),
            Err(e) => return fail(&e),
        };
        let id = statuses[index]["window_id"].as_u64().unwrap() as u32;
        if args == ["status"] { cached_status = Some(statuses[index].clone()); }
        id
    };
    let mut reply = if let Some(status) = cached_status {
        status
    } else {
        let stream = match connect(id) {
            Ok(Some(stream)) => stream,
            Ok(None) => return fail(&format!("no live window {id}")),
            Err(e) => return fail(&e),
        };
        match request(stream, &cmd, Duration::from_secs(35)) {
            Ok(reply) => reply,
            Err(e) => return fail(&format!("window {id} did not answer: {e}")),
        }
    };
    if args == ["status"] {
        if let Some(obj) = reply.as_object_mut() {
            obj.insert("window_id".into(), json!(id));
            obj.entry("pid").or_insert(Value::Null);
            obj.entry("active").or_insert(Value::Null);
        }
    }
    if args.first().is_some_and(|v| v == "shot") {
        if let Some(error) = reply.get("error") {
            return fail(error.as_str().unwrap_or("screenshot failed"));
        }
        let Some(path) = reply.get("path").and_then(Value::as_str) else {
            return fail("the window returned no screenshot path");
        };
        println!("{path}");
    } else {
        println!("{}", serde_json::to_string_pretty(&reply).unwrap_or_default());
    }
    if reply.get("error").is_some() { 1 } else { 0 }
}

/// `--name api --argv '["pi"]'` (values that parse as JSON are JSON), or one JSON object.
fn parse_args(rest: &[String]) -> Result<Value, String> {
    match rest {
        [] => Ok(Value::Null),
        [raw] if raw.trim_start().starts_with('{') => serde_json::from_str(raw).map_err(|e| format!("args are not JSON: {e}")),
        _ => {
            let mut out = serde_json::Map::new();
            let mut it = rest.iter();
            while let Some(flag) = it.next() {
                let key = flag.strip_prefix("--").ok_or_else(|| format!("expected --<arg>, got {flag:?}"))?;
                let value = it.next().ok_or_else(|| format!("--{key} needs a value"))?;
                let v = serde_json::from_str::<Value>(value).ok().filter(|v| !v.is_string()).unwrap_or_else(|| Value::String(value.clone()));
                out.insert(key.to_owned(), v);
            }
            Ok(Value::Object(out))
        }
    }
}

/// Encode before opening the destination: GPU errors must not truncate a good shot.
pub fn save_shot(window: &gpui::Window, path: &std::path::Path) -> anyhow::Result<()> {
    let image = window.render_to_image()?;
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, image.width(), image.height());
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_source_srgb(png::SrgbRenderingIntent::Perceptual);
        encoder.write_header()?.write_image_data(image.as_raw())?;
    }
    // A sibling temporary file keeps publication on the same filesystem.
    let temporary = path.with_file_name(format!(".herdr-shot-{}.png", std::process::id()));
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&temporary)?;
    let result = (|| -> anyhow::Result<()> {
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

fn fail(message: &str) -> i32 {
    eprintln!("herdr-app: {message}");
    2
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn explicit_target_never_falls_back() {
        let statuses = vec![
            json!({"window_id": 1, "active": true}),
            json!({"window_id": 2, "active": false}),
        ];
        assert_eq!(choose_window(&statuses, Some(2)).unwrap(), Some(1));
        assert!(choose_window(&statuses, Some(3)).unwrap_err().contains("no live window 3"));
        assert!(choose_window(&[], Some(1)).is_err());
    }

    #[test]
    fn explicit_connection_uses_only_the_named_socket() {
        let home = std::env::temp_dir().join(format!("herdr-control-target-{}", std::process::id()));
        std::fs::create_dir_all(home.join("views/2")).unwrap();
        let first = UnixListener::bind(crate::instances::socket_at(&home, 1)).unwrap();
        let second = UnixListener::bind(crate::instances::socket_at(&home, 2)).unwrap();
        first.set_nonblocking(true).unwrap();
        let stream = connect_at(&home, 2).unwrap().unwrap();
        let (_received, _) = second.accept().unwrap();
        assert_eq!(first.accept().unwrap_err().kind(), std::io::ErrorKind::WouldBlock);
        assert!(connect_at(&home, 3).unwrap().is_none());
        assert_eq!(first.accept().unwrap_err().kind(), std::io::ErrorKind::WouldBlock);
        drop((stream, first, second));
        std::fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn default_requires_unique_known_active_window() {
        assert_eq!(choose_window(&[], None).unwrap(), None);
        assert_eq!(choose_window(&[json!({"window_id": 1, "active": false})], None).unwrap(), Some(0));
        let mut statuses = vec![json!({"window_id": 1, "active": true}), json!({"window_id": 2, "active": false})];
        assert_eq!(choose_window(&statuses, None).unwrap(), Some(0));
        statuses[1]["active"] = json!(true);
        assert!(choose_window(&statuses, None).is_err());
        statuses[0]["active"] = json!(false);
        statuses[1]["active"] = json!(false);
        assert!(choose_window(&statuses, None).is_err());
        statuses[0]["active"] = json!(true);
        statuses[1]["active"] = Value::Null;
        assert!(choose_window(&statuses, None).is_err());
    }
}
