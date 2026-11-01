//! ~/.config/herdr-app/keys.json: every key is a string action, reloaded live.
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
//! argument), `send:<text>` (types into the focused terminal),
//! `<mod>.<command>` (delivered to that mod's `nextCommand()`), or `terminal`
//! (the program gets the key: the binding is switched off where this section
//! applies).

use gpui::{App, KeyBinding, KeyBindingContextPredicate, NoAction};
use std::rc::Rc;
use gpui_shell::action::ShellAction;
use std::collections::BTreeMap;

/// The reserved shortcut that restores the default layout and keys.
pub const ESCAPE_HATCH: &str = "ctrl-alt-shift-escape";

/// The shipped keys: prefix-free; plain ctrl+letter always stays with the
/// program. Herdr uses ctrl+shift (defaults/keys.json), or cmd on macOS
/// (defaults/keys.macos.json, with Mac terminal editing keys).
#[cfg(not(target_os = "macos"))]
pub const DEFAULTS: &str = include_str!("../defaults/keys.json");
#[cfg(target_os = "macos")]
pub const DEFAULTS: &str = include_str!("../defaults/keys.macos.json");

fn defaults() -> BTreeMap<String, BTreeMap<String, String>> {
    serde_json::from_str(DEFAULTS).expect("defaults/keys.json is valid")
}

/// Every binding as `(section, keys, action)`, for the keybind help.
pub fn listing() -> Vec<(String, String, String)> {
    let text = std::fs::read_to_string(path()).unwrap_or_default();
    let sections: BTreeMap<String, BTreeMap<String, String>> = serde_json::from_str(&text).unwrap_or_else(|_| defaults());
    let mut out = Vec::new();
    for (s, keys) in sections {
        for (k, a) in keys {
            let a = current(&a);
            if !gone_mod(&a) {
                out.push((s.clone(), k, a));
            }
        }
    }
    out.push(("global".into(), ESCAPE_HATCH.into(), "app.reset".into()));
    out
}

pub fn path() -> std::path::PathBuf {
    crate::mods::app_dir().join("keys.json")
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

/// Reads keys.json (writing the defaults if it's missing) into bindings, or says what's wrong.
pub fn load() -> Result<Vec<KeyBinding>, String> {
    let p = path();
    if !p.exists() {
        let _ = std::fs::write(&p, DEFAULTS);
    }
    let text = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    parse(&text)
}

pub fn parse(text: &str) -> Result<Vec<KeyBinding>, String> {
    let sections: BTreeMap<String, BTreeMap<String, String>> = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    let mut problems = Vec::new();
    for (section, keys) in &sections {
        let ctx = match tab(section) {
            Ok(c) => c,
            Err(e) => {
                problems.push(e);
                continue;
            }
        };
        for (keys, action) in keys {
            let action = &current(action);
            if gone_mod(action) {
                continue;
            }
            if !valid_action(action) {
                problems.push(format!("{section}.{keys}: unknown action {action:?}"));
                continue;
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
            let action: Box<dyn gpui::Action> = if action == "terminal" {
                // Off where this section applies; globally, simply not bound.
                if section == "global" {
                    continue;
                }
                Box::new(NoAction)
            } else {
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
        KeyBinding::new(ESCAPE_HATCH, ShellAction::new("app.reset"), None),
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

pub(crate) fn pending_keys(window: &gpui::Window) -> Vec<String> {
    window.pending_input_keystrokes().unwrap_or_default().iter().map(gpui::Keystroke::unparse).collect()
}

#[cfg(test)]
mod tests {
    use gpui::{div, Context, FocusHandle, IntoElement, KeyBinding, Render, Subscription, TestAppContext, Window};
    use gpui::prelude::*;
    use gpui_shell::action::ShellAction;

    struct PendingView {
        focus: FocusHandle,
        actions: Vec<String>,
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
            Self { focus: cx.focus_handle(), actions: Vec::new(), changes: 0, _pending: pending }
        }
    }

    impl Render for PendingView {
        fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            div().track_focus(&self.focus).key_context("Herdr").on_action(cx.listener(
                |view, action: &ShellAction, _, _| view.actions.push(action.id().to_owned()),
            ))
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

    #[test]
    fn shipped_keys_load() {
        for keys in [include_str!("../defaults/keys.json"), include_str!("../defaults/keys.macos.json")] {
            assert_eq!(super::parse(keys).err(), None);
        }
    }
}
