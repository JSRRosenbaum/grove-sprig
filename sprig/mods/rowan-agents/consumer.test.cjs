const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

// Execute the actual mod in a small host, replacing only its native imports.
function host(initial = {}) {
  const state = new Map(Object.entries(initial));
  let currentAgents = [];
  let focus = null;
  let resolveCommand;
  const calls = [];
  const deferred = [];
  const elements = [];
  function element() {
    const node = { childNodes: [], handlers: {} };
    const proxy = new Proxy(node, { get(target, key) {
      if (key in target) return target[key];
      return (...args) => {
        if (key === "id") target.id = args[0];
        else if (key === "child") target.childNodes.push(args[0]);
        else if (key === "children") target.childNodes.push(...args[0]);
        else if (key === "when") { if (args[0]) args[1](proxy); }
        else if (key === "on_click") target.handlers.click = args[0];
        else if (key === "text_size") target.fontSize = args[0];
        return proxy;
      };
    } });
    elements.push(node);
    return proxy;
  }
  const cx = { timer: { every() {} }, notify() {}, stop_propagation() {},
    spawn(fn) { if (fn.length) void fn(cx); else deferred.push(fn); } };
  const sandbox = {
    View: class {}, div: element, h_flex: element, v_flex: element, svg: element, image: element,
    props: () => null,
    shared: key => state.get(key),
    setShared: (key, value) => state.set(key, value),
    settings: () => ({ font_size: 15 }),
    theme: () => ({ chrome: "#000", border: "#111", dim: "#222", foreground: "#fff", hover: "#333" }),
    agents: () => currentAgents, terminals: () => [], panes: () => [], spaces: () => [],
    setAgentOrder: order => calls.push({ name: "setAgentOrder", order }),
    focused: () => focus,
    run: (name, args) => calls.push({ name, args }),
    nextCommand: () => new Promise(resolve => { resolveCommand = resolve; }),
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  let source = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
  source = source.replace(/^import .*;\n/gm, "").replace("export default class Agents", "class Agents");
  vm.runInNewContext(`${source}\nglobalThis.subject = { metadata, metadataLines, Agents };`, sandbox);
  const instance = new sandbox.subject.Agents();
  instance.init({}, cx);
  return {
    metadata: sandbox.subject.metadata, metadataLines: sandbox.subject.metadataLines, instance, calls, state,
    setScope(value) { state.set("rowan.sidebar.scope", value); },
    setAgents(value) { currentAgents = value; },
    setFocus(value) { focus = value; },
    render() { elements.length = 0; return instance.render(cx); },
    click(id) { elements.find(e => e.id === id).handlers.click({}, cx); },
    flush() { for (const fn of deferred.splice(0)) void fn(); },
    async command(value) {
      resolveCommand(value);
      // Resume the async command handler and its nextCommand registration.
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

const now = 1_800_000_000_000;
function terminal(overrides = {}) {
  const payload = { v: 1, pid: 123, session: "session-a", at: now, provider: "provider" };
  return {
    state: "live", report: { app: "omp" }, foreground: { pid: 123 },
    labels: { "rowan.omp": JSON.stringify(payload) }, ...overrides,
  };
}

test("metadata accepts only a fresh matching live OMP foreground", () => {
  const { metadata } = host();
  assert.equal(metadata(terminal(), now).provider, "provider");
  assert.equal(metadata(terminal({ foreground: { pid: 124 } }), now), null);
  assert.equal(metadata(terminal({ foreground: null }), now), null);
  assert.equal(metadata(terminal({ state: "finished" }), now), null);
  assert.equal(metadata(terminal({ report: { app: "bash" } }), now), null);
  assert.equal(metadata(terminal({ report: null }), now), null);
  assert.equal(metadata(terminal({ labels: { "rowan.omp": "{broken" } }), now), null);
  assert.equal(metadata(terminal({ labels: {} }), now), null);
  for (const payload of [
    { v: 1, pid: 123, session: "s", at: now - 600001 },
    { v: 1, pid: 123, session: "s", at: now + 30001 },
    { v: 1, pid: 123, session: "", at: now },
    { v: 2, pid: 123, session: "s", at: now },
    { v: 1, pid: "123", session: "s", at: now },
  ]) {
    assert.equal(metadata(terminal({ labels: { "rowan.omp": JSON.stringify(payload) } }), now), null);
  }
});

test("display lines keep provider, context and measured cache counts visible independently", () => {
  const { metadataLines } = host();
  assert.deepEqual(Array.from(metadataLines({
    provider: "openai", model: "long-model-name", context: 31.4, cacheRead: 3200, cacheWrite: 40,
  })), ["openai / long-model-name", "Context 31%", "Cache read 3200", "Cache write 40"]);
  assert.deepEqual(Array.from(metadataLines(null)), []);
  assert.deepEqual(Array.from(metadataLines({ provider: "p", context: null })), ["p"]);
});

test("agent navigation wraps only within current herd and revalidates stale order", async () => {
  const h = host();
  h.instance.order = ["t1", "t2", "remote/t3"];
  h.setAgents([{ address: "t1", space: "a" }, { address: "t2", space: "a" }, { address: "remote/t3", space: "b" }]);
  await h.command("agent-next");
  assert.equal(h.calls.length, 0); // no published scope
  h.setScope({ herd: "one", spaceIds: ["a"], labels: {} });
  h.setFocus({ agent: "t2" });
  await h.command("agent-next");
  assert.equal(h.calls.at(-1).name, "agent.focus");
  assert.equal(h.calls.at(-1).args.terminal, "t1");
  await h.command("agent-prev");
  assert.equal(h.calls.at(-1).args.terminal, "t1");
  h.setFocus({ agent: "remote/t3" });
  await h.command("agent-prev");
  assert.equal(h.calls.at(-1).args.terminal, "t2");
  h.setScope({ herd: "two", spaceIds: ["b"], labels: {} });
  await h.command("agent-next");
  assert.equal(h.calls.at(-1).args.terminal, "remote/t3");
  h.setAgents([{ address: "t1", space: "a" }]);
  const before = h.calls.length;
  await h.command("agent-next");
  assert.equal(h.calls.length, before);
});

test("panel defaults collapsed, persists clicks and commands, and reapplies on reload", async () => {
  const h = host();
  h.render();
  assert.equal(h.instance.panelCollapsed(), true);
  h.click("agents-panel-toggle");
  assert.equal(h.state.get("rowan.agents.collapsed"), false);
  h.render();
  h.click("agents-panel-toggle");
  assert.equal(h.state.get("rowan.agents.collapsed"), true);
  await h.command("rowan-agents.panel-expand");
  assert.equal(h.state.get("rowan.agents.collapsed"), false);
  const reloaded = host(Object.fromEntries(h.state));
  reloaded.render();
  reloaded.flush();
  assert.equal(reloaded.calls.at(-1).name, "layout.resize");
  assert.equal(reloaded.calls.at(-1).args.weight, 1);
  await h.command("panel-collapse");
  assert.equal(h.state.get("rowan.agents.collapsed"), true);
  await h.command("panel-toggle");
  assert.equal(h.state.get("rowan.agents.collapsed"), false);
});

test("deferred panel sizing honors the last requested state", async () => {
  const h = host();
  await h.command("panel-expand");
  await h.command("panel-collapse");
  h.flush();
  const sizes = h.calls.filter(call => call.name === "layout.resize");
  assert.equal(sizes.length, 1);
  assert.equal(sizes[0].args.id, "agents");
  assert.equal(sizes[0].args.px, 28);
  await h.command("panel-expand");
  h.flush();
  assert.equal(h.calls.at(-1).args.weight, 1);
});

test("collapsed render updates navigation order for the current herd", async () => {
  const h = host({ "rowan.sidebar.scope": { spaceIds: ["a"], labels: {} } });
  h.setAgents([
    { address: "t1", space: "a", status: "working", seq: 1 },
    { address: "t2", space: "a", status: "blocked", seq: 2 },
    { address: "t3", space: "b", status: "blocked", seq: 3 },
  ]);
  h.render();
  assert.deepEqual(Array.from(h.instance.order), ["t2", "t1"]);
  h.setFocus({ agent: "t2" });
  await h.command("agent-next");
  assert.equal(h.calls.at(-1).args.terminal, "t1");
});

test("panel consumes published font metrics and falls back to terminal size", () => {
  const h = host();
  h.render();
  assert.equal(h.instance.fontSize, 12);
  h.state.set("rowan.sidebar.metrics", { fontSize: 18, ratio: 1.2, rowHeight: 30 });
  h.render();
  assert.equal(h.instance.fontSize, 18);
  assert.ok(h.instance.rowHeight(26) >= 30);
});
