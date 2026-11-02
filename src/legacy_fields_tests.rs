use gpui::{AppContext, ClipboardItem, Context, Entity, InteractiveElement as _, IntoElement, ParentElement as _, Render, Styled as _, TestAppContext, VisualTestContext, Window, div};
use gpui::prelude::FluentBuilder as _;
use gpui_base::input::{Input, InputState};

struct FieldRoot {
    input: Entity<InputState>,
    legacy: bool,
    rename: bool,
}

impl Render for FieldRoot {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full()
            .when(self.legacy, |el| el.key_context("HerdrLegacy"))
            .child(div().when(self.rename, |el| el.key_context("LegacyRename"))
                .child(Input::new(&self.input)))
    }
}

fn field(cx: &mut TestAppContext, legacy: bool, rename: bool, text: &'static str, cursor: usize) -> (Entity<InputState>, VisualTestContext) {
    let mut input = None;
    let window = cx.update(|cx| {
        gpui_shell::init(cx);
        cx.open_window(Default::default(), |window, cx| {
            let state = cx.new(|cx| InputState::new(window, cx));
            input = Some(state.clone());
            cx.new(|_| FieldRoot {input: state, legacy, rename})
        }).unwrap()
    });
    let input = input.unwrap();
    let mut visual = VisualTestContext::from_window(window.into(), cx);
    visual.update(|window, cx| input.update(cx, |state, cx| {
        state.set_value(text, window, cx);
        state.set_selected_range(cursor..cursor, cx);
        state.focus(window, cx);
    }));
    visual.run_until_parked();
    (input, visual)
}

#[gpui::test]
fn legacy_field_kill_yank_and_clipboard(cx: &mut TestAppContext) {
    let (input, mut visual) = field(cx, true, false, "one café", "one café".len());
    visual.update(|_, cx| cx.write_to_clipboard(ClipboardItem::new_string("sentinel".into())));
    visual.simulate_keystrokes("ctrl-w");
    input.read_with(&visual, |state, _| assert_eq!(state.value(), "one "));
    visual.simulate_keystrokes("ctrl-y");
    input.read_with(&visual, |state, _| assert_eq!(state.value(), "one café"));
    visual.update(|_, cx| assert_eq!(cx.read_from_clipboard().and_then(|c| c.text()), Some("sentinel".into())));
    visual.simulate_keystrokes("ctrl-a");
    input.read_with(&visual, |state, _| assert_eq!(state.selected_range(), 0..0));
}

#[gpui::test]
fn legacy_field_kill_repairs_joined_grapheme(cx: &mut TestAppContext) {
    let (input, mut visual) = field(cx, true, false, "🇦 x🇧", "🇦".len());
    visual.simulate_keystrokes("alt-d");
    input.read_with(&visual, |state, _| {
        assert_eq!(state.value(), "🇦🇧");
        assert_eq!(state.cursor(), "🇦🇧".len());
    });
    visual.simulate_keystrokes("z");
    input.read_with(&visual, |state, _| assert_eq!(state.value(), "🇦🇧z"));
}

#[gpui::test]
fn legacy_field_yank_repairs_joined_grapheme(cx: &mut TestAppContext) {
    let (input, mut visual) = field(cx, true, false, "🇦", 0);
    visual.simulate_keystrokes("ctrl-k");
    visual.update(|window, cx| input.update(cx, |state, cx| {
        state.set_value("🇧", window, cx);
        state.set_selected_range(0..0, cx);
    }));
    visual.simulate_keystrokes("ctrl-y");
    input.read_with(&visual, |state, _| {
        assert_eq!(state.value(), "🇦🇧");
        assert_eq!(state.cursor(), "🇦🇧".len());
    });
    visual.simulate_keystrokes("z");
    input.read_with(&visual, |state, _| assert_eq!(state.value(), "🇦🇧z"));
}

#[gpui::test]
fn legacy_rename_clears_without_touching_clipboard(cx: &mut TestAppContext) {
    let (input, mut visual) = field(cx, true, true, "café", 0);
    visual.update(|_, cx| cx.write_to_clipboard(ClipboardItem::new_string("sentinel".into())));
    visual.simulate_keystrokes("ctrl-c");
    input.read_with(&visual, |state, _| assert_eq!(state.value(), ""));
    visual.update(|_, cx| assert_eq!(cx.read_from_clipboard().and_then(|c| c.text()), Some("sentinel".into())));
}

#[cfg(not(target_os = "macos"))]
#[gpui::test]
fn modern_field_ctrl_a_still_selects_all(cx: &mut TestAppContext) {
    let (input, mut visual) = field(cx, false, false, "abc", 3);
    visual.simulate_keystrokes("ctrl-a");
    input.read_with(&visual, |state, _| assert_eq!(state.selected_range(), 0..3));
}
