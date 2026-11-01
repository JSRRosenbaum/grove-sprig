const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Execute the real picker with only native host imports replaced.
function host() {
  let scope;
  let world = [];
  let machineList = [];
  let keyHandler;
  const calls = [];
  const element = () => {
    const el = new Proxy({}, { get(_target, name) {
      if (name === "on_key_down") return callback => { keyHandler = callback; return el; };
      return () => el;
    } });
    return el;
  };
  const sandbox = {
    View: class {}, div: element, svg: element, v_flex: element, h_flex: element,
    Input: { new: element }, InputState: {},
    spaces: () => world, machines: () => machineList, agents: () => [], terminals: () => [],
    shared: key => key === "rowan.sidebar.scope" ? scope : undefined,
    setShared() {}, theme: () => ({}), props: () => ({overlay: "picker"}),
    closeOverlay: id => calls.push({name: "closeOverlay", id}),
    run: (name, args) => calls.push({name, args}),
  };
  const source = fs.readFileSync(path.join(__dirname, "main.js"), "utf8")
    .replace(/^import .*;\n/gm, "").replace("export default class Picker", "class Picker");
  vm.runInNewContext(`${source}\nglobalThis.Picker = Picker;`, sandbox);
  const picker = new sandbox.Picker();
  Object.assign(picker, {filter: "", showEarlier: true, at: 0, handle: {}, input: {}});
  return {
    picker, calls,
    setScope(value) { scope = value; },
    setWorld(value) { world = value; },
    setMachines(value) { machineList = value; },
    key(key, modifiers = {}) { keyHandler({key, modifiers}, {stop_propagation() {}, notify() {}}); },
  };
}

const a = {id: "a", name: "A", machine: "local", status: "working", tabs: [{id: "tab-a", name: "A tab"}]};
const b = {id: "b", name: "B", machine: "remote", status: "working", tabs: [{id: "tab-b", name: "B tab"}]};

test("picker lists only scoped ready spaces, and fails closed without a scope", () => {
  const h = host();
  h.setWorld([a, b]);
  h.setMachines([{name: "local", layout: "ready"}, {name: "remote", layout: "ready"}]);
  assert.equal(h.picker.rows().length, 0);
  h.setScope({spaceIds: ["a"]});
  assert.deepEqual(Array.from(h.picker.rows().filter(r => r.kind === "ctx"), r => r.ctx.id), ["tab-a"]);
  h.setScope({spaceIds: ["a", "b"]});
  h.setMachines([{name: "local", layout: "ready"}, {name: "remote", layout: "unavailable"}]);
  assert.deepEqual(Array.from(h.picker.rows().filter(r => r.kind === "ctx"), r => r.ctx.id), ["tab-a"]);
});

test("selection revalidates scope, readiness, and tab identity at invocation", () => {
  const h = host();
  h.setWorld([a, b]);
  h.setMachines([{name: "local", layout: "ready"}, {name: "remote", layout: "ready"}]);
  h.setScope({spaceIds: ["a"]});
  const row = h.picker.rows().find(r => r.kind === "ctx");
  h.setScope({spaceIds: ["b"]});
  h.picker.go(row);
  h.setScope({spaceIds: ["a"]});
  h.setMachines([{name: "local", layout: "unavailable"}]);
  h.picker.go(row);
  h.setMachines([{name: "local", layout: "ready"}]);
  h.setWorld([{...a, tabs: []}]);
  h.picker.go(row);
  assert.equal(h.calls.length, 0);
  h.setWorld([a]);
  h.picker.go(row);
  assert.equal(h.calls[0].name, "closeOverlay");
  assert.equal(h.calls[1].name, "tab.select");
  assert.equal(h.calls[1].args.id, "tab-a");
});

test("Ctrl+D cannot close a row after its scope or tab becomes stale", () => {
  const h = host();
  h.setWorld([a]);
  h.setMachines([{name: "local", layout: "ready"}]);
  h.setScope({spaceIds: ["a"]});
  h.picker.render();
  h.setScope({spaceIds: []});
  h.key("d", {control: true});
  assert.equal(h.calls.length, 0);
  h.setScope({spaceIds: ["a"]});
  h.setWorld([{...a, tabs: []}]);
  h.key("d", {control: true});
  assert.equal(h.calls.length, 0);
  h.setWorld([a]);
  h.key("d", {control: true});
  assert.equal(h.calls[0].name, "closeOverlay");
  assert.equal(h.calls[1].name, "tab.close");
  assert.equal(h.calls[1].args.id, "tab-a");
});
