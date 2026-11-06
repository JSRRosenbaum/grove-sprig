// Empty/unavailable herd presentation. Underlying core programs keep running.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { shared, theme } from "herdr";

export default class EmptyHerd extends View {
  render() {
    const scope = shared("rowan.sidebar.scope");
    const t = theme();
    const message = !scope ? "Loading sidebar…" : scope.empty
      ? "This herd has no workspaces."
      : "Select an available workspace in this herd.";
    return v_flex().size_full().items_center().justify_center().gap(12)
      .bg(t.background).text_color(t.muted).text_size(13)
      .child(div().child(message))
      .child(div().text_color(t.dim).child("Existing programs are still running. No terminal is active here."));
  }
}
