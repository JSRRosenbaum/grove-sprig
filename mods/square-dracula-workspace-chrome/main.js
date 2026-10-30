// Modified from Herdr 0.1.7 for Square Dracula.
// Upstream: https://github.com/herdrdev/herdr-app (Apache-2.0).

import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, openOverlay, nextCommand } from "herdr";

export default class WorkspaceChrome extends View {
  init(_props, cx) {
    cx.spawn(async cx => {
      for (;;) {
        await nextCommand();
        cx.notify();
        if (!this.footer) this.openPicker();
      }
    });
  }

  openPicker() {
    openOverlay({ mod: "square-dracula-picker", kind: "popup", frame: "none", at: "top", offset: 40, width: 640, height: 0.8 });
  }

  button(id, label, action) {
    const t = theme();
    return div().id(id).w(26).h_full().flex_none().flex().items_center().justify_center().text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }
  render() {
    this.footer = props()?.footer === true;

    const t = theme();
    const collapsed = shared("sidebar.collapsed") === true;
    const toggle = () => {
      setShared("sidebar.collapsed", !collapsed);
      run("layout.resize", { id: "sidebar", px: collapsed ? (shared("sidebar.width") ?? 268) : 44 });
    };
    if (this.footer) {
      const row = (id, icon, label, dim, action) => h_flex().id(id).h(34).px(16).gap(9).items_center()
        .text_color(dim ? t.dim : t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .on_click(action).child(svg(`mods/square-dracula-workspace-chrome/${icon}.svg`).size(14))
        .when(!collapsed, el => el.child(label));
      return v_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).pt(7).text_size(13)
        .child(row("settings", "settings", "Settings", false, () => run("app.settings"))
          .when(Boolean(updates().app.ready), el => el.child(div().size(6).rounded_full().bg(t.accent))))
        .child(row("machine", "plus", "Add machine", true, () => openOverlay({ mod: "square-dracula-machine-add", kind: "dialog", frame: "none", width: 560 })));
    }
    return h_flex().size_full().bg(t.chrome).items_center().text_size(13.5)
      .when(window()?.platform === "macos" && !collapsed, el => el.pl(76))
      .when(!collapsed, el => el.child(h_flex().flex_1().pl(14).gap(8).items_center().child(image("frame/welcome/herdr.png").size(20)).child(div().font_semibold().text_color(t.foreground).child("Herdr"))))
      .when(!collapsed, el => el.child(this.button("search", svg("mods/square-dracula-workspace-chrome/search.svg").size(15), () => this.openPicker())))
      .child(this.button("sidebar-toggle", svg("mods/square-dracula-workspace-chrome/sidebar.svg").size(15), toggle).when(collapsed, el => el.w_full()));
  }
}
