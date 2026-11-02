//! Plugin and persisted-store paths.

use std::path::{Path, PathBuf};


/// Return Herdr's plugin-owned state directory when the runtime supplied one.
pub fn state_dir() -> Option<PathBuf> {
    std::env::var_os("HERDR_PLUGIN_STATE_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}


/// Resolve the JSONL store inside a plugin state directory.
pub fn annotations_path(dir: &Path) -> PathBuf {
    dir.join("annotations.jsonl")
}

/// Resolve the archived-set JSONL store inside a plugin state directory.
pub fn archives_path(dir: &Path) -> PathBuf {
    dir.join("archives.jsonl")
}

