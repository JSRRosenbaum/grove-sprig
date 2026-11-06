// Effective keybindings and legacy help navigation. Upstream Herdr: Apache-2.0.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { keys, window, props, closeOverlay, theme } from "herdr";

export function effective(bindings, layout) {
  const rank = s => s === "terminal" ? 2 : s === `layout:${layout}` ? 1 : s === "global" ? 0 : -1;
  const out = new Map();
  for (const b of bindings) if (rank(b.section) >= 0 && (!out.has(b.keys) || rank(b.section) > rank(out.get(b.keys).section))) out.set(b.keys, b);
  return [...out.values(), ...bindings.filter(b => b.section === "mod:rowan-navigate")].filter(b => b.action !== "terminal");
}
export function label(action) {
  const known = {"mod.open:rowan-navigate":"Navigate", "mod.open:rowan-goto":"Go to terminal or agent",
    "mod.open:rowan-help":"Keybinds", "legacy.prefix_cancel":"Cancel prefix",
    "rowan-navigate.workspace-up":"Previous workspace preview", "rowan-navigate.workspace-down":"Next workspace preview",
    "rowan-navigate.pane-left":"Focus pane left", "rowan-navigate.pane-right":"Focus pane right",
    "rowan-navigate.pane-up":"Focus pane up", "rowan-navigate.pane-down":"Focus pane down"};
  return known[action] ?? action.replace(/^rowan-spaces\.active:/, "").replace(/[.:_-]+/g, " ");
}
export default class Help extends View {
  init(_props, cx) {
    this.query = ""; this.searching = false; this.scroll = 0; this.handle = cx.focus_handle(); this.handle.focus();
    this.input = InputState.new({placeholder:"Search keybinds…"});
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); this.scroll = 0; cx.notify(); });
    this.input.on("submit", () => closeOverlay(props().overlay));
  }
  rows() { const q = this.query.toLowerCase(); return effective(keys(), window()?.layout_name).filter(b => `${b.keys} ${b.action} ${label(b.action)} ${b.section}`.toLowerCase().includes(q)); }
  key(e, cx) {
    const k = e.key, m = e.modifiers || {}, max = Math.max(0, this.rows().length - 10), done = () => { cx.stop_propagation(); cx.notify(); };
    if (this.searching) {
      if (k === "escape") { this.searching = false; this.input.set_value(""); this.query = ""; this.scroll = 0; this.handle.focus(); }
      else if (k === "enter") closeOverlay(props().overlay);
      else if (k === "up" || (m.control && k === "p")) this.scroll--;
      else if (k === "down" || (m.control && k === "n")) this.scroll++;
      else if (k === "pageup") this.scroll -= 8;
      else if (k === "pagedown") this.scroll += 8;
      else return;
    } else if (k === "escape" || k === "enter" || k === "?" || (k === "/" && m.shift)) closeOverlay(props().overlay);
    else if (k === "home") this.scroll = 0;
    else if (k === "end") this.scroll = max;
    else if (k === "up" || k === "k") this.scroll--;
    else if (k === "down" || k === "j") this.scroll++;
    else if (k === "pageup") this.scroll -= 8;
    else if (k === "pagedown") this.scroll += 8;
    else if (k === "/") { this.searching = true; this.scroll = 0; this.input.focus(); }
    this.scroll = Math.max(0, Math.min(max, this.scroll)); return done();
  }
  render() {
    const t = theme(), rows = this.rows(), max = Math.max(0, rows.length - 10); this.scroll = Math.max(0, Math.min(max, this.scroll));
    return v_flex().id("legacy-help").track_focus(this.handle).size_full().min_h(0).bg(t.popover).border_1().border_color(t.border).text_size(13)
      .on_key_down((e,cx) => this.key(e,cx))
      .child(div().h(36).px(14).text_color(t.foreground).child("Keybinds · / search · ? close"))
      .when(this.searching, el => el.child(Input.new(this.input).h(32).px(12).bg(t.background).text_color(t.foreground)))
      .child(v_flex().flex_1().min_h(0).children(rows.slice(this.scroll, this.scroll + 10).map(b => h_flex().h(32).px(14).gap(12).items_center().child(div().w(220).flex_none().text_color(t.accent).child(b.keys)).child(div().flex_1().truncate().text_color(t.foreground).child(`${label(b.action)}${b.section.startsWith("mod:") ? " (Navigate)" : ""}`)))))
      .child(div().px(14).py(6).text_color(t.dim).child(`${rows.length ? this.scroll + 1 : 0}–${Math.min(rows.length, this.scroll + 10)} / ${rows.length}`));
  }
}
