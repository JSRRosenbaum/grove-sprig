// Legacy navigator, one row per terminal pane. Upstream Herdr: Apache-2.0.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, machines, panes, focused, shared, run, props, closeOverlay, theme } from "herdr";

export default class Goto extends View {
  init(_props, cx) {
    this.filter = null; this.query = ""; this.at = null; this.selected = null; this.scroll = 0; this.searching = false;
    const initial = this.rows(); const current = initial.find(r => r.kind === "pane" && r.p.pane === focused()?.pane);
    if (current) this.selected = this.identity(current);
    this.handle = cx.focus_handle(); this.handle.focus();
    this.input = InputState.new({placeholder: "Search terminals…"});
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); this.filter = null; this.selected = null; this.at = null; cx.notify(); });
    this.input.on("submit", () => { const rows = this.rows(); this.go(rows[this.index(rows)]); });
  }
  close() { closeOverlay(props().overlay); }
  rows() {
    const scope = shared("rowan.sidebar.scope");
    if (!Array.isArray(scope?.spaceIds)) return [];
    const world = spaces(), ps = panes(), words = this.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = text => words.every(word => String(text ?? "").toLowerCase().includes(word));
    const filtering = !!this.filter || words.length > 0, out = [];
    const machineOrder = scope.machineKeys ?? [...new Set(world.map(s => s.machine ?? "@local"))];
    for (const key of machineOrder) {
      const machine = key === "@local" ? null : key, group = [];
      for (const id of (scope.orderedIds ?? scope.spaceIds).filter(id => scope.spaceIds.includes(id))) {
        const w = world.find(s => s.id === id && s.machine === machine);
        if (!w) continue;
        const workspaceMatches = matches(`${w.name} ${scope.labels?.[w.id] ?? ""} ${w.branch ?? ""}`) || (words.length && matches(machine ?? "Local"));
        const children = w.tabs.flatMap(tab => ps.filter(p => p.tab === tab.id && p.terminal).map(p => ({kind:"pane", w, tab, p})))
          .filter(r => (!this.filter || r.p.status === this.filter) && (workspaceMatches || matches(`${r.tab.name} ${r.p.title} ${r.p.cwd} ${r.p.program?.name} ${r.p.pane}`)));
        if (!filtering || children.length || (!this.filter && workspaceMatches)) group.push({kind:"workspace", w}, ...children);
      }
      if (machineOrder.length > 1 && (!filtering || group.length || (!this.filter && matches(machine ?? "Local")))) out.push({kind:"machine", machine});
      out.push(...group);
    }
    return out;
  }
  identity(r) {
    if (!r) return null;
    if (r.kind === "machine") return JSON.stringify([r.kind, r.machine]);
    if (r.kind === "workspace") return JSON.stringify([r.kind, r.w.machine, r.w.id]);
    return JSON.stringify([r.kind, r.w.machine, r.w.id, r.tab.id, r.p.pane, r.p.terminal]);
  }
  index(rows) {
    if (this.selected !== null) return rows.findIndex(r => this.identity(r) === this.selected);
    const first = rows.findIndex(r => r.kind === "pane");
    return first >= 0 ? first : (rows.length ? 0 : -1);
  }
  choose(rows, index) { this.at = index; this.selected = this.identity(rows[index]); }
  valid(r) {
    const scope = shared("rowan.sidebar.scope");
    if (!r || !Array.isArray(scope?.spaceIds)) return false;
    const machine = r.kind === "machine" ? r.machine : r.w.machine;
    if (!machines().some(m => m.name === machine && m.layout === "ready")) return false;
    if (r.kind === "machine") return Array.isArray(scope.machineKeys) && scope.machineKeys.includes(machine ?? "@local");
    if (!scope.spaceIds.includes(r.w.id) || !spaces().some(s => s.id === r.w.id && s.machine === machine)) return false;
    if (r.kind === "workspace") return true;
    return spaces().some(s => s.id === r.w.id && s.tabs.some(t => t.id === r.tab.id)) &&
      panes().some(p => p.pane === r.p.pane && p.tab === r.tab.id && p.terminal === r.p.terminal);
  }
  go(r) {
    if (!this.valid(r)) return;
    this.close();
    if (r.kind === "machine") { run("machine.select", {machine: r.machine ?? ""}); return; }
    run("space.select", {id: r.w.id});
    if (r.kind === "pane") { run("tab.select", {id: r.tab.id}); run("pane.focus", {pane: r.p.pane}); }
  }
  move(delta, count) { this.at = Math.max(0, Math.min(Math.max(0, count - 1), Math.max(0, this.at) + delta)); }
  key(e, cx) {
    const k = e.key, m = e.modifiers || {}, rows = this.rows(), plain = !m.control && !m.alt && !m.platform;
    this.at = this.index(rows);
    const done = () => { cx.stop_propagation(); cx.notify(); };
    if (k === "escape") { if (this.searching) { this.searching = false; this.handle.focus(); } else this.close(); return done(); }
    if (k === "enter") { this.go(rows[this.at]); return done(); }
    if (this.searching) {
      if (k === "up" || (m.control && k === "p")) this.move(-1, rows.length);
      else if (k === "down" || (m.control && k === "n")) this.move(1, rows.length);
      else return;
      this.choose(rows, this.at); return done();
    }
    if (plain && (k === "left" || k === "right")) {
      const destinations = rows.map((r, i) => r.kind === "workspace" && rows[i + 1]?.kind === "pane" ? i + 1 : -1).filter(i => i >= 0);
      let section = this.at;
      while (section > 0 && rows[section]?.kind === "pane") section--;
      const next = k === "right" ? destinations.find(i => i - 1 > section) : destinations.filter(i => i - 1 < section).pop();
      if (next !== undefined) this.choose(rows, next);
    } else if (plain && k === "backspace") { this.filter = null; this.selected = null; this.at = null; }
    else if (plain && k === "home") { this.selected = null; this.at = null; this.scroll = 0; }
    else if (plain && (k === "end" || k === "G" || (m.shift && k === "g"))) this.choose(rows, Math.max(0, rows.length - 1));
    else if (plain && k === "/") { this.searching = true; this.filter = null; this.input.focus(); }
    else if (plain && (k === "down" || k === "j")) { this.move(1, rows.length); this.choose(rows, this.at); }
    else if (plain && (k === "up" || k === "k")) { this.move(-1, rows.length); this.choose(rows, this.at); }
    else if (m.control && k === "d") { this.move(8, rows.length); this.choose(rows, this.at); }
    else if (m.control && k === "u") { this.move(-8, rows.length); this.choose(rows, this.at); }
    else if (plain && ["b", "w", "i", "d", "a"].includes(k)) { this.input.set_value(""); this.query = ""; this.filter = {b:"blocked", w:"working", i:"idle", d:"done", a:null}[k]; this.selected = null; this.at = null; }
    return done();
  }
  render() {
    const t = theme(), rows = this.rows();
    this.at = this.index(rows);
    const count = 10; this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, rows.length - count)));
    if (this.at >= 0 && this.at < this.scroll) this.scroll = this.at; if (this.at >= this.scroll + count) this.scroll = this.at - count + 1;
    return v_flex().id("legacy-goto").track_focus(this.handle).size_full().min_h(0).bg(t.popover).border_1().border_color(t.border).text_size(13)
      .on_key_down((e,cx) => this.key(e,cx))
      .child(div().h(36).px(14).text_color(t.foreground).child(`Go to · ${this.filter || "all"} · / search · Esc close`))
      .when(this.searching || !!this.query, el => el.child(Input.new(this.input).h(32).px(12).bg(t.background).text_color(t.foreground)))
      .child(v_flex().flex_1().min_h(0).children(rows.slice(this.scroll, this.scroll + count).map((r, i) => h_flex().id(`goto-${r.kind === "pane" ? r.p.pane : r.kind === "workspace" ? r.w.id : r.machine ?? "local"}`).h(34).px(14).gap(8).items_center().cursor_pointer().when(i + this.scroll === this.at, el => el.bg(t.selected)).on_click(() => this.go(r))
        .child(div().text_color(t.dim).child(r.p?.status || "·"))
        .child(div().flex_1().truncate().text_color(t.foreground).child(r.kind === "machine" ? (r.machine ?? "Local") : r.kind === "workspace" ? (shared("rowan.sidebar.scope")?.labels?.[r.w.id] ?? r.w.name) : `  ${r.tab.name} / ${r.p.title || r.p.program?.name || "terminal"}`))
        .child(div().text_color(t.dim).child(this.valid(r) ? "" : "offline")))))
      .child(div().px(14).py(6).text_color(t.dim).child("b blocked · w working · i idle · d done · a all"));
  }
}
