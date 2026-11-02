const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

// Execute the actual mod in a small host, replacing only its native imports.
function host(initial = {}, storage = new Map(), backend = {}) {
  const state = new Map(Object.entries(initial));
  let currentAgents = [];
  let currentTerminals = [];
  let focusCount = 0;
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
        else if (key === "on_key_down") target.handlers.key = args[0];
        else if (key === "on_hover") target.handlers.hover = args[0];
        else if (key === "text_size") target.fontSize = args[0];
        return proxy;
      };
    } });
    elements.push(node);
    return proxy;
  }
  const cx = { timer: { every() {} }, notify() {}, stop_propagation() {},
    focus_handle() { return { focus() { focusCount++; } }; },
    spawn(fn) { if (fn.length) void fn(cx); else deferred.push(fn); } };
  const sandbox = {
    View: class {}, div: element, h_flex: element, v_flex: element, svg: element, image: element,
    props: () => null,
    shared: key => state.get(key),
    setShared: (key, value) => state.set(key, value),
    settings: () => ({ font_size: 15 }),
    theme: () => ({ chrome: "#000", border: "#111", dim: "#222", foreground: "#fff", hover: "#333" }),
    agents: () => backend.agents ?? currentAgents, terminals: () => backend.terminals ?? currentTerminals, panes: () => [], spaces: () => [],
    setAgentOrder: order => calls.push({ name: "setAgentOrder", order }),
    focused: () => focus,
    run: (name, args) => { calls.push({ name, args }); backend.run?.(name, args); },
    nextCommand: () => new Promise(resolve => { resolveCommand = resolve; }),
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
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
    setTerminals(value) { currentTerminals = value; },
    focusCount() { return focusCount; },
    setFocus(value) { focus = value; },
    render() { elements.length = 0; return instance.render(cx); },
    click(id) { elements.find(e => e.id === id).handlers.click({}, cx); },
    hover(id) { elements.find(e => e.id === id).handlers.hover(true, cx); },
    key(key) { elements.find(e => e.handlers.key).handlers.key({ key }, cx); },
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

test("shared pins and unpins propagate between panel clients", async () => {
  const scope = { spaceIds: ["a"], labels: {} };
  const backend = {
    agents: [
      { address: "t1", space: "a", pane: "p1", status: "idle", seq: 1, pinned: false },
      { address: "t2", space: "a", pane: "p2", status: "idle", seq: 2, pinned: false },
    ],
    terminals: [{ address: "t1", state: "live", labels: {} }, { address: "t2", state: "live", labels: {} }],
    run(name, args) {
      if (name !== "terminal.pin") return;
      this.agents.find(a => a.address === args.terminal).pinned = args.pinned;
      const labels = this.terminals.find(t => t.address === args.terminal).labels;
      labels["herdr.pin-migrated"] = "1";
      if (args.pinned) labels["herdr.pinned"] = "1";
      else delete labels["herdr.pinned"];
    },
  };
  const one = host({ "rowan.sidebar.scope": scope, "rowan.agents.collapsed": false }, new Map(), backend);
  const two = host({ "rowan.sidebar.scope": scope, "rowan.agents.collapsed": false }, new Map(), backend);
  one.render();
  one.hover("ag-t1");
  one.render();
  one.click("pin-t1");
  two.render();
  assert.equal(two.instance.order[0], "t1");
  two.hover("ag-t1");
  two.render();
  two.click("pin-t1");
  one.render();
  assert.equal(backend.agents[0].pinned, false);
  assert.equal(one.instance.order[0], "t2");
});

test("legacy pins wait for matching live agents and never override a shared decision", () => {
  const storage = new Map([["pins", JSON.stringify(["local", "remote/offline", "other"])]]);
  const h = host({ "rowan.sidebar.scope": { spaceIds: ["a"], labels: {} } }, storage);
  h.setAgents([{ address: "local", space: "a", status: "idle", seq: 1 },
    { address: "other", space: "a", status: "idle", seq: 2 }]);
  h.setTerminals([{ address: "local", state: "live", labels: {} },
    { address: "other", state: "live", labels: { "herdr.pin-migrated": "1" } },
    { address: "remote/offline", state: "finished", labels: {} }]);
  h.render();
  assert.deepEqual(h.calls.filter(c => c.name === "terminal.pin").map(c => c.args.terminal), ["local"]);
  assert.deepEqual(JSON.parse(storage.get("pins")), ["local", "remote/offline"]);
  h.render();
  assert.equal(h.calls.filter(c => c.name === "terminal.pin").length, 1);
  h.setTerminals([{ address: "local", state: "live", labels: { "herdr.pin-migrated": "1", "herdr.pinned": "1" } },
    { address: "remote/offline", state: "live", labels: {} }]);
  h.render(); // a live terminal alone is not a listed agent
  assert.deepEqual(JSON.parse(storage.get("pins")), ["remote/offline"]);
  h.setAgents([{ address: "remote/offline", space: "b", status: "idle", seq: 1 }]);
  h.render();
  assert.equal(h.calls.filter(c => c.name === "terminal.pin").at(-1).args.terminal, "remote/offline");
  h.setTerminals([{ address: "remote/offline", state: "live", labels: { "herdr.pin-migrated": "1" } }]);
  h.render();
  assert.equal(storage.has("pins"), false);
});

test("focus command restores keyboard focus and keyboard actions remain herd-scoped", async () => {
  const h = host({ "rowan.sidebar.scope": { spaceIds: ["a"], labels: {} }, "rowan.agents.collapsed": false });
  h.setAgents([
    { address: "t1", space: "a", pane: "p1", status: "idle", seq: 1 },
    { address: "t2", space: "a", pane: "p2", status: "idle", seq: 2 },
    { address: "t3", space: "b", pane: "p3", status: "idle", seq: 3 },
  ]);
  h.render();
  await h.command("focus");
  assert.equal(h.focusCount(), 1);
  h.key("down");
  h.key("p");
  assert.equal(h.calls.at(-1).name, "terminal.pin");
  assert.equal(h.calls.at(-1).args.terminal, "t2");
  h.key("down");
  h.key("enter");
  assert.equal(h.calls.at(-1).name, "pane.focus");
  assert.equal(h.calls.at(-1).args.pane, "p1");
  await h.command("focus");
  assert.equal(h.focusCount(), 2);
  h.key("right");
  assert.equal(h.calls.at(-1).name, "pane.go");
  assert.equal(h.calls.at(-1).args.direction, "right");
  h.setScope({ spaceIds: ["b"], labels: {} });
  h.key("down");
  h.key("enter");
  assert.notEqual(h.calls.at(-1).args.pane, "p1");
});
