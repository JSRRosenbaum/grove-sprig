//! Keyboard navigation over Ghostty's live screen and scrollback.
use super::*;
use unicode_segmentation::UnicodeSegmentation;

#[cfg(test)]
#[path = "copy_mode_tests.rs"]
mod tests;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct Pos { row: u32, col: u16 }

pub(super) struct Prompt { pub(super) text: String, pub(super) cursor: usize, pub(super) forward: bool, killed: String }

impl Prompt {
    pub(super) fn insert(&mut self, text: &str) {
        let mut normalized = String::new();
        let mut chars = text.chars().peekable();
        while let Some(ch) = chars.next() {
            match ch {
                '\r' => { if chars.peek() == Some(&'\n') { chars.next(); } normalized.push(' '); }
                '\n' | '\t' => normalized.push(' '),
                ch if !ch.is_control() => normalized.push(ch),
                _ => {}
            }
        }
        self.text.insert_str(self.cursor, &normalized);
        self.cursor += normalized.len();
        self.cursor = self.text.grapheme_indices(true).map(|(i, _)| i)
            .find(|i| *i >= self.cursor).unwrap_or(self.text.len());
    }
}

struct SearchJob {
    needle_len: usize,
    matcher: regex::Regex,
    buffer: String,
    forward: bool,
    origin: Pos,
    row: u32,
    revision: u64,
    window: std::collections::VecDeque<(char, Pos)>,
    first: Option<(Pos, Pos)>,
    last: Option<(Pos, Pos)>,
    chosen: Option<(Pos, Pos)>,
    total: usize,
    chosen_index: Option<usize>,
    retain: Option<(usize, usize, (Pos, Pos))>,
    retained: Vec<(Pos, Pos)>,
}

impl SearchJob {
    fn feed(&mut self, c: char, pos: Pos) {
        self.window.push_back((c, pos));
        if self.window.len() > self.needle_len { self.window.pop_front(); }
        if self.window.len() != self.needle_len { return; }
        self.buffer.clear();
        self.buffer.extend(self.window.iter().map(|(ch, _)| *ch));
        if self.matcher.is_match(&self.buffer) {
            let found = (self.window.front().unwrap().1, pos);
            if let Some((start, end, _)) = self.retain {
                if (start..end).contains(&self.total) { self.retained.push(found); }
            } else {
                self.first.get_or_insert(found);
                self.last = Some(found);
                let eligible = if self.forward { found.0 > self.origin } else { found.1 < self.origin };
                if eligible && (self.chosen.is_none() || !self.forward) {
                    self.chosen = Some(found);
                    self.chosen_index = Some(self.total);
                }
            }
            self.total += 1;
            self.window.clear();
        }
    }
}

pub(super) struct CopyMode {
    cursor: Pos,
    anchor: Option<(Pos, bool)>,
    cursor_ref: Option<vt::TrackedCell>,
    anchor_ref: Option<vt::TrackedCell>,
    entry_top: u32,
    geometry: (u16, u16),
    alternate: bool,
    query: String,
    forward: bool,
    search_match: Option<(Pos, Pos)>,
    search_matches: Vec<(Pos, Pos)>,
    job: Option<SearchJob>,
    queued_keys: std::collections::VecDeque<Keystroke>,
    pub(super) prompt: Option<Prompt>,
}

impl CopyMode {
    fn new(vt: &mut Vt) -> Self {
        let top = vt.viewport_top();
        let frame = vt.frame();
        let (col, row) = frame.cursor_cell.unwrap_or((0, vt.rows.saturating_sub(1)));
        let cursor = Pos { row: top + u32::from(row), col };
        Self { cursor, anchor: None, cursor_ref: vt.track_cell(cursor.row, cursor.col), anchor_ref: None,
            entry_top: vt.history_rows().saturating_sub(u32::from(vt.rows)).saturating_sub(top),
            geometry: (vt.cols, vt.rows), alternate: vt.alt_screen(), query: String::new(), forward: true,
            search_match: None, search_matches: Vec::new(), job: None, queued_keys: Default::default(), prompt: None }
    }

    fn valid(&self, vt: &Vt) -> bool { self.geometry == (vt.cols, vt.rows) && self.alternate == vt.alt_screen() }

    fn refresh_tracked(&mut self) -> bool {
        let Some((row, col)) = self.cursor_ref.as_ref().and_then(|r| r.point()) else { return false };
        self.cursor = Pos { row, col };
        if let Some((anchor, _)) = self.anchor.as_mut() {
            let Some((row, col)) = self.anchor_ref.as_ref().and_then(|r| r.point()) else { return false };
            *anchor = Pos { row, col };
        }
        true
    }

    pub(super) fn output_changed(&mut self, vt: &mut Vt) -> Option<(u16, u32)> {
        if !self.valid(vt) || !self.refresh_tracked() { return None; }
        if !self.query.is_empty() && self.job.is_none() {
            let forward = self.forward;
            self.search(vt, forward, false);
        }
        Some((self.cursor.col, self.cursor.row))
    }

    fn sync(&mut self, vt: &mut Vt) {
        self.cursor.row = self.cursor.row.min(vt.history_rows().saturating_sub(1));
        self.cursor.col = self.cursor.col.min(vt.cols.saturating_sub(1));
        let top = vt.viewport_top();
        let bottom = top.saturating_add(u32::from(vt.rows.saturating_sub(1)));
        if self.cursor.row < top { vt.scroll_viewport(-((top - self.cursor.row) as isize)); }
        else if self.cursor.row > bottom { vt.scroll_viewport((self.cursor.row - bottom) as isize); }
        if let Some((anchor, line)) = self.anchor {
            let (a, b) = if line {
                (Pos { row: anchor.row.min(self.cursor.row), col: 0 }, Pos { row: anchor.row.max(self.cursor.row), col: vt.cols.saturating_sub(1) })
            } else { (anchor, self.cursor) };
            vt.select_history((a.row, a.col), (b.row, b.col));
        }
        if let Some(r) = &self.cursor_ref { vt.move_tracked_cell(r, self.cursor.row, self.cursor.col); }
        else { self.cursor_ref = vt.track_cell(self.cursor.row, self.cursor.col); }
        if let Some((anchor, _)) = self.anchor {
            if let Some(r) = &self.anchor_ref { vt.move_tracked_cell(r, anchor.row, anchor.col); }
            else { self.anchor_ref = vt.track_cell(anchor.row, anchor.col); }
        } else { self.anchor_ref = None; }
    }

    fn class(c: char, big: bool) -> u8 {
        if c.is_whitespace() { 0 }
        else if !big && c.is_ascii() && "!\"#$%&'()*+,-./:;<=>?@[\\]^`{|}~".contains(c) { 2 }
        else { 1 }
    }

    fn step(p: Pos, forward: bool, cols: u16, rows: u32) -> Option<Pos> {
        if forward {
            if p.col + 1 < cols { Some(Pos { col: p.col + 1, ..p }) }
            else if p.row + 1 < rows { Some(Pos { row: p.row + 1, col: 0 }) } else { None }
        } else if p.col > 0 { Some(Pos { col: p.col - 1, ..p }) }
        else if p.row > 0 { Some(Pos { row: p.row - 1, col: cols.saturating_sub(1) }) } else { None }
    }

    fn motion_word(&mut self, vt: &Vt, forward: bool, end: bool, big: bool) {
        let rows = vt.history_rows();
        let mut cache: Option<(u32, Vec<char>)> = None;
        let mut get = |p: Pos| {
            if cache.as_ref().is_none_or(|(r, _)| *r != p.row) { cache = vt.history_row(p.row).map(|line| (p.row, line)); }
            cache.as_ref().and_then(|(_, line)| line.get(p.col as usize)).copied().unwrap_or(' ')
        };
        let mut p = self.cursor;
        let mut class = Self::class(get(p), big);
        if forward && !end {
            let mut found = false;
            while let Some(next) = Self::step(p, true, vt.cols, rows) {
                let c = Self::class(get(next), big);
                let hard_break = next.row != p.row && !vt.wraps(p.row);
                p = next;
                if c != 0 && (c != class || hard_break) { found = true; break; }
                class = c;
            }
            if !found { return; }
        } else if !forward {
            let Some(prev) = Self::step(p, false, vt.cols, rows) else { return };
            p = prev;
            while Self::class(get(p), big) == 0 {
                let Some(prev) = Self::step(p, false, vt.cols, rows) else { return };
                p = prev;
            }
            class = Self::class(get(p), big);
            while let Some(prev) = Self::step(p, false, vt.cols, rows) {
                if Self::class(get(prev), big) != class || (prev.row != p.row && !vt.wraps(prev.row)) { break; }
                p = prev;
            }
        } else {
            let Some(next) = Self::step(p, true, vt.cols, rows) else { return };
            p = next;
            while Self::class(get(p), big) == 0 {
                let Some(next) = Self::step(p, true, vt.cols, rows) else { return };
                p = next;
            }
            class = Self::class(get(p), big);
            while let Some(next) = Self::step(p, true, vt.cols, rows) {
                if Self::class(get(next), big) != class || (next.row != p.row && !vt.wraps(p.row)) { break; }
                p = next;
            }
        }
        self.cursor = p;
    }

    fn search(&mut self, vt: &Vt, forward: bool, repeat: bool) {
        if self.query.is_empty() { return; }
        if self.query.len() > 4096 { return; }
        let smart = self.query.chars().any(char::is_uppercase);
        let pattern = format!("^(?:{})$", regex::escape(&self.query));
        let Ok(matcher) = regex::RegexBuilder::new(&pattern).case_insensitive(!smart).build() else { return };
        let origin = self.search_match.filter(|(start, _)| repeat && *start == self.cursor)
            .map_or(self.cursor, |(start, end)| if forward { end } else { start });
        self.job = Some(SearchJob { needle_len: self.query.chars().count(), matcher, buffer: String::new(), forward,
            origin, row: 0, revision: vt.revision, window: Default::default(), first: None, last: None, chosen: None,
            total: 0, chosen_index: None, retain: None, retained: Vec::new() });
        self.search_match = None;
        self.search_matches.clear();
    }

    /// Scan a bounded number of rows per UI turn, without copying the history.
    fn search_chunk(&mut self, vt: &Vt) -> bool {
        let Some(job) = self.job.as_mut() else { return false };
        if job.revision != vt.revision {
            job.row = 0;
            job.revision = vt.revision;
            job.window.clear();
            job.first = None; job.last = None; job.chosen = None;
            job.total = 0; job.chosen_index = None; job.retain = None; job.retained.clear();
            job.origin = self.cursor;
        }
        let rows = vt.history_rows();
        let end = job.row.saturating_add(24).min(rows);
        while job.row < end {
            let row = job.row;
            if let Some(chars) = vt.history_characters(row) {
                let wrapped = vt.wraps(row);
                let len = if wrapped { chars.len() } else { chars.iter().rposition(|(c, _)| !c.is_whitespace()).map_or(0, |i| i + 1) };
                for (c, col) in chars.into_iter().take(len) {
                    job.feed(c, Pos { row, col });
                }
                if !wrapped { job.window.clear(); }
            }
            job.row += 1;
        }
        if job.row < rows { return true; }
        if job.retain.is_none() {
            let Some(result) = job.chosen.or(if job.forward { job.first } else { job.last }) else {
                self.job = None; self.search_match = None; self.search_matches.clear(); return false;
            };
            let target = job.chosen_index.unwrap_or(if job.forward { 0 } else { job.total - 1 });
            let count = job.total.min(1024);
            let start = target.saturating_sub(count / 2).min(job.total - count);
            job.retain = Some((start, start + count, result));
            job.row = 0;
            job.total = 0;
            job.window.clear();
            return true;
        }
        let result = job.retain.map(|(_, _, result)| result);
        self.search_matches = std::mem::take(&mut job.retained);
        self.job = None;
        self.search_match = result;
        if let Some((start, _)) = result { self.cursor = start; }
        false
    }

    fn prompt_key(&mut self, key: &Keystroke) -> bool {
        let Some(p) = self.prompt.as_mut() else { return false };
        let ctrl = key.modifiers.control;
        let alt = key.modifiers.alt;
        let prev = |s: &str, at: usize| s[..at].grapheme_indices(true).next_back().map_or(0, |(i, _)| i);
        let next = |s: &str, at: usize| at + s[at..].graphemes(true).next().map_or(0, str::len);
        match key.key.as_str() {
            "escape" => self.prompt = None,
            "enter" => { let p = self.prompt.take().unwrap(); self.query = p.text; self.forward = p.forward; }
            "left" => p.cursor = prev(&p.text, p.cursor),
            "right" => p.cursor = next(&p.text, p.cursor),
            "home" => p.cursor = 0,
            "end" => p.cursor = p.text.len(),
            "space" if !ctrl && !alt && !key.modifiers.platform => { p.text.insert(p.cursor, ' '); p.cursor += 1; }
            "backspace" if ctrl || alt => { let n = word_boundary(&p.text, p.cursor, false); p.killed = p.text[n..p.cursor].to_owned(); p.text.drain(n..p.cursor); p.cursor = n; }
            "backspace" => { let n = prev(&p.text, p.cursor); p.text.drain(n..p.cursor); p.cursor = n; }
            "delete" => { let n = next(&p.text, p.cursor); p.text.drain(p.cursor..n); }
            "a" if ctrl => p.cursor = 0,
            "e" if ctrl => p.cursor = p.text.len(),
            "b" if ctrl => p.cursor = prev(&p.text, p.cursor),
            "f" if ctrl => p.cursor = next(&p.text, p.cursor),
            "b" if alt => p.cursor = word_boundary(&p.text, p.cursor, false),
            "f" if alt => p.cursor = word_boundary(&p.text, p.cursor, true),
            "u" if ctrl => { p.killed = p.text[..p.cursor].to_owned(); p.text.drain(..p.cursor); p.cursor = 0; }
            "k" if ctrl => { p.killed = p.text[p.cursor..].to_owned(); p.text.truncate(p.cursor); }
            "w" if ctrl => { let n = word_boundary(&p.text, p.cursor, false); p.killed = p.text[n..p.cursor].to_owned(); p.text.drain(n..p.cursor); p.cursor = n; }
            "d" if alt => { let n = word_boundary(&p.text, p.cursor, true); p.killed = p.text[p.cursor..n].to_owned(); p.text.drain(p.cursor..n); }
            "y" if ctrl => { p.text.insert_str(p.cursor, &p.killed); p.cursor += p.killed.len(); }
            "h" if ctrl => { let n = prev(&p.text, p.cursor); p.text.drain(n..p.cursor); p.cursor = n; }
            "d" if ctrl => { let n = next(&p.text, p.cursor); p.text.drain(p.cursor..n); }
            _ if !ctrl && !alt && !key.modifiers.platform => {
                if let Some(text) = key.key_char.as_deref() {
                    p.insert(text);
                } else if key.key.chars().count() == 1 {
                    p.insert(&key.key);
                }
            }
            _ => {}
        }
        if let Some(p) = self.prompt.as_mut() {
            p.cursor = p.text.grapheme_indices(true).map(|(i, _)| i).find(|i| *i >= p.cursor).unwrap_or(p.text.len());
        }
        true
    }
}

impl TerminalView {
    pub fn enter_copy_mode(&mut self, cx: &mut Context<Self>) {
        if self.copy_mode.is_none() {
            let mut g = self.grid.borrow_mut();
            g.vt.clear_selection();
            let mode = CopyMode::new(&mut g.vt);
            g.copy_matches.clear();
            g.copy_cursor = Some((mode.cursor.col, mode.cursor.row));
            self.copy_mode = Some(mode);
        }
        cx.notify();
    }
    pub fn copy_mode_active(&self) -> bool { self.copy_mode.is_some() }
    pub fn copy_search_active(&self) -> bool { self.copy_mode.as_ref().is_some_and(|m| m.prompt.is_some()) }
    pub fn route_copy_key(&mut self, key: &Keystroke, cx: &mut Context<Self>) {
        if self.copy_mode.is_some() { self.copy_key(key, cx); }
    }
    pub fn selected_text(&self) -> Option<String> { self.grid.borrow().vt.selection_text() }
    pub(super) fn invalidate_copy_mode(&mut self, cx: &mut Context<Self>) {
        if self.copy_mode.take().is_some() {
            let mut g = self.grid.borrow_mut();
            g.vt.clear_selection();
            g.copy_cursor = None;
            g.copy_matches.clear();
            self.copy_search_task = None;
            self.copy_search_running = false;
            cx.notify();
        }
    }
    pub fn scrollback_text(&self) -> String { self.grid.borrow().vt.scrollback_text() }

    pub(super) fn copy_key(&mut self, key: &Keystroke, cx: &mut Context<Self>) {
        let Some(mut mode) = self.copy_mode.take() else { return };
        let mut g = self.grid.borrow_mut();
        let vt = &mut g.vt;
        if !mode.valid(vt) || !mode.refresh_tracked() { vt.clear_selection(); g.copy_cursor = None; g.copy_matches.clear(); cx.notify(); return; }
        if mode.job.is_some() && mode.prompt.is_none() {
            mode.queued_keys.push_back(key.clone());
            self.copy_mode = Some(mode);
            return;
        }
        let was_prompt = mode.prompt.is_some();
        if mode.prompt_key(key) {
            if was_prompt && mode.prompt.is_none() && key.key == "enter" {
                let forward = mode.forward;
                mode.search(vt, forward, false);
            }
        } else {
            let ctrl = key.modifiers.control;
            let text = key.key_char.as_deref().unwrap_or(&key.key);
            let mut ch = if key.key == "space" { ' ' } else { text.chars().next().unwrap_or('\0') };
            if key.key_char.is_none() && key.modifiers.shift { ch = ch.to_ascii_uppercase(); }
            let last = vt.history_rows().saturating_sub(1);
            let page = if vt.rows <= 2 { 1 } else { u32::from(vt.rows - 2) };
            let half = if vt.rows <= 2 { 1 } else { u32::from(vt.rows / 2) };
            let mut exit = false;
            let mut copy = false;
            match key.key.as_str() {
                "escape" => { if mode.anchor.is_some() || !mode.query.is_empty() { mode.anchor = None; mode.query.clear(); mode.job = None; mode.search_match = None; vt.clear_selection(); } else { exit = true; } }
                "enter" => { exit = true; copy = true; }
                "left" => mode.cursor.col = mode.cursor.col.saturating_sub(1),
                "right" => mode.cursor.col = mode.cursor.col.saturating_add(1).min(vt.cols.saturating_sub(1)),
                "up" => mode.cursor.row = mode.cursor.row.saturating_sub(1),
                "down" => mode.cursor.row = mode.cursor.row.saturating_add(1).min(last),
                "pageup" => page_move(&mut mode, vt, false, page, last),
                "pagedown" => page_move(&mut mode, vt, true, page, last),
                "home" => mode.cursor.col = 0,
                "end" => mode.cursor.col = line_end(vt, mode.cursor.row),
                _ if ctrl => match ch {
                    'b' => page_move(&mut mode, vt, false, page, last),
                    'f' => page_move(&mut mode, vt, true, page, last),
                    'u' => page_move(&mut mode, vt, false, half, last),
                    'd' => page_move(&mut mode, vt, true, half, last),
                    _ => {}
                },
                _ if key.modifiers.alt || key.modifiers.platform => {}
                _ => match ch {
                    'q' => exit = true, 'y' => { exit = true; copy = true; },
                    'v' | ' ' => mode.anchor = Some((mode.cursor, false)), 'V' => mode.anchor = Some((mode.cursor, true)),
                    'h' => mode.cursor.col = mode.cursor.col.saturating_sub(1), 'l' => mode.cursor.col = mode.cursor.col.saturating_add(1).min(vt.cols.saturating_sub(1)),
                    'k' => mode.cursor.row = mode.cursor.row.saturating_sub(1), 'j' => mode.cursor.row = mode.cursor.row.saturating_add(1).min(last),
                    'g' => mode.cursor.row = 0, 'G' => mode.cursor.row = last, '0' => mode.cursor.col = 0,
                    '$' => mode.cursor.col = line_end(vt, mode.cursor.row),
                    '^' => mode.cursor.col = vt.history_row(mode.cursor.row).and_then(|r| r.iter().position(|c| !c.is_whitespace())).unwrap_or(0) as u16,
                    'w' | 'W' => mode.motion_word(vt, true, false, ch == 'W'), 'b' | 'B' => mode.motion_word(vt, false, false, ch == 'B'), 'e' | 'E' => mode.motion_word(vt, true, true, ch == 'E'),
                    '{' | '}' => {
                        for distance in 1..vt.history_rows().min(1000) {
                            let row = if ch == '}' { mode.cursor.row.checked_add(distance).filter(|r| *r <= last) }
                                else { mode.cursor.row.checked_sub(distance) };
                            let Some(row) = row else { break };
                            if vt.history_row(row).is_some_and(|r| r.iter().all(|c| c.is_whitespace())) {
                                mode.cursor = Pos { row, col: 0 };
                                break;
                            }
                        }
                    },
                    '/' | '?' => mode.prompt = Some(Prompt { text: String::new(), cursor: 0, forward: ch == '/', killed: String::new() }),
                    'n' | 'N' => { let dir = if ch == 'n' { mode.forward } else { !mode.forward }; mode.search(vt, dir, true); },
                    _ => {}
                }
            }
            if exit {
                if copy {
                    if mode.anchor.is_none() {
                        if let Some((a, b)) = mode.search_match { vt.select_history((a.row, a.col), (b.row, b.col)); }
                    }
                    if let Some(text) = vt.selection_text() {
                        cx.write_to_clipboard(ClipboardItem::new_string(text.clone()));
                        #[cfg(target_os = "linux")]
                        cx.write_to_primary(ClipboardItem::new_string(text));
                        cx.emit(TerminalEvent::Copied);
                    }
                }
                vt.clear_selection();
                let top = vt.viewport_top();
                let entry_top = vt.history_rows().saturating_sub(u32::from(vt.rows)).saturating_sub(mode.entry_top);
                vt.scroll_viewport(entry_top as isize - top as isize);
                g.copy_cursor = None;
                g.copy_matches.clear();
                cx.notify();
                return;
            }
        }
        mode.sync(vt);
        g.copy_cursor = Some((mode.cursor.col, mode.cursor.row));
        if mode.job.is_some() || mode.query.is_empty() { g.copy_matches.clear(); }
        let searching = mode.job.is_some();
        self.copy_mode = Some(mode);
        drop(g);
        if searching { self.start_copy_search_task(cx); }
        cx.notify();
    }

    pub(super) fn start_copy_search_task(&mut self, cx: &mut Context<Self>) {
        if self.copy_search_running || !self.copy_mode.as_ref().is_some_and(|m| m.job.is_some()) { return; }
        self.copy_search_running = true;
        self.copy_search_task = Some(cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(Duration::from_millis(1)).await;
                let more = this.update(cx, |this, cx| this.advance_copy_search(cx)).unwrap_or(false);
                if !more { break; }
            }
        }));
    }

    fn advance_copy_search(&mut self, cx: &mut Context<Self>) -> bool {
        let Some(mut mode) = self.copy_mode.take() else { self.copy_search_running = false; return false };
        let mut g = self.grid.borrow_mut();
        if !mode.valid(&g.vt) || !mode.refresh_tracked() {
            g.vt.clear_selection();
            g.copy_cursor = None;
            g.copy_matches.clear();
            self.copy_search_running = false;
            cx.notify();
            return false;
        }
        let more = mode.search_chunk(&g.vt);
        if !more { self.copy_search_running = false; }
        if !more {
            mode.sync(&mut g.vt);
            g.copy_matches = mode.search_matches.iter().map(|(a, b)| (a.row, a.col, b.row, b.col)).collect();
            if mode.anchor.is_none() {
                if let Some((a, b)) = mode.search_match {
                    g.vt.select_history((a.row, a.col), (b.row, b.col));
                } else {
                    g.vt.clear_selection();
                }
            }
            g.copy_cursor = Some((mode.cursor.col, mode.cursor.row));
        }
        let queued = if more { Default::default() } else { std::mem::take(&mut mode.queued_keys) };
        self.copy_mode = Some(mode);
        drop(g);
        cx.notify();
        for key in queued { self.copy_key(&key, cx); }
        more
    }
}

fn page_move(mode: &mut CopyMode, vt: &mut Vt, forward: bool, lines: u32, last: u32) {
    if forward {
        mode.cursor.row = mode.cursor.row.saturating_add(lines).min(last);
        vt.scroll_viewport(lines as isize);
    } else {
        mode.cursor.row = mode.cursor.row.saturating_sub(lines);
        vt.scroll_viewport(-(lines as isize));
    }
}

fn word_boundary(text: &str, cursor: usize, forward: bool) -> usize {
    let class = |c: char| if c.is_whitespace() { 0 } else if c.is_alphanumeric() || c == '_' { 1 } else { 2 };
    let mut boundary = cursor;
    let mut run = 0;
    if forward {
        for (i, grapheme) in text[cursor..].grapheme_indices(true) {
            let current = class(grapheme.chars().next().unwrap_or(' '));
            if run != 0 && current != run { break; }
            run = current;
            boundary = cursor + i + grapheme.len();
        }
    } else {
        for (i, grapheme) in text[..cursor].grapheme_indices(true).rev() {
            let current = class(grapheme.chars().next().unwrap_or(' '));
            if run != 0 && current != run { break; }
            run = current;
            boundary = i;
        }
    }
    boundary
}

fn line_end(vt: &Vt, row: u32) -> u16 {
    vt.history_row(row).and_then(|r| r.iter().rposition(|c| !c.is_whitespace())).unwrap_or(0) as u16
}
