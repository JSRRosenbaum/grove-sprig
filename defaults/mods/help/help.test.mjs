import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

async function setup(bindings, layout = 'rowan-terminal') {
  function el() {
    const state = {items: []}; let proxy;
    proxy = new Proxy(state, {get(t, p) {
      if (p === 'child') return x => { t.items.push(x); return proxy; };
      if (p === 'children') return xs => { t.items.push(...xs); return proxy; };
      if (p in t) return t[p];
      return () => proxy;
    }}); return proxy;
  }
  const context = vm.createContext({JSON, Set, Map, String, Object, Array});
  const modules = {
    'gpui-kit': {View: class {}, div: el},
    'gpui-base': {v_flex: el, h_flex: el, InputState: {new: () => ({on() {}, focus() {}, value() { return ''; }})}, Input: {new: el}},
    herdr: {keys: () => bindings, window: () => ({layout_name: layout}), props: () => ({}), closeOverlay() {}, theme: () => ({})},
  };
  const main = new vm.SourceTextModule(await readFile(new URL('./main.js', import.meta.url), 'utf8'), {context});
  await main.link(specifier => new vm.SyntheticModule(Object.keys(modules[specifier]), function () {
    for (const [name, value] of Object.entries(modules[specifier])) this.setExport(name, value);
  }, {context}));
  await main.evaluate();
  const help = new main.namespace.default();
  help.init({}, {timer: {after() {}}, focus_handle() {}});
  return {api: main.namespace, help};
}

const binding = (section, keys, action) => ({section, keys, action});
const text = node => typeof node === 'string' ? node : (node?.items || []).map(text).join(' ');

test('effective bindings respect layout and terminal precedence and retain scoped mod keys', async () => {
  const list = [binding('global', 'ctrl-x', 'tab.new'), binding('layout:rowan-terminal', 'ctrl-x', 'tab.close'),
    binding('terminal', 'ctrl-x', 'terminal'), binding('layout:other', 'alt-x', 'tab.new'),
    binding('global', 'ctrl-y', 'tab.new'), binding('layout:rowan-terminal', 'ctrl-y', 'tab.close'),
    binding('mod:editor', 'ctrl-y', 'editor.save')];
  const {api} = await setup(list);
  const rows = api.effectiveBindings(list, 'rowan-terminal');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].action, 'tab.close'); assert.equal(rows[1].section, 'mod:editor');
  const unknown = api.effectiveBindings(list, '');
  assert.equal(unknown.some(k => k.section.startsWith('layout:')), false);
});

test('guide shows readable guarded actions and filters both shortcut and action', async () => {
  const list = [binding('layout:rowan-terminal', 'ctrl-space alt-left', 'rowan-spaces.active:pane.go:left'),
    binding('layout:rowan-terminal', 'alt-shift-right', 'rowan-spaces.active:tab.move:right'),
    binding('mod:editor', 'ctrl-s', 'editor.save')];
  const {help} = await setup(list);
  const render = () => text(help.render({}));
  assert.match(render(), /Ctrl\+Space then Alt\+←/); assert.match(render(), /Focus pane left/);
  assert.match(render(), /Move tab right/); assert.match(render(), /in editor mod/);
  help.filter = 'move tab'; assert.match(render(), /Move tab right/); assert.doesNotMatch(render(), /Focus pane/);
  help.filter = 'ctrl+space'; assert.match(render(), /Focus pane left/); assert.doesNotMatch(render(), /Move tab/);
});
