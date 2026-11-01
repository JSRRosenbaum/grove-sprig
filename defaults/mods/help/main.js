// The keybind list (Herdr's prefix+?), grouped, filterable by typing.
// Reads keys.json through keys(); edit keys.json to change any of them.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { keys, props, closeOverlay, theme, window } from "herdr";

const GROUPS = ["herds", "workspaces", "tabs", "panes", "agents", "terminal", "window", "mods"];

export function shortcut(value) {
  const names = {ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Cmd", space: "Space",
    escape: "Esc", left: "←", right: "→", up: "↑", down: "↓",
    pageup: "Page Up", pagedown: "Page Down"};
  return value.split(" ").map(stroke => stroke.split("-").map(part =>
    names[part] || (part.length === 1 ? part.toUpperCase() : part)).join("+")).join(" then ");
}

export function describe(action) {
  const unwrapped = action.startsWith("rowan-spaces.active:") ? action.slice(20) : action;
  const labels = {
    "rowan-spaces.herd-prev": ["herds", "Previous herd"],
    "rowan-spaces.herd-next": ["herds", "Next herd"],
    "rowan-spaces.herd-add": ["herds", "New herd"],
    "rowan-spaces.workspace-prev": ["workspaces", "Previous workspace"],
    "rowan-spaces.workspace-next": ["workspaces", "Next workspace"],
    "rowan-agents.agent-prev": ["agents", "Previous agent"],
    "rowan-agents.agent-next": ["agents", "Next agent"],
    "app.help": ["window", "Show keybinds"],
    "app.settings": ["window", "Open settings"],
    "window.close": ["window", "Detach this window"],
    "mod.open:rowan-picker": ["workspaces", "Choose workspace"],
    "rowan-spaces.prefix-cancel": ["window", "Cancel prefix"],
  };
  if (labels[unwrapped]) return labels[unwrapped];
  const [name, ...args] = unwrapped.split(":");
  const arg = args.join(" ");
  if (name === "rowan-spaces.workspace-select") return ["workspaces", `Select workspace ${arg}`];
  if (name === "rowan-spaces.herd-select") return ["herds", `Select herd ${arg}`];
  if (name === "tab.move") return ["tabs", `Move tab ${arg}`];
  if (name === "tab.select") return ["tabs", `Select tab ${arg}`];
  if (name.startsWith("pane.")) {
    const verbs = {go: "Focus pane", swap: "Swap pane", split: "Split pane", close: "Close pane", zoom: "Zoom pane"};
    return ["panes", `${verbs[name.slice(5)] || name.replace(".", " ")}${arg ? ` ${arg}` : ""}`];
  }
  if (name.startsWith("tab.") || name.startsWith("space.")) {
    const subject = name.startsWith("tab.") ? "tab" : "workspace";
    const verbs = {new: "New", close: "Close", rename: "Rename", prev: "Previous", next: "Next"};
    const verb = name.split(".")[1];
    return [subject === "tab" ? "tabs" : "workspaces", `${verbs[verb] || verb} ${subject}${arg ? ` ${arg}` : ""}`];
  }
  if (name.startsWith("agent.")) return ["agents", `${name.slice(6)} agent${arg ? ` ${arg}` : ""}`];
  if (unwrapped.startsWith("send:")) return ["terminal", "Type " + JSON.stringify(unwrapped.slice(5))];
  if (name.startsWith("terminal.")) return ["terminal", `${name.slice(9).replace(/[._]/g, " ")}${arg ? ` ${arg}` : ""}`];
  return [name.startsWith("rowan-") ? "mods" : "window", `${name.replace(/[._]/g, " ")}${arg ? ` ${arg}` : ""}`];
}

// Terminal is the deepest normal workflow context; mod bindings apply only
// inside their own mod and are listed separately, not as terminal bindings.
export function effectiveBindings(bindings, layoutName) {
  const priority = section => section === "terminal" ? 2 : section.startsWith("layout:") ? 1 : 0;
  const normal = bindings.filter(k => k.section === "global" || k.section === "terminal" ||
    (layoutName && k.section === `layout:${layoutName}`));
  const winners = new Map();
  for (const k of normal) {
    const previous = winners.get(k.keys);
    if (!previous || priority(k.section) > priority(previous.section)) winners.set(k.keys, k);
  }
  return [...winners.values(), ...bindings.filter(k => k.section.startsWith("mod:"))]
    .filter(k => k.action !== "terminal");
}

export default class Help extends View {
  init(_props, cx) {
    this.filter = "";
    this.input = InputState.new({ placeholder: "Type to filter…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  render(cx) {
    const t = theme();
    const f = this.filter.toLowerCase();
    const layoutName = window()?.layout_name;
    const all = effectiveBindings(keys(), layoutName).map(k => ({
      ...k, group: describe(k.action)[0],
      label: k.action === "rowan-spaces.prefix-cancel" && !k.keys.includes(" ") ? "Prefix" : describe(k.action)[1],
      shortcut: shortcut(k.keys),
    })).filter(k => !f || `${k.keys} ${k.shortcut} ${k.label} ${k.action} ${k.section}`.toLowerCase().includes(f));
    const groups = GROUPS.map(name => [name, all.filter(k => k.group === name)])
      .filter(([, rows]) => rows.length > 0);
    return v_flex()
      .id("help")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") return closeOverlay(props().overlay);
      })
      .size_full()
      .min_h(0)
      .p(18)
      .gap(14)
      .bg(t.popover)
      .text_size(12)
      .child(
        h_flex()
          .h(22)
          .items_center()
          .justify_between()
          .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Keybinds"))
          .child(div().text_size(11).text_color(t.dim).child("Esc")),
      )
      .when(!layoutName, e => e.child(div().text_color(t.dim).child("Layout unavailable; layout-specific shortcuts are not shown.")))
      .child(Input.new(this.input).h(36).flex_none().px(10).rounded(9).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .py(2)
          .gap(10)
          .children(
            groups.map(([name, rows]) =>
              v_flex()
                .gap(2)
                .child(div().text_size(11.5).font_medium().text_color(t.dim).child(name))
                .children(
                  rows.map((k) =>
                    h_flex()
                      .h(32)
                      .px(8)
                      .rounded(7)
                      .items_center()
                      .child(div().w(220).flex_none().text_color(t.accent).child(k.shortcut))
                      .child(div().text_color(t.foreground).child(k.label + (k.section.startsWith("mod:") ? ` (in ${k.section.slice(4)} mod)` : k.section === "terminal" ? " (terminal)" : ""))),
                  ),
                ),
            ),
          ),
      );
  }
}
