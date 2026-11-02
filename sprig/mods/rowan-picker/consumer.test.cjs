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
  const elements = [];
  const element = () => {
    const node = {};
    const el = new Proxy(node, { get(target, name) {
      if (name === "on_key_down") return callback => { keyHandler = callback; return el; };
      return (...args) => {
        if (name === "id") target.id = args[0];
        else if (name === "when" && args[0]) args[1](el);
        else if (name === "top" || name === "bottom") target[name] = args[0];
        else if (name === "on_scroll_wheel" || name === "on_size_change") target[name] = args[0];
        return el;
      };
    } });
    elements.push(node);
    return el;
  };
  const sandbox = {
    View: class {}, div: element, svg: element, v_flex: element, h_flex: element,
    Input: { new: element }, InputState: {},
    spaces: () => world, machines: () => machineList, agents: () => [], terminals: () => [],
    shared: key => key === "rowan.sidebar.scope" ? scope : undefined,
    setShared() {}, theme: () => ({}), settings: () => ({zoom: 1}), props: () => ({overlay: "picker"}),
    closeOverlay: id => calls.push({name: "closeOverlay", id}),
    run: (name, args) => calls.push({name, args}),
  };
  const source = fs.readFileSync(path.join(__dirname, "main.js"), "utf8")
    .replace(/^import .*;\n/gm, "").replace("export default class Picker", "class Picker");
  vm.runInNewContext(`${source}\nglobalThis.Picker = Picker;`, sandbox);
  const picker = new sandbox.Picker();
  Object.assign(picker, {filter: "", showEarlier: true, at: 0, scroll: 0, handle: {}, input: {}});
  return {
    picker, calls,
    setScope(value) { scope = value; },
    setWorld(value) { world = value; },
    setMachines(value) { machineList = value; },
    render() { elements.length = 0; picker.render(); },
    node(id) { return elements.find(e => e.id === id); },
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

test("keyboard and wheel keep long herd picker selections in view", () => {
  const h = host();
  const tabs = Array.from({length: 20}, (_, i) => ({id: `tab-${i}`, name: `Tab ${i}`}));
  h.setWorld([{...a, tabs}]);
  h.setMachines([{name: "local", layout: "ready"}]);
  h.setScope({spaceIds: ["a"]});
  h.render();
  h.node("pk-list").on_size_change({height: 128}, {notify() {}});
  h.render();
  h.key("up");
  h.render();
  const selected = h.node("pk-tab-19");
  assert.ok(selected);
  assert.ok(selected.top >= 0 && selected.bottom >= 0);
  h.key("down");
  h.render();
  assert.ok(h.node("pk-tab-0"));
  h.node("pk-list").on_scroll_wheel({delta: {y: -64}}, {notify() {}});
  h.render();
  const current = h.node(`pk-tab-${h.picker.at}`);
  assert.ok(current);
  assert.ok(current.top >= 0 && current.bottom >= 0);
});
