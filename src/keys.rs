//! ~/.config/herdr-app/keys.json: string or object actions, reloaded live.
//!
//! ```json
//! {
//!   "global":   { "ctrl-shift-t": "tab.new", "ctrl-1": "tab.select:1" },
//!   "terminal": { "ctrl-left": "send:\u001bb", "ctrl-shift-t": "terminal" },
//!   "layout:terminals": { "ctrl-]": "space.next" },
//!   "mod:editor": { "ctrl-s": "editor.save" }
//! }
//! ```
//!
//! An action is a command (`pane.split:right`: the value fills its first
//! argument), an object (`{"command":"layout.resize","args":{"id":"sidebar","px":240}}`),
//! `send:<text>` (types into the focused terminal),
//! `<mod>.<command>` (delivered to that mod's `nextCommand()`), or `terminal`
//! (the program gets the key: the binding is switched off where this section
//! applies).

use gpui::{App, KeyBinding, KeyBindingContextPredicate, NoAction};
use std::rc::Rc;
use gpui_shell::action::ShellAction;
use std::collections::BTreeMap;
use std::cell::RefCell;
use serde::Deserialize;

/// Legacy profile bindings are plain `key -> action` strings; the active
/// keys.json uses typed bindings, so the two shapes stay separate.
type LegacySections = BTreeMap<String, BTreeMap<String, String>>;

#[derive(Clone, Default, Deserialize)]
struct LegacyProfile {
    #[serde(default)]
    bindings: LegacySections,
    #[serde(default)]
    ui: BTreeMap<String, bool>,
}

#[derive(Default, Deserialize)]
struct LegacyProfiles {
    #[serde(flatten)]
    local: LegacyProfile,
    #[serde(default)]
    remote_default: LegacyProfile,
    #[serde(default)]
    machines: BTreeMap<String, LegacyProfile>,
}

thread_local! {
    static LEGACY: RefCell<Option<LegacyProfiles>> = const { RefCell::new(None) };
}

fn profile<'a>(profiles: &'a LegacyProfiles, machine: Option<&str>) -> Option<&'a LegacyProfile> {
    match machine.filter(|m| !m.is_empty()) {
        None => Some(&profiles.local),
        Some(machine) => Some(profiles.machines.get(machine).unwrap_or(&profiles.remote_default)),
    }
}

/// Stable predicate identifiers contain no user-controlled context syntax.
pub(crate) fn legacy_profile(machine: Option<&str>) -> String {
    LEGACY.with_borrow(|profiles| {
        let Some(machine) = machine.filter(|m| !m.is_empty()) else { return "local".into(); };
        profiles.as_ref().and_then(|profiles| profiles.machines.keys().position(|name| name == machine))
            .map(|index| format!("machine{index}")).unwrap_or_else(|| "remote".into())
    })
}

pub(crate) fn listing_for(machine: Option<&str>, legacy: bool) -> Vec<(String, String, String)> {
    if !legacy { return listing(); }
    LEGACY.with_borrow(|profiles| {
        let Some(profiles) = profiles else {
            return listing().into_iter().filter(|(s, _, _)| matches!(s.as_str(), "layout:rowan-terminal" | "mod:rowan-navigate")).collect();
        };
        profile(profiles, machine).map(|profile| profile.bindings.iter()
            .flat_map(|(section, bindings)| bindings.iter().map(move |(key, action)| (section.clone(), key.clone(), current(action))))
            .collect()).unwrap_or_default()
    })
}

/// The reserved shortcut that restores the default layout and keys.
pub const ESCAPE_HATCH: &str = "ctrl-alt-shift-escape";

/// The shipped keys: prefix-free; plain ctrl+letter always stays with the
/// program. Herdr uses ctrl+shift (defaults/keys.json), or cmd on macOS
/// (defaults/keys.macos.json, with Mac terminal editing keys).
#[cfg(not(target_os = "macos"))]
pub const DEFAULTS: &str = include_str!("../defaults/keys.json");
#[cfg(target_os = "macos")]
pub const DEFAULTS: &str = include_str!("../defaults/keys.macos.json");

// Exact originals from release tags, deduplicated across v0.1.4–v0.1.12.
// Keep these when defaults change: only untouched shipped files may migrate.
#[cfg(any(not(target_os = "macos"), test))]
const SHIPPED_KEYS: &[&str] = &[
    include_str!("keys/shipped/v0.1.4-keys.json"),
    include_str!("keys/shipped/v0.1.5-keys.json"),
    include_str!("keys/shipped/v0.1.12-keys.json"),
];
#[cfg(any(target_os = "macos", test))]
const SHIPPED_MACOS_KEYS: &[&str] = &[
    include_str!("keys/shipped/v0.1.4-keys.macos.json"),
    include_str!("keys/shipped/v0.1.5-keys.macos.json"),
];

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(untagged)]
enum Binding {
    String(String),
    Object(serde_json::Map<String, serde_json::Value>),
}

type Sections = BTreeMap<String, BTreeMap<String, Binding>>;

/// Kept separate from string actions so colon payloads always stay literal.
#[derive(Clone, PartialEq, gpui::Action, serde::Deserialize)]
#[action(no_json)]
pub struct CommandBinding {
    pub value: serde_json::Map<String, serde_json::Value>,
}

impl CommandBinding {
    pub fn command(&self) -> Result<(String, serde_json::Value), String> {
        use serde_json::{Value, json};
        if let Some(key) = self.value.keys().find(|k| !matches!(k.as_str(), "command" | "args")) {
            return Err(format!("unknown key binding field {key:?}; use command and args"));
        }
        let name = self.value.get("command").and_then(Value::as_str)
            .ok_or("key binding command must be a string")?;
        let name = current(name);
        let command = crate::commands::find(&name).ok_or_else(|| format!("unknown key binding command {name:?}"))?;
        let args = self.value.get("args").cloned().unwrap_or_else(|| json!({}));
        if !args.is_object() {
            return Err(format!("{name}: key binding args must be an object"));
        }
        crate::commands::validate_args(command, &args)?;
        Ok((name, args))
    }
}

fn defaults() -> Sections {
    serde_json::from_str(DEFAULTS).expect("defaults/keys.json is valid")
}

/// Every binding as `(section, keys, action)`, for the keybind help.
pub fn listing() -> Vec<(String, String, String)> {
    let text = std::fs::read_to_string(path()).unwrap_or_default();
    let sections: Sections = serde_json::from_str(&text).unwrap_or_else(|_| defaults());
    let mut out = Vec::new();
    for (s, keys) in sections {
        for (k, a) in keys {
            match a {
                Binding::String(a) => {
                    let a = current(&a);
                    if !gone_mod(&a) {
                        out.push((s.clone(), k, a));
                    }
                }
                Binding::Object(a) => out.push((s.clone(), k, serde_json::Value::Object(a).to_string())),
            }
        }
    }
    out.push(("global".into(), ESCAPE_HATCH.into(), "app.reset".into()));
    out
}

pub fn path() -> std::path::PathBuf {
    crate::mods::app_dir().join("keys.json")
}

/// Effective legacy UI option, with the original default if metadata is absent.
pub(crate) fn legacy_ui(machine: Option<&str>, name: &str, default: bool) -> bool {
    LEGACY.with_borrow(|profiles| profiles.as_ref().and_then(|p| profile(p, machine))
        .and_then(|p| p.ui.get(name)).copied().unwrap_or(default))
}

/// The GPUI key tab a section applies in. `global` is the window itself,
/// not "no tab": GPUI ranks a binding without one above every other, so
/// it would beat `layout:` (same depth, added earlier) and only lose to
/// `terminal` and `mod:` by order.
fn tab(section: &str) -> Result<String, String> {
    match section {
        "global" => Ok("Herdr".into()),
        "terminal" => Ok("Terminal".into()),
        s => match (s.strip_prefix("mod:"), s.strip_prefix("layout:")) {
            (Some(p), _) if !p.is_empty() => Ok(format!("mod == {p}")),
            // While layouts/<name>.json is shown (the window's tab says which).
            (_, Some(l)) if !l.is_empty() => Ok(format!("layout == {l}")),
            _ => Err(format!("unknown section {s:?}: use \"global\", \"terminal\", \"layout:<name>\" or \"mod:<name>\"")),
        },
    }
}

/// 0.1.0's words in a keys.json from then (installed once, so still theirs):
/// projects became spaces, contexts tabs, the start popup the new tab.
pub(crate) fn current(action: &str) -> String {
    if action == "mod.open:start" {
        return "tab.new".into();
    }
    let command = |a: &str| crate::commands::find(a.split_once(':').map_or(a, |(n, _)| n)).is_some();
    for (old, new) in [("project.", "space."), ("context.", "tab.")] {
        if let Some(rest) = action.strip_prefix(old) {
            let renamed = format!("{new}{rest}");
            // Only a command that was renamed: a mod named `project` keeps its own.
            if command(&renamed) && !command(action) {
                return renamed;
            }
        }
    }
    action.to_owned()
}

/// A mod's command whose mod is gone (0.1.x's `ribbon.next`): bound to nothing.
fn gone_mod(action: &str) -> bool {
    let name = action.split_once(':').map_or(action, |(n, _)| n);
    crate::commands::find(name).is_none()
        && name.split_once('.').is_some_and(|(m, _)| !m.starts_with("frame-") && !crate::mods::mods_dir().join(m).is_dir())
}

fn valid_action(action: &str) -> bool {
    let name = action.split_once(':').map_or(action, |(n, _)| n);
    crate::commands::find(name).is_some()
        || action == "terminal"
        || action.starts_with("send:")
        || name.split_once('.').is_some_and(|(m, c)| !m.is_empty() && !c.is_empty())
}

/// Reads keys.json, installing or updating untouched defaults, or says what's wrong.
pub fn load() -> Result<Vec<KeyBinding>, String> {
    #[cfg(not(target_os = "macos"))]
    let originals = SHIPPED_KEYS;
    #[cfg(target_os = "macos")]
    let originals = SHIPPED_MACOS_KEYS;
    let text = load_text(&path(), DEFAULTS, originals)?;
    let metadata = crate::mods::app_dir().join("legacy-keys.json");
    if !metadata.exists() {
        let bindings = parse(&text)?;
        LEGACY.with_borrow_mut(|profiles| *profiles = None);
        return Ok(bindings);
    }
    let profiles: LegacyProfiles = serde_json::from_str(&std::fs::read_to_string(metadata).map_err(|e| e.to_string())?)
        .map_err(|e| format!("legacy-keys.json: {e}"))?;
    let mut ordinary: Sections = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    ordinary.remove("layout:rowan-terminal");
    ordinary.remove("mod:rowan-navigate");
    let mut bindings = parse_scoped(&serde_json::to_string(&ordinary).map_err(|e| e.to_string())?, Some("Herdr && !HerdrLegacy"))?;
    for (id, profile) in std::iter::once(("local".to_owned(), &profiles.local))
        .chain(std::iter::once(("remote".to_owned(), &profiles.remote_default)))
        .chain(profiles.machines.values().enumerate().map(|(index, profile)| (format!("machine{index}"), profile))) {
        bindings.extend(parse_legacy_scoped(&profile.bindings, &format!("HerdrLegacy && legacy_profile == {id}"))?);
    }
    LEGACY.with_borrow_mut(|stored| *stored = Some(profiles));
    Ok(bindings)
}

fn load_text(path: &std::path::Path, defaults: &str, originals: &[&str]) -> Result<String, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            std::fs::write(path, defaults).map_err(|e| e.to_string())?;
            return Ok(defaults.to_owned());
        }
        Err(e) => return Err(e.to_string()),
    };
    if text != defaults && originals.contains(&text.as_str()) {
        std::fs::write(path, defaults).map_err(|e| e.to_string())?;
        return Ok(defaults.to_owned());
    }
    Ok(text)
}

pub fn parse(text: &str) -> Result<Vec<KeyBinding>, String> {
    parse_scoped(text, None)
}

fn parse_scoped(text: &str, scope: Option<&str>) -> Result<Vec<KeyBinding>, String> {
    let sections: Sections = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    let mut problems = Vec::new();
    for (section, keys) in &sections {
        let ctx = match tab(section) {
            Ok(c) => scope.map_or(c.clone(), |scope| {
                let relation = if section == "terminal" || section.starts_with("mod:") { ">" } else { "&&" };
                format!("({scope}) {relation} ({c})")
            }),
            Err(e) => {
                problems.push(e);
                continue;
            }
        };
        for (keys, action) in keys {
            let string = match action {
                Binding::String(action) => Some(current(action)),
                Binding::Object(_) => None,
            };
            if let Some(action) = &string {
                if gone_mod(action) {
                    continue;
                }
                if !valid_action(action) {
                    problems.push(format!("{section}.{keys}: unknown action {action:?}"));
                    continue;
                }
            }
            if keys == ESCAPE_HATCH {
                problems.push(format!("{ESCAPE_HATCH} is reserved for resetting Herdr"));
                continue;
            }
            let predicate = match KeyBindingContextPredicate::parse(&ctx) {
                Ok(p) => Some(Rc::new(p)),
                Err(e) => {
                    problems.push(format!("{section}: {e}"));
                    continue;
                }
            };
            let action: Box<dyn gpui::Action> = if let Binding::Object(value) = action {
                Box::new(CommandBinding { value: value.clone() })
            } else if string.as_deref() == Some("terminal") {
                // Off where this section applies; globally, simply not bound.
                if section == "global" {
                    continue;
                }
                Box::new(NoAction)
            } else {
                let action = string.as_ref().expect("string binding");
                #[cfg(target_os = "macos")]
                let native = crate::macos::action(action);
                #[cfg(not(target_os = "macos"))]
                let native: Option<Box<dyn gpui::Action>> = None;
                native.unwrap_or_else(|| Box::new(ShellAction::new(action.clone())))
            };
            let binding = KeyBinding::load(keys, action, predicate, false, None, &gpui::DummyKeyboardMapper);
            match binding {
                Ok(b) => out.push(b),
                Err(e) => problems.push(format!("{section}.{keys}: {e}")),
            }
        }
    }
    if problems.is_empty() { Ok(out) } else { Err(problems.join("; ")) }
}

/// The legacy profile's plain string bindings, scoped to its compiled predicate.
fn parse_legacy_scoped(sections: &LegacySections, scope: &str) -> Result<Vec<KeyBinding>, String> {
    let mut out = Vec::new();
    let mut problems = Vec::new();
    for (section, keys) in sections {
        let base = tab(section)?;
        let relation = if section == "terminal" || section.starts_with("mod:") { ">" } else { "&&" };
        let ctx = format!("({scope}) {relation} ({base})");
        for (keys, action) in keys {
            if gone_mod(action) {
                continue;
            }
            if !valid_action(action) {
                problems.push(format!("{section}.{keys}: unknown action {action:?}"));
                continue;
            }
            let predicate = match KeyBindingContextPredicate::parse(&ctx) {
                Ok(p) => Some(Rc::new(p)),
                Err(e) => {
                    problems.push(format!("{section}: {e}"));
                    continue;
                }
            };
            #[cfg(target_os = "macos")]
            let native = crate::macos::action(action);
            #[cfg(not(target_os = "macos"))]
            let native: Option<Box<dyn gpui::Action>> = None;
            let action: Box<dyn gpui::Action> = if action == "terminal" {
                if section == "global" {
                    continue;
                }
                Box::new(NoAction)
            } else {
                native.unwrap_or_else(|| Box::new(ShellAction::new(action.clone())))
            };
            match KeyBinding::load(keys, action, predicate, false, None, &gpui::DummyKeyboardMapper) {
                Ok(b) => out.push(b),
                Err(e) => problems.push(format!("{section}.{keys}: {e}")),
            }
        }
    }
    if problems.is_empty() { Ok(out) } else { Err(problems.join("; ")) }
}

/// The UI kit's own keys (text editing in inputs, lists): bound at its init,
/// kept across every reload of keys.json.
struct KitKeys(Vec<KeyBinding>);
impl gpui::Global for KitKeys {}

/// Restores kit bindings, installs user bindings, then adds reserved bindings.
pub fn install(bindings: Vec<KeyBinding>, cx: &mut App) {
    if !cx.has_global::<KitKeys>() {
        let kit = cx.key_bindings().borrow().bindings().cloned().collect();
        cx.set_global(KitKeys(kit));
    }
    let kit = cx.global::<KitKeys>().0.clone();
    cx.clear_key_bindings();
    cx.bind_keys(kit);
    cx.bind_keys(bindings);
    cx.bind_keys([
        KeyBinding::new(ESCAPE_HATCH, ShellAction::new("app.reset"), Some("Herdr && !HerdrLegacy")),
        KeyBinding::new("escape", ShellAction::new("overlay.close"), Some("Overlay")),
    ]);
}

/// Keep a configured, currently dispatchable app chord alive only when Escape
/// actually completes it. GPUI remains the source of truth for both the
/// pending sequence and the effective bindings in the focused context.
pub(crate) fn hold_cancelable_prefix<T: 'static>(window: &mut gpui::Window, owner: &gpui::Entity<T>, cx: &mut App) {
    let hold = window.pending_input_keystrokes().is_some_and(|pending| {
        window.possible_bindings_for_input(pending).iter().any(|binding| {
            let strokes = binding.keystrokes();
            strokes.len() == pending.len() + 1
                && strokes.last().is_some_and(|key| key.unparse() == "escape")
                && gpui_shell::action::script_id(binding.action().as_any()).is_some()
        })
    });
    window.set_pending_input_timeout_paused(owner, hold, cx);
}

/// Consume an unknown legacy continuation before GPUI can replay the prefix.
pub(crate) fn consume_unknown_legacy(window: &mut gpui::Window, key: &gpui::Keystroke, cx: &mut App) -> bool {
    let Some(pending) = window.pending_input_keystrokes() else { return false };
    let possible = window.possible_bindings_for_input(pending);
    let legacy = possible.iter().any(|binding|
        gpui_shell::action::script_id(binding.action().as_any()) == Some("legacy.prefix_cancel"));
    let mut candidate = pending.to_vec();
    candidate.push(key.clone());
    if legacy && !possible.iter().any(|binding| binding.match_keystrokes(&candidate).is_some()) {
        window.clear_pending_keystrokes(cx);
        return true;
    }
    false
}

pub(crate) fn pending_keys(window: &gpui::Window) -> Vec<String> {
    window.pending_input_keystrokes().unwrap_or_default().iter().map(gpui::Keystroke::unparse).collect()
}

/// Only advertise continuations that the native focused-context keymap can run.
pub(crate) fn prefix_hints(window: &gpui::Window) -> Vec<(String, &'static str)> {
    let Some(pending) = window.pending_input_keystrokes() else { return Vec::new() };
    let mut cancel = Vec::new();
    let mut help = Vec::new();
    for binding in window.possible_bindings_for_input(pending) {
        let Some(action) = gpui_shell::action::script_id(binding.action().as_any()) else { continue };
        let keys = &binding.keystrokes()[pending.len()..];
        if action == "app.help" {
            help.push(keys.iter().map(|key| key.unparse()).collect::<Vec<_>>().join(" "));
        } else if action.ends_with(".prefix-cancel") && keys.len() == 1 && keys[0].unparse() == "escape" {
            cancel.push("esc".to_owned());
        }
    }
    let mut hints = Vec::new();
    for (mut keys, label) in [(cancel, "cancel"), (help, "keybinds")] {
        keys.sort();
        keys.dedup();
        if !keys.is_empty() { hints.push((keys.join(" / "), label)); }
    }
    hints
}
#[cfg(test)]
mod tests {
    use gpui::{div, Context, FocusHandle, IntoElement, KeyBinding, Render, Subscription, TestAppContext, Window};
    use gpui::prelude::*;
    use gpui_shell::action::ShellAction;

    struct PendingView {
        focus: FocusHandle,
        context: String,
        leaf_context: Option<&'static str>,
        actions: Vec<String>,
        raw: Vec<String>,
        changes: usize,
        _pending: Subscription,
    }

    impl PendingView {
        fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
            let pending = cx.observe_pending_input(window, |view, window, cx| {
                view.changes += 1;
                super::hold_cancelable_prefix(window, &cx.entity(), cx);
                cx.notify();
            });
            Self { focus: cx.focus_handle(), context: "Herdr".into(), leaf_context: None, actions: Vec::new(), raw: Vec::new(), changes: 0, _pending: pending }
        }
    }

    impl Render for PendingView {
        fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            div().key_context(self.context.as_str())
                .when(self.leaf_context.is_none(), |d| d.track_focus(&self.focus))
                .when_some(self.leaf_context, |d, context| d.child(div().key_context(context).track_focus(&self.focus)))
                .on_key_down(cx.listener(|view, event: &gpui::KeyDownEvent, _, _| view.raw.push(event.keystroke.unparse())))
                .on_action(cx.listener(|view, action: &ShellAction, _, _| view.actions.push(action.id().to_owned())))
        }
    }

    #[gpui::test]
    fn pending_chords_follow_gpui_transitions(cx: &mut TestAppContext) {
        cx.update(|cx| cx.bind_keys([
            KeyBinding::new("ctrl-space", ShellAction::new("test.cancel"), Some("Herdr")),
            KeyBinding::new("ctrl-space escape", ShellAction::new("test.cancel"), Some("Herdr")),
            KeyBinding::new("ctrl-space c", ShellAction::new("test.follow"), Some("Herdr")),
            KeyBinding::new("ctrl-x", ShellAction::new("test.short"), Some("Herdr")),
            KeyBinding::new("ctrl-x c", ShellAction::new("test.long"), Some("Herdr")),
        ]));
        let (view, cx) = cx.add_window_view(PendingView::new);
        let focus = view.update(cx, |view, _| view.focus.clone());
        cx.update(|window, cx| {
            window.focus(&focus, cx);
            window.activate_window();
        });
        cx.run_until_parked();

        cx.simulate_keystrokes("ctrl-space");
        cx.run_until_parked();
        cx.update(|window, _| {
            assert_eq!(super::pending_keys(window), ["ctrl-space"]);
            assert!(window.pending_input().unwrap().timeout().unwrap().is_paused());
        });
        cx.executor().advance_clock(std::time::Duration::from_secs(2));
        cx.run_until_parked();
        cx.update(|window, _| assert_eq!(super::pending_keys(window), ["ctrl-space"]));
        view.read_with(cx, |view, _| assert!(view.changes < 10));
        cx.simulate_keystrokes("c");
        cx.run_until_parked();
        cx.update(|window, _| assert!(super::pending_keys(window).is_empty()));
        view.read_with(cx, |view, _| assert_eq!(view.actions, ["test.follow"]));

        cx.simulate_keystrokes("ctrl-space escape");
        cx.run_until_parked();
        cx.update(|window, _| assert!(super::pending_keys(window).is_empty()));
        view.read_with(cx, |view, _| assert_eq!(view.actions, ["test.follow", "test.cancel"]));

        cx.simulate_keystrokes("ctrl-space");
        cx.run_until_parked();
        cx.simulate_keystrokes("z");
        cx.run_until_parked();
        cx.update(|window, _| assert!(super::pending_keys(window).is_empty()));
        view.read_with(cx, |view, _| assert_eq!(view.actions.iter().filter(|a| a.as_str() == "test.follow").count(), 1));

        cx.simulate_keystrokes("ctrl-space");
        cx.run_until_parked();
        cx.update(|window, cx| window.focus(&cx.focus_handle(), cx));
        cx.run_until_parked();
        cx.update(|window, _| assert!(super::pending_keys(window).is_empty()));
        cx.update(|window, cx| window.focus(&focus, cx));
        cx.run_until_parked();

        cx.simulate_keystrokes("ctrl-x");
        cx.run_until_parked();
        cx.update(|window, _| assert!(!window.pending_input().unwrap().timeout().unwrap().is_paused()));
        cx.executor().advance_clock(std::time::Duration::from_secs(2));
        cx.run_until_parked();
        cx.update(|window, _| assert!(super::pending_keys(window).is_empty()));
        view.read_with(cx, |view, _| assert_eq!(view.actions.last().unwrap(), "test.short"));
    }

    #[gpui::test]
    fn legacy_unknown_continuation_is_not_replayed_to_focused_input(cx: &mut TestAppContext) {
        cx.update(|cx| cx.bind_keys([
            KeyBinding::new("ctrl-space escape", ShellAction::new("legacy.prefix_cancel"), Some("Herdr")),
            KeyBinding::new("ctrl-space c", ShellAction::new("test.follow"), Some("Herdr")),
        ]));
        let (view, cx) = cx.add_window_view(PendingView::new);
        let focus = view.update(cx, |view, _| view.focus.clone());
        let interceptor = cx.update(|window, cx| {
            let id = window.window_handle().window_id();
            window.focus(&focus, cx);
            cx.intercept_keystrokes(move |event, window, cx| {
                if window.window_handle().window_id() == id && super::consume_unknown_legacy(window, &event.keystroke, cx) {
                    cx.stop_propagation();
                }
            })
        });
        cx.run_until_parked();
        cx.simulate_keystrokes("ctrl-space z");
        cx.run_until_parked();
        cx.update(|window, _| assert!(super::pending_keys(window).is_empty()));
        view.read_with(cx, |view, _| assert!(view.raw.is_empty()));
        cx.simulate_keystrokes("ctrl-space c");
        cx.run_until_parked();
        view.read_with(cx, |view, _| assert_eq!(view.actions, ["test.follow"]));
        drop(interceptor);
    }

    #[gpui::test]
    fn endpoint_profiles_do_not_steal_another_windows_shortcuts(cx: &mut TestAppContext) {
        let text = |action| serde_json::json!({"layout:rowan-terminal":{"ctrl-alt-up":action}}).to_string();
        let mut bindings = super::parse_scoped(&text("space.prev"), Some("HerdrLegacy && legacy_profile == local")).unwrap();
        bindings.extend(super::parse_scoped(&text("pane.go:up"), Some("HerdrLegacy && legacy_profile == machine0")).unwrap());
        bindings.extend(super::parse_scoped(r#"{"global":{"ctrl-shift-t":"tab.new"}}"#, Some("!HerdrLegacy")).unwrap());
        cx.update(|cx| cx.bind_keys(bindings));
        let (view, cx) = cx.add_window_view(PendingView::new);
        let focus = view.update(cx, |view, _| {
            view.context = "Herdr HerdrLegacy layout = rowan-terminal legacy_profile = local".into();
            view.focus.clone()
        });
        cx.update(|window, cx| window.focus(&focus, cx));
        cx.simulate_keystrokes("ctrl-alt-up ctrl-shift-t");
        view.read_with(cx, |view, _| {
            assert_eq!(view.actions, ["space.prev"]);
            assert_eq!(view.raw, ["ctrl-shift-t"]);
        });
        view.update(cx, |view, cx| {
            view.context = "Herdr HerdrLegacy layout = rowan-terminal legacy_profile = machine0".into();
            cx.notify();
        });
        cx.run_until_parked();
        cx.simulate_keystrokes("ctrl-alt-up");
        view.read_with(cx, |view, _| assert_eq!(view.actions, ["space.prev", "pane.go:up"]));
        view.update(cx, |view, cx| {
            view.context = "Herdr HerdrLegacy layout = rowan-terminal legacy_profile = unknown".into();
            cx.notify();
        });
        cx.run_until_parked();
        cx.simulate_keystrokes("ctrl-alt-up");
        view.read_with(cx, |view, _| assert_eq!(view.actions, ["space.prev", "pane.go:up"]));
    }

    #[gpui::test]
    fn endpoint_mod_bindings_match_the_focused_descendant_only(cx: &mut TestAppContext) {
        let bindings = super::parse_scoped(r#"{"mod:rowan-navigate":{"down":"space.next"}}"#,
            Some("HerdrLegacy && legacy_profile == local")).unwrap();
        cx.update(|cx| cx.bind_keys(bindings));
        let (view, cx) = cx.add_window_view(PendingView::new);
        let focus = view.update(cx, |view, _| {
            view.context = "Herdr HerdrLegacy layout = rowan-terminal legacy_profile = local".into();
            view.leaf_context = Some("Mod mod = rowan-navigate");
            view.focus.clone()
        });
        cx.update(|window, cx| window.focus(&focus, cx));
        cx.simulate_keystrokes("down");
        view.read_with(cx, |view, _| assert_eq!(view.actions, ["space.next"]));
        view.update(cx, |view, cx| {
            view.context = "Herdr HerdrLegacy layout = rowan-terminal legacy_profile = machine0".into();
            cx.notify();
        });
        cx.run_until_parked();
        cx.simulate_keystrokes("down");
        view.read_with(cx, |view, _| assert_eq!(view.actions, ["space.next"]));
    }

    #[test]
    fn only_byte_identical_shipped_keys_are_upgraded() {
        let dir = std::env::temp_dir().join(format!("herdr-keys-migration-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("keys.json");
        for (defaults, originals) in [
            (include_str!("../defaults/keys.json"), super::SHIPPED_KEYS),
            (include_str!("../defaults/keys.macos.json"), super::SHIPPED_MACOS_KEYS),
        ] {
            for original in originals {
                std::fs::write(&path, original).unwrap();
                assert_eq!(super::load_text(&path, defaults, originals).unwrap(), defaults);
                assert_eq!(std::fs::read_to_string(&path).unwrap(), defaults);

                // Even a whitespace-only edit is personal, not an untouched original.
                for edited in [format!("{original}\n"), original.replace("tab.new", "pane.zoom")] {
                    std::fs::write(&path, &edited).unwrap();
                    assert_eq!(super::load_text(&path, defaults, originals).unwrap(), edited);
                    assert_eq!(std::fs::read_to_string(&path).unwrap(), edited);
                }
            }
            std::fs::write(&path, defaults).unwrap();
            assert_eq!(super::load_text(&path, defaults, originals).unwrap(), defaults);
            std::fs::remove_file(&path).unwrap();
            assert_eq!(super::load_text(&path, defaults, originals).unwrap(), defaults);
            assert_eq!(std::fs::read_to_string(&path).unwrap(), defaults);
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn keys_from_0_1_0_mean_the_same_now() {
        assert_eq!(super::current("project.select:2"), "space.select:2");
        assert_eq!(super::current("context.new"), "tab.new");
        assert_eq!(super::current("mod.open:start"), "tab.new");
        assert_eq!(super::current("pane.zoom"), "pane.zoom");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn mac_shifted_punctuation_matches_existing_keys_files() {
        use gpui::{KeybindingKeystroke, Keystroke};
        let bindings = super::parse(include_str!("../defaults/keys.macos.json")).unwrap();
        for (base, shifted) in [("]", "}"), ("[", "{")] {
            let event = Keystroke {
                unshifted_key: Some(base.into()),
                ..Keystroke::parse(&format!("cmd-{shifted}")).unwrap()
            };
            assert!(bindings.iter().any(|binding| binding.match_keystrokes(&[event.clone()]) == Some(false)));
        }
        // Layout-derived aliases, not a US punctuation lookup table.
        for (base, shifted) in [("=", "+"), ("-", "_"), ("ö", "Ö"), ("č", "Č"), ("7", "/")] {
            let event = Keystroke {
                unshifted_key: Some(base.into()),
                ..Keystroke::parse(&format!("cmd-{shifted}")).unwrap()
            };
            for keys in [format!("cmd-shift-{base}"), format!("cmd-{shifted}")] {
                let target = KeybindingKeystroke::from_keystroke(Keystroke::parse(&keys).unwrap());
                assert!(event.should_match(&target), "{keys}");
            }
        }
        assert!(Keystroke::parse("cmd-shift-]").unwrap().unshifted_key.is_none());
        assert!(Keystroke::default().unshifted_key.is_none());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_help_binding_matches_shifted_slash() {
        // Linux reports Ctrl+Shift+/ as Ctrl+? without the Shift modifier.
        let event = gpui::Keystroke::parse("ctrl-?").unwrap();
        let defaults: serde_json::Value = serde_json::from_str(super::DEFAULTS).unwrap();
        let help = defaults["global"].as_object().unwrap().iter()
            .filter(|(_, action)| action.as_str() == Some("app.help"))
            .map(|(keys, action)| (keys.clone(), action.clone()))
            .collect::<serde_json::Map<_, _>>();
        let bindings = super::parse(&serde_json::json!({ "global": help }).to_string()).unwrap();
        assert!(bindings.iter().any(|binding| binding.match_keystrokes(&[event.clone()]) == Some(false)));
    }

    #[test]
    fn object_bindings_pass_named_typed_arguments() {
        use serde_json::json;
        for (name, args) in [
            ("layout.resize", json!({"id":"sidebar", "px":240})),
            ("tab.new", json!({"mod":"editor", "props":{"enabled":true, "items":[1,null,"a:b"]}})),
            ("app.help", json!({})),
        ] {
            let bindings = super::parse(&json!({"global":{"f6":{"command":name,"args":args}}}).to_string()).unwrap();
            assert_eq!(bindings.len(), 1);
            let action = bindings[0].action().as_any().downcast_ref::<super::CommandBinding>().unwrap();
            assert_eq!(action.command().unwrap(), (name.into(), args));
        }
        let bindings = super::parse(r#"{"global":{"f6":{"command":"app.help"}}}"#).unwrap();
        let action = bindings[0].action().as_any().downcast_ref::<super::CommandBinding>().unwrap();
        assert_eq!(action.command().unwrap(), ("app.help".into(), json!({})));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn object_bindings_resolve_native_app_actions_after_validation() {
        use serde_json::json;
        for name in ["app.quit", "app.hide", "app.hide_others", "app.show_all", "app.settings"] {
            let bindings = super::parse(&json!({"global":{"f6":{"command":name}}}).to_string()).unwrap();
            let action = bindings[0].action().as_any().downcast_ref::<super::CommandBinding>().unwrap();
            let (command, args) = action.command().unwrap();
            assert_eq!(args, json!({}));
            let native = crate::macos::action(&command).unwrap();
            let expected = crate::macos::action(name).unwrap();
            assert!(native.partial_eq(expected.as_ref()));
            let bad = super::CommandBinding { value: json!({"command":name,"args":{"typo":true}}).as_object().unwrap().clone() };
            assert!(bad.command().is_err());
        }
    }

    #[test]
    fn bad_object_bindings_stay_bound_for_error_toasts() {
        use serde_json::json;
        for value in [
            json!({}), json!({"command":3}), json!({"command":"unknown"}),
            json!({"command":"space.new:{work}"}),
            json!({"command":"app.help","extra":true}),
            json!({"command":"app.help","args":null}),
            json!({"command":"app.help","args":[]}),
            json!({"command":"app.help","args":"{}"}),
            json!({"command":"layout.resize","args":{"typo":240}}),
            json!({"command":"layout.resize","args":{"id":123,"px":240}}),
        ] {
            let bindings = super::parse(&json!({"terminal":{"f6":value}}).to_string()).unwrap();
            assert_eq!(bindings.len(), 1, "{value}");
            assert_eq!(bindings[0].match_keystrokes(&[gpui::Keystroke::parse("f6").unwrap()]), Some(false));
            let action = bindings[0].action().as_any().downcast_ref::<super::CommandBinding>().unwrap();
            assert!(action.command().is_err(), "{value}");
        }
    }

    #[test]
    fn colon_payloads_stay_literal_including_valid_and_invalid_json() {
        use serde_json::json;
        for value in ["{work}", "{}", "{", "  {bad}", r#"{"name":"work"}"#,
            r#"{"name":"work",}"#, r#"{"name":"work"} trailing"#,
            "hello:world", "", "3", "-1", "true", "null", "[]", "[broken", r#""name""#] {
            let action = format!("space.new:{value}");
            let bindings = super::parse(&json!({"global":{"f6":action}}).to_string()).unwrap();
            let bound = bindings[0].action().as_any().downcast_ref::<gpui_shell::action::ShellAction>().unwrap();
            assert_eq!(bound.id(), action);
            let (name, payload) = bound.id().split_once(':').unwrap();
            assert_eq!(crate::commands::shorthand(crate::commands::find(name).unwrap(), payload), json!({"name":value}));
        }
        assert_eq!(crate::commands::shorthand(crate::commands::find("tab.select").unwrap(), "3"), json!({"index":3}));
    }

    #[test]
    fn shipped_keys_load() {
        for keys in [include_str!("../defaults/keys.json"), include_str!("../defaults/keys.macos.json")] {
            assert_eq!(super::parse(keys).err(), None);
        }
    }
}
