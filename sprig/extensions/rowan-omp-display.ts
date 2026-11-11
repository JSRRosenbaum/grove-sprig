// Display-only metadata for rowan-agents. This is separate from Herdr's managed
// lifecycle hook: it never reports status, changes keep, or touches a transcript.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
const exec = promisify(execFile);
const address = process.env.HC_TERMINAL_ID;
const enabled = !!address && !!process.env.HC_TERMINAL_SOCKET && process.env.OMPCODE !== "1";
const label = "rowan.omp";
const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 120) || undefined : undefined;
const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;

export default function (pi: ExtensionAPI) {
  if (!enabled) return;
  let queue = Promise.resolve();
  let cache: { cacheRead?: number; cacheWrite?: number } = {};
  let session = "";

  function publish(ctx: ExtensionContext) {
    if (ctx.agent?.kind !== "main" || !ctx.hasUI || ctx.mode !== "tui") return;
    const id = text(ctx.sessionManager?.getSessionId?.());
    if (!id) return;
    if (id !== session) { session = id; cache = {}; }
    const usage = ctx.getContextUsage?.();
    const payload = {
      v: 1, pid: process.pid, session: id, at: Date.now(),
      title: text(pi.getSessionName?.()),
      provider: text(ctx.model?.provider), model: text(ctx.model?.id),
      context: count(usage?.percent), ...cache,
    };
    queue = queue.then(async () => {
      try {
        // HC_TERMINAL_ID is local to this core, even when this core is remote
        // from the app. An inherited ID alone is not proof of ownership.
        const result = await exec("hc", ["get", address!, "--json"], { timeout: 3000, maxBuffer: 1024 * 1024 });
        const terminal = JSON.parse(result.stdout);
        if (terminal.address !== address || terminal.state !== "live" || terminal.foreground?.pid !== process.pid) return;
        await exec("hc", ["label", address!, `${label}=${JSON.stringify(payload)}`], { timeout: 3000 });
      } catch { /* Core unavailable: leave old data to expire. */ }
    });
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.agent?.kind !== "main" || !ctx.hasUI || ctx.mode !== "tui") return;
    publish(ctx);
    // Foreground discovery can lag startup; one bounded retry, not polling.
    const timer = setTimeout(() => publish(ctx), 1500);
    timer.unref?.();
  });
  pi.on("session_switch", (_event, ctx) => publish(ctx));
  pi.on("session_branch", (_event, ctx) => publish(ctx));
  pi.on("session_tree", (_event, ctx) => publish(ctx));
  pi.on("session_compact", (_event, ctx) => publish(ctx));
  pi.on("agent_start", (_event, ctx) => publish(ctx));
  pi.on("agent_end", (_event, ctx) => publish(ctx));
  pi.on("turn_end", (event, ctx) => {
    if (ctx.agent?.kind !== "main") return;
    const usage = event.message?.role === "assistant" ? event.message.usage : undefined;
    cache = usage ? { cacheRead: count(usage.cacheRead), cacheWrite: count(usage.cacheWrite) } : {};
    publish(ctx);
  });
}
