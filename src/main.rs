// Windows: a window app, no console of its own (see `attach_console`).
#![cfg_attr(windows, windows_subsystem = "windows")]

mod bench;
mod commands;
mod control;
mod core_bin;
mod files;
mod hc;
mod instances;
mod keys;
mod layout;
mod layout_sync;
mod links;
mod model;
mod mirror;
mod mirror_sync;
mod place;
mod persist;
#[cfg(target_os = "macos")]
mod macos;
mod mods;
mod mod_files;
mod process_cwd;
mod programs;
mod remote_shell;
mod settings;
mod setup;
mod sound;
mod spawn;
mod sprites;
mod telemetry;
mod feedback;
mod terminal;
mod update;
mod update_notes;
mod vt;
mod win32_keys;
mod window;

use gpui::*;

const HELP: &str = "\
herdr-app: the Herdr desktop app. With no arguments it opens another window.

Usage:
  herdr-app                        open another window
  herdr-app windows                list live windows and their status
  herdr-app [--window N] ls        spaces, tabs and terminals in a window
  herdr-app [--window N] do <command> [args]  run a command with named or JSON arguments
  herdr-app [--window N] feedback <text>  draft feedback for review
  herdr-app commands               every command, its arguments, what it does
  herdr-app [--window N] status    what the window shows, and any errors
  herdr-app [--window N] shot [file.png]  save the last window frame
  herdr-app check <mod folder>     load a mod once and report what's wrong
  herdr-app --skill                Agent Skill: driving the window, and where hc fits
  herdr-app --version

The terminals run in herdr-core (`hc`), which keeps them alive when the
window closes. `hc --help`: start, read, wait on and talk to terminals and
agents. The app shows them and arranges them in spaces and tabs.
With multiple windows, commands without --window select the uniquely active
window; otherwise specify --window N. See `herdr-app windows` for IDs.


Home: ~/.config/herdr-app (HERDR_APP_HOME picks another).
";

/// A Windows window app has no console: answers to `herdr-app ls` and the
/// like go to the terminal it was started from. Output already piped (agents,
/// scripts) keeps its pipes.
#[cfg(windows)]
fn attach_console() {
    use windows_sys::Win32::System::Console::{ATTACH_PARENT_PROCESS, AttachConsole, GetStdHandle, STD_OUTPUT_HANDLE};
    // Attaching would point the output at the console instead of the pipe or file.
    let out = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) };
    if out.is_null() || out == windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE {
        unsafe { AttachConsole(ATTACH_PARENT_PROCESS) };
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    #[cfg(windows)]
    if args.len() > 1 {
        attach_console();
    }
    // `herdr-app check <mod>` / `herdr-app types <mod>`: gpui-shell's own checker, with Herdr's module installed.
    if matches!(args.get(1).map(String::as_str), Some("check" | "types")) {
        mods::install_policy();
        gpui_shell::host::main_with_components(gpui_shell::FrozenComponentRegistry::default());
        return;
    }
    if args.get(1).is_some_and(|arg| arg == "--window") {
        let id = args.get(2).and_then(|s| s.parse::<u32>().ok()).filter(|id| *id > 0);
        let Some(id) = id else {
            eprintln!("herdr-app: --window needs a positive numeric window ID");
            std::process::exit(2);
        };
        std::process::exit(control::client(&args[3..], Some(id)));
    }
    if matches!(args.get(1).map(String::as_str), Some("do" | "status" | "ls" | "commands" | "feedback" | "shot" | "windows")) {
        std::process::exit(control::client(&args[1..], None));
    }
    // Anything else from a shell answers in the shell; only a bare launch opens the window.
    match args.get(1).map(String::as_str) {
        None => {}
        Some("-h" | "--help" | "help") => return print!("{HELP}"),
        Some("--skill") => return print!("{}", include_str!("SKILL.md")),
        Some("-V" | "--version" | "version") => return println!("herdr-app {}", env!("CARGO_PKG_VERSION")),
        Some(other) => {
            eprint!("herdr-app: unknown argument {other:?}\n\n{HELP}");
            std::process::exit(2);
        }
    }

    #[cfg(target_os = "macos")]
    core_bin::fill_path();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("HERDR_APP_LOG")
                .unwrap_or_else(|_| "warn,herdr_app=info,gpui_shell=info".into()),
        )
        .init();

    if update::apply_on_startup() {
        return;
    }
    if let Err(e) = instances::claim() {
        eprintln!("herdr-app: cannot claim a window slot: {e}");
        std::process::exit(1);
    }


    telemetry::clock();
    // First-start settings are shared, so creation must be serialized too.
    let (fresh, person) = {
        let _guard = instances::startup_guard().unwrap_or_else(|e| {
            eprintln!("herdr-app: cannot lock startup configuration: {e}");
            std::process::exit(1);
        });
        let fresh = !settings::path().exists();
        (fresh, settings::load_person())
    };
    let configured = person.as_ref().ok().and_then(|p| p.core.clone());
    let core: Result<std::sync::Arc<hc::Core>, setup::Need> = match core_bin::find(configured.as_deref()) {
        None => Err(setup::Need::Install),
        Some(bin) => {
            core_bin::use_core(bin);
            match hc::Core::connect() {
                // One that can't serve this app gets the screen that fixes it.
                Ok(core) => hc::check(&core.hello).map(|()| core).map_err(setup::Need::Fix),
                Err(e) => {
                    eprintln!("herdr-app: {e:#}");
                    Err(setup::Need::Install)
                }
            }
        }
    };
    #[cfg(target_os = "macos")]
    core_bin::install_cli_link();
    if core.is_ok() {
        update::after_update();
    }
    update::start();
    telemetry::start(settings::telemetry_setting(&person));
    bench::start();
    {
        let _guard = instances::startup_guard().unwrap_or_else(|e| {
            eprintln!("herdr-app: cannot lock startup configuration: {e}");
            std::process::exit(1);
        });
        if let Err(e) = mods::write_workspace() {
            eprintln!("herdr-app: cannot write {}: {e}", mods::app_dir().display());
        }
    }

    gpui_platform::application()
        .with_assets(gpui_shell::AppAssets::new(mods::app_dir()))
        .run(move |cx| {
            let fonts = settings::BUNDLED_FONTS.iter().map(|f| std::borrow::Cow::Borrowed(*f)).collect();
            if let Err(e) = cx.text_system().add_fonts(fonts) {
                tracing::warn!("bundled fonts not loaded: {e:#}");
            }
            settings::note_fonts(cx.text_system().all_font_names());
            settings::load_home_fonts(cx);
            mods::init(cx);
            // Not restarted for it: the update goes in when the app quits.
            cx.on_app_quit(|cx| {
                let deadline = std::time::Instant::now() + std::time::Duration::from_millis(250);
                // Where the window was, for the next start (a quit never asks the window).
                for w in cx.windows() {
                    if let Some(w) = w.downcast::<window::AppWindow>() {
                        let _ = w.update(cx, |this, window, cx| {
                            this.drain_documents(window, cx);
                            this.close_mods_now(deadline, window, cx);
                            place::save(window, cx);
                        });
                    }
                }
                mods::finish_shared();
                telemetry::quit();
                update::apply();
                async {}
            })
            .detach();
            #[cfg(target_os = "macos")]
            macos::init(cx);
            if fresh {
                let width = cx.primary_display().map(|d| f32::from(d.bounds().size.width));
                let zoom = settings::first_zoom(width);
                if zoom != 1.0 {
                    match instances::startup_guard() {
                        Ok(_guard) => {
                            if let Ok(mut person) = settings::load_person() {
                                if person.zoom == 1.0 {
                                    person.zoom = zoom;
                                    if let Err(e) = settings::write_person(&person) {
                                        eprintln!("herdr-app: cannot write first-start zoom: {e}");
                                    }
                                }
                            }
                        },
                        Err(e) => eprintln!("herdr-app: cannot lock first-start zoom: {e}"),
                    }
                }
            }
            let requests = mods::install_policy();
            if let Some(tx) = mods::request_sender() {
                if let Err(e) = control::listen(tx) {
                    eprintln!("herdr-app: cannot serve window {} control socket: {e}", instances::id());
                    std::process::exit(1);
                }
            }
            match core {
                Ok(core) => open_main(core, requests, cx),
                Err(need) => setup::open(need, requests, cx),
            }
        });
}

/// The main window, on a connected core.
pub fn open_main(core: std::sync::Arc<hc::Core>, requests: async_channel::Receiver<mods::Request>, cx: &mut App) {
            let (window_bounds, display_id) = place::initial(cx);
            let options = WindowOptions {
                window_bounds: Some(window_bounds),
                display_id,
                // macOS: always see-through, so a layout can draw its own title bar
                // live; the app drags the window (window/titlebar.rs).
                titlebar: Some(TitlebarOptions {
                    title: Some("Herdr".into()),
                    // Windows: hidden for good (it can't change live); the app draws it.
                    appears_transparent: cfg!(any(target_os = "macos", windows)),
                    traffic_light_position: cfg!(target_os = "macos").then(|| point(px(12.0), px(7.0))),
                }),
                app_owns_titlebar_drag: cfg!(target_os = "macos"),
                // Herdr Dev and other side-by-side builds get their own dock icon.
                app_id: Some(std::env::var("HERDR_APP_ID").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "herdr-app".into())),
                ..Default::default()
            };
            cx.open_window(options, |window, cx| cx.new(|cx| window::AppWindow::new(core, requests, window, cx)))
                .expect("cannot open the Herdr window");
            cx.activate(true);
}
