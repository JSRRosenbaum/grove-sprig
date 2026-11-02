use super::{word_boundary, CopyMode, Pos, Prompt};
use crate::vt::Vt;
use gpui::Keystroke;

#[test]
fn word_motion_distinguishes_punctuation_and_big_words() {
    let mut vt = Vt::new(30, 3);
    vt.write(b"foo,bar baz");
    let mut mode = CopyMode::new(&mut vt);
    mode.cursor = Pos { row: 0, col: 0 };
    mode.motion_word(&vt, true, false, false);
    assert_eq!(mode.cursor.col, 3);
    mode.cursor.col = 0;
    mode.motion_word(&vt, true, false, true);
    assert_eq!(mode.cursor.col, 8);
    mode.motion_word(&vt, false, false, true);
    assert_eq!(mode.cursor.col, 0);
}

#[test]
fn search_smartcase_repeat_and_live_output() {
    let mut vt = Vt::new(20, 3);
    vt.write(b"Cat cat CAT");
    let mut mode = CopyMode::new(&mut vt);
    mode.cursor = Pos { row: 0, col: 0 };
    mode.query = "cat".into();
    mode.search(&vt, true, false);
    while mode.search_chunk(&vt) {}
    assert_eq!(mode.cursor.col, 4);
    mode.search(&vt, true, true);
    while mode.search_chunk(&vt) {}
    assert_eq!(mode.cursor.col, 8);
    mode.query = "CAT".into();
    mode.search(&vt, true, false);
    while mode.search_chunk(&vt) {}
    assert_eq!(mode.cursor.col, 8);
    vt.write(b" cat");
    mode.query = "cat".into();
    mode.search(&vt, true, true);
    while mode.search_chunk(&vt) {}
    assert_eq!(mode.cursor.col, 12);
}

#[test]
fn search_crosses_soft_wrap_but_not_hard_newlines() {
    let mut vt = Vt::new(5, 4);
    vt.write(b"abcdef\r\nnext");
    let mut mode = CopyMode::new(&mut vt);
    mode.cursor = Pos { row: 0, col: 0 };
    mode.query = "def".into();
    mode.search(&vt, true, false);
    while mode.search_chunk(&vt) {}
    assert_eq!(mode.search_match.map(|m| (m.0.row, m.0.col, m.1.row, m.1.col)), Some((0, 3, 1, 0)));
    mode.query = "f\nnext".into();
    mode.search(&vt, true, false);
    while mode.search_chunk(&vt) {}
    assert!(mode.search_match.is_none());
}

#[test]
fn search_restarts_after_live_output_between_chunks() {
    let mut vt = Vt::new(20, 30);
    let mut mode = CopyMode::new(&mut vt);
    mode.query = "fresh".into();
    mode.search(&vt, true, false);
    assert!(mode.search_chunk(&vt));
    vt.write(b"fresh");
    while mode.search_chunk(&vt) {}
    assert_eq!(mode.search_match.map(|m| (m.0.row, m.0.col)), Some((0, 0)));
}

#[test]
fn tracked_selection_survives_live_output() {
    let mut vt = Vt::new(10, 2);
    vt.write(b"first\r\nsecond");
    let mut mode = CopyMode::new(&mut vt);
    mode.cursor = Pos { row: 0, col: 0 };
    mode.anchor = Some((mode.cursor, false));
    mode.cursor.col = 4;
    mode.sync(&mut vt);
    assert_eq!(vt.selection_text().as_deref(), Some("first"));
    vt.write(b"\r\nthird");
    assert!(mode.output_changed(&mut vt).is_some());
    assert_eq!(vt.selection_text().as_deref(), Some("first"));
}

#[test]
fn search_editor_word_boundaries_follow_legacy_classes() {
    assert_eq!(word_boundary("one, two", 8, false), 5);
    assert_eq!(word_boundary("one, two", 0, true), 3);
}

#[test]
fn search_editor_deletes_whole_grapheme_and_yanks_kills() {
    let mut vt = Vt::new(20, 2);
    let mut mode = CopyMode::new(&mut vt);
    mode.prompt = Some(Prompt { text: String::new(), cursor: 0, forward: true, killed: String::new() });
    mode.prompt.as_mut().unwrap().insert("a\u{301}bc");
    mode.prompt_key(&Keystroke::parse("ctrl-a").unwrap());
    mode.prompt_key(&Keystroke::parse("delete").unwrap());
    assert_eq!(mode.prompt.as_ref().unwrap().text, "bc");
    mode.prompt_key(&Keystroke::parse("ctrl-k").unwrap());
    assert_eq!(mode.prompt.as_ref().unwrap().text, "");
    mode.prompt_key(&Keystroke::parse("ctrl-y").unwrap());
    assert_eq!(mode.prompt.as_ref().unwrap().text, "bc");
}

#[test]
fn alternate_screen_and_resize_invalidate_mode() {
    let mut vt = Vt::new(20, 3);
    let mut mode = CopyMode::new(&mut vt);
    vt.write(b"\x1b[?1049h");
    assert!(mode.output_changed(&mut vt).is_none());
    vt.write(b"\x1b[?1049l");
    let mut mode = CopyMode::new(&mut vt);
    vt.resize(30, 3, 9, 18);
    assert!(mode.output_changed(&mut vt).is_none());
}

#[test]
fn search_uses_unicode_simple_case_folding_and_retains_matches() {
    let mut vt = Vt::new(20, 3);
    vt.write("σ ς Σ".as_bytes());
    let mut mode = CopyMode::new(&mut vt);
    mode.cursor = Pos { row: 0, col: 0 };
    mode.query = "σ".into();
    mode.search(&vt, true, false);
    while mode.search_chunk(&vt) {}
    assert_eq!(mode.cursor.col, 2);
    assert_eq!(mode.search_matches.len(), 3);
    mode.query = "Σ".into();
    mode.search(&vt, true, false);
    while mode.search_chunk(&vt) {}
    assert_eq!(mode.search_matches.len(), 1);
}

#[test]
fn retained_search_matches_are_bounded_and_centered_on_target() {
    let mut vt = Vt::new(100, 30);
    vt.write("a ".repeat(1200).as_bytes());
    let mut mode = CopyMode::new(&mut vt);
    mode.cursor = Pos { row: 10, col: 0 };
    mode.query = "a".into();
    mode.search(&vt, true, false);
    while mode.search_chunk(&vt) {}
    assert_eq!(mode.search_matches.len(), 1024);
    assert!(mode.search_matches.contains(&mode.search_match.unwrap()));
}
