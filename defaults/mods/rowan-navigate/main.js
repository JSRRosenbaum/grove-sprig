// Legacy workspace preview and pane navigation. Upstream Herdr: Apache-2.0.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, focused, keys, window, shared, run, props, closeOverlay, theme } from "herdr";

export function chord(e) {
  const m = e.modifiers || {};
  const key = e.key === " " ? "space" : e.key.toLowerCase();
  return [m.control && "ctrl", m.alt && "alt", m.shift && "shift", m.platform && "cmd", key].filter(Boolean).join("-");
}
export function effective(bindings, layout) {
  const rank = s => s === "terminal" ? 2 : s === `layout:${layout}` ? 1 : s === "global" ? 0 : -1;
  const out = new Map();
  for (const b of bindings) if (rank(b.section) >= 0 && (!out.has(b.keys) || rank(b.section) > rank(out.get(b.keys).section))) out.set(b.keys, b);
  return [...out.values()];
}
export default class Navigate extends View {
  init(_props, cx) { this.preview = focused()?.space ?? null; this.previewMachine = spaces().find(s => s.id === this.preview)?.machine; this.notice = ""; this.handle = cx.focus_handle(); this.handle.focus(); }
  close() { closeOverlay(props().overlay); }
  rows() {
    const scope = shared("rowan.sidebar.scope");
    if (!Array.isArray(scope?.spaceIds)) return [];
    const all = spaces(), ready = machines();
    return (scope.orderedIds ?? scope.spaceIds).filter(id => scope.spaceIds.includes(id)).map(id => all.find(s => s.id === id)).filter(s => s && ready.some(m => m.name === s.machine && m.layout === "ready"));
  }
  valid(s) { return !!s && this.rows().some(row => row.id === s.id && row.machine === s.machine); }
  key(e, cx) {
    const stroke = chord(e), all = keys(), normal = effective(all, window()?.layout_name);
    const prefixes = normal.filter(b => b.action === "legacy.prefix_cancel" && b.keys.endsWith(" escape")).map(b => b.keys.slice(0, -7));
    const mode = all.filter(b => b.section === "mod:rowan-navigate");
    const action = mode.find(b => b.keys === stroke)?.action;
    const rows = this.rows(), selected = rows.find(s => s.id === this.preview && s.machine === this.previewMachine), current = spaces().find(s => s.id === focused()?.space);
    const done = () => { cx.stop_propagation(); cx.notify(); };
    if (e.key === "escape" || prefixes.includes(stroke)) { this.close(); return done(); }
    if (action === "rowan-navigate.workspace-up" || action === "rowan-navigate.workspace-down") {
      if (rows.length) { const i = rows.findIndex(s => s.id === this.preview && s.machine === this.previewMachine); const d = action.endsWith("up") ? -1 : 1; const next = rows[(i < 0 ? (d < 0 ? rows.length - 1 : 0) : (i + d + rows.length) % rows.length)]; this.preview = next.id; this.previewMachine = next.machine; this.notice = ""; }
      return done();
    }
    if (e.key === "enter" && !e.modifiers?.control && !e.modifiers?.alt && !e.modifiers?.platform) {
      if (this.valid(selected)) { this.close(); run("space.select", {id: selected.id}); }
      else this.notice = "Workspace is no longer available";
      return done();
    }
    if (!this.valid(selected) || !current || selected.machine !== current.machine) {
      if (stroke === "ctrl-[") this.close(); else this.notice = "Confirm workspace first — press Enter";
      return done();
    }
    if (/^[1-9]$/.test(stroke)) {
      const target = rows.filter(s => s.machine === current.machine)[Number(stroke) - 1];
      if (this.valid(target)) { this.close(); run("space.select", {id: target.id}); }
      return done();
    }
    if (stroke === "tab" || stroke === "shift-tab") {
      this.close(); run("pane.cycle", {direction: stroke === "tab" ? "next" : "prev"}); return done();
    }
    const dir = action?.match(/^rowan-navigate\.pane-(left|right|up|down)$/)?.[1] || ({left: "left", right: "right"})[stroke];
    if (dir) { run("pane.go", {direction: dir}); this.handle.focus(); return done(); }
    const binding = normal.find(b => prefixes.some(prefix => b.keys === `${prefix} ${stroke}`));
    if (binding) { this.close(); run("legacy.key", {keys: binding.keys, space: selected.id}); }
    else if (stroke === "ctrl-[") this.close();
    return done();
  }
  render() {
    const t = theme(), scope = shared("rowan.sidebar.scope"), rows = this.rows();
    return v_flex().id("legacy-navigate").track_focus(this.handle).size_full().min_h(0).bg(t.popover).border_1().border_color(t.border).text_size(13)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().h(40).px(14).items_center().text_color(t.foreground).child("Navigate — Enter to select · Esc to cancel"))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().children(rows.map((s, i) => h_flex().id(`navigate-${s.id}`).h(30).px(14).items_center().cursor_pointer().when(s.id === this.preview && s.machine === this.previewMachine, el => el.bg(t.selected)).on_click((_e, cx) => { this.preview = s.id; this.previewMachine = s.machine; cx.notify(); }).child(`${i < 9 ? i + 1 : " "}  ${scope?.labels?.[s.id] ?? s.name}  ·  ${s.machine ?? "Local"}`))))
      .child(div().px(14).py(8).text_color(t.dim).child(this.notice || "Move workspace · arrows move panes · Tab cycles panes"));
  }
}
