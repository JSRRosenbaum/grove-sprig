//! Native implementation of Herdr Annotate Lite.

pub mod archive_workflow;
pub mod clipboard;
pub mod edit_keys;
pub mod editor;
pub mod format;
pub mod layout;
pub mod manager;
pub mod manager_copy;
pub mod pane_clipboard;
pub mod paths;
pub mod store;
pub mod types;
pub mod width;

mod termination;

/// Dispatch only the UI entrypoints launched by Sprig.
pub fn run(args: &[String]) -> Result<(), String> {
    match args.first().map(String::as_str) {
        Some("editor") if args.len() == 1 => editor::run(),
        Some("manager") if args.len() == 1 => manager::run(),
        Some("--version" | "-V") if args.len() == 1 => {
            println!("herdr-annotate {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        _ => Err("Usage: herdr-annotate <editor|manager>".to_owned()),
    }
}
