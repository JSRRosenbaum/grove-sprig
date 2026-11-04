//! Resolve a validated exact session id without falling through to heuristic discovery.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use plannotator_tui_hosts::{Host, claude, codex, copilot, droid, omp, opencode, pi};

use super::roots::Roots;

pub(super) enum ExactSession {
    File(PathBuf),
    Codex(Vec<PathBuf>),
    Hermes(PathBuf),
    OpenCode { database: PathBuf, schema: opencode::Schema },
}

pub(super) fn resolve(host: Host, session_id: &str, cwd: &Path, roots: &Roots) -> Result<ExactSession> {
    let id = plannotator_tui_hosts::validate_session_id(session_id)?;
    if std::env::var_os("SPRIG_REVIEW_TERMINAL").is_some() && matches!(host, Host::Pi | Host::Omp) {
        let agent_dir = if host == Host::Omp { omp::DEFAULT_AGENT_DIR } else { ".pi/agent" };
        return verified_pi_session(&roots.pi_sessions(agent_dir), id).map(ExactSession::File);
    }
    match host {
        Host::ClaudeCode => {
            let projects = roots.claude_config.join("projects");
            claude::find_transcript_by_id(&projects, cwd, id)?
                .map(ExactSession::File)
                .with_context(|| format!("no Claude Code session {id} in {}", projects.display()))
        }
        Host::Codex => {
            let files = codex::find_transcripts_by_id(&roots.codex_home, id)?;
            if files.is_empty() {
                bail!("no Codex session {id} in {}", roots.codex_home.join("sessions").display());
            }
            Ok(ExactSession::Codex(files))
        }
        Host::Copilot => {
            let root = roots.copilot_home.join("session-state");
            copilot::find_session_by_id(&roots.copilot_home, id)?
                .map(ExactSession::File)
                .with_context(|| format!("no Copilot CLI session {id} in {}", root.display()))
        }
        Host::Droid => {
            let root = roots.factory_config.join("sessions");
            droid::find_transcript_by_id(&roots.factory_config, cwd, id)?
                .map(ExactSession::File)
                .with_context(|| format!("no Droid session {id} in {}", root.display()))
        }
        Host::Pi => {
            let root = roots.pi_sessions(".pi/agent");
            pi::find_transcript_by_id(&root, cwd, id)?
                .map(ExactSession::File)
                .with_context(|| format!("no pi session {id} in {}", root.display()))
        }
        Host::Omp => {
            let root = roots.pi_sessions(omp::DEFAULT_AGENT_DIR);
            omp::find_transcript_by_id(&root, cwd, &roots.home, &std::env::temp_dir(), id)?
                .map(ExactSession::File)
                .with_context(|| format!("no omp session {id} in {}", root.display()))
        }
        Host::Hermes => Ok(ExactSession::Hermes(roots.hermes_database())),
        Host::OpenCode => {
            let databases = roots.opencode_databases();
            let found = databases
                .iter()
                .find_map(|database| {
                    opencode::schema_of(database, id).ok().map(|schema| (database.clone(), schema))
                })
                .with_context(|| format!("no OpenCode session {id} in {}", describe(&databases)))?;
            Ok(ExactSession::OpenCode { database: found.0, schema: found.1 })
        }
    }
}

/// Session filenames alone are not identity: verify the journal header and
/// reject duplicates instead of picking whichever copy happens to sort first.
fn verified_pi_session(root: &Path, id: &str) -> Result<PathBuf> {
    use std::io::BufRead as _;

    fn collect(dir: &Path, id: &str, matches: &mut Vec<PathBuf>) -> Result<()> {
        let entries = match std::fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(err) => return Err(err).with_context(|| format!("reading {}", dir.display())),
        };
        let suffix = format!("_{id}.jsonl");
        for entry in entries {
            let entry = entry.with_context(|| format!("reading {}", dir.display()))?;
            let kind = entry.file_type().with_context(|| format!("reading {}", entry.path().display()))?;
            if kind.is_dir() {
                collect(&entry.path(), id, matches)?;
            } else if kind.is_file() && entry.file_name().to_string_lossy().ends_with(&suffix) {
                matches.push(entry.path());
            }
        }
        Ok(())
    }

    let mut matches = Vec::new();
    collect(root, id, &mut matches)?;
    if matches.len() != 1 {
        bail!("expected one session {id} in {}, found {}", root.display(), matches.len());
    }
    let path = matches.remove(0);
    let file = std::fs::File::open(&path).with_context(|| format!("reading {}", path.display()))?;
    let mut header = String::new();
    std::io::BufReader::new(file).read_line(&mut header).with_context(|| format!("reading {}", path.display()))?;
    let header: serde_json::Value = serde_json::from_str(&header)
        .with_context(|| format!("invalid session header in {}", path.display()))?;
    if header.get("type").and_then(serde_json::Value::as_str) != Some("session")
        || header.get("id").and_then(serde_json::Value::as_str) != Some(id)
    {
        bail!("session header does not match {id} in {}", path.display());
    }
    Ok(path)
}

pub(super) fn describe(paths: &[PathBuf]) -> String {
    paths.iter().map(|path| path.display().to_string()).collect::<Vec<_>>().join(", ")
}

#[cfg(test)]
mod sprig_tests {
    use super::verified_pi_session;

    #[test]
    fn exact_session_requires_one_matching_header() {
        let root = std::env::temp_dir().join(format!(
            "sprig-review-session-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(root.join("nested")).unwrap();
        let path = root.join("nested/2026_session-1.jsonl");
        std::fs::write(&path, "{\"type\":\"session\",\"id\":\"wrong\"}\n").unwrap();
        assert!(verified_pi_session(&root, "session-1").is_err());
        std::fs::write(&path, "{\"type\":\"session\",\"id\":\"session-1\"}\n").unwrap();
        assert_eq!(verified_pi_session(&root, "session-1").unwrap(), path);
        std::fs::write(root.join("other_session-1.jsonl"), "{\"type\":\"session\",\"id\":\"session-1\"}\n").unwrap();
        assert!(verified_pi_session(&root, "session-1").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
