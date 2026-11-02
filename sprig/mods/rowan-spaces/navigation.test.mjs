import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

// Exercise the real mod class with only its host APIs replaced; no live app or core.
async function setup() {
  const saved = new Map(), calls = [], values = new Map();
  const world = {spaces: [], panes: [], machines: [{name: null, layout: 'ready'}], focus: null, settings: {font_size: 15, zoom: 1}, keys: [], layout: 'rowan-terminal'};
  const localStorage = {getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v)};
  // Every fluent element call returns the same object, including conditional children.
  function el() {
    const state = {items: [], idValue: null};
    let proxy;
    proxy = new Proxy(state, {get(t, p) {
      if (p === 'child') return x => { t.items.push(x); return proxy; };
      if (p === 'children') return xs => { t.items.push(...xs); return proxy; };
      if (p === 'when') return (yes, fn) => { if (yes) fn(proxy); return proxy; };
      if (p === 'id') return x => { t.idValue = x; return proxy; };
      if (p === 'tooltip') return x => { t.hint = x; return proxy; };
      if (p === 'on_click') return x => { t.click = x; return proxy; };
      if (p in t) return t[p];
      return () => proxy;
    }});
    return proxy;
  }
  const context = vm.createContext({localStorage, console, Date, JSON, Set, Map, Object, Array, Math, Number, String, RegExp, encodeURIComponent, decodeURIComponent});
  const modules = {
    'gpui-kit': {View: class {}, div: el, svg: el},
    'gpui-base': {v_flex: el, h_flex: el},
    herdr: {
      spaces: () => world.spaces, panes: () => world.panes, machines: () => world.machines,
      settings: () => world.settings,
      focused: () => world.focus, run: (name, args) => {
        calls.push({name, args});
        if (name === 'space.move') {
          const from = world.spaces.findIndex(s => s.id === args.id);
          const [moving] = world.spaces.splice(from, 1);
          world.spaces.splice(args.index - 1, 0, moving);
        }
      },
      shared: key => values.get(key), setShared: (key, value) => values.set(key, value),
      theme: () => ({dim: 'dim', foreground: 'fg', selected: 'selected', hover: 'hover', chrome: 'chrome', unknown: 'unknown'}),
      window: () => ({active: false, layout_name: world.layout}), keys: () => world.keys, openOverlay() {}, exec() {}, hc() {}, watchFolder() {}, nextCommand() {},
    },
  };
  const source = await readFile(new URL('./main.js', import.meta.url), 'utf8');
  const main = new vm.SourceTextModule(source, {context});
  await main.link(specifier => {
    const exports = modules[specifier];
    if (!exports) throw new Error(`Unexpected import ${specifier}`);
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, {context});
  });
  await main.evaluate();
  const create = () => {
    const instance = new main.namespace.default();
    instance.init({}, {timer: {every() {}}, spawn() {}, notify() {}});
    return instance;
  };
  const mod = create();
  return {mod, create, world, saved, calls, values};
}

const space = (id, machine = null) => ({id, machine, name: id, folder: `/${id}`, tabs: [{id: `${id}-tab`}], status: null, active: false});
const repo = (machine, dir) => JSON.stringify([machine, dir]);
const git = (machine, folder, common, linked = false) => ({key: JSON.stringify([machine, folder]), value: {repo: repo(machine, common), name: 'project', linked}});

test('tab reordering uses the live focused tab and adjacent index only', async () => {
  const {mod, world, calls} = await setup();
  const s = space('a'); s.tabs.push({id: 'second'}, {id: 'third'});
  world.spaces = [s]; mod.inventory(world.spaces);
  world.focus = {space: 'a', tab: 'second'};
  mod.command('active:tab.move:left'); mod.command('active:tab.move:right');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, 'tab.move'); assert.equal(calls[0].args.id, 'second'); assert.equal(calls[0].args.index, 1);
  assert.equal(calls[1].args.id, 'second'); assert.equal(calls[1].args.index, 3);
  calls.length = 0;
  world.focus.tab = 'a-tab'; mod.command('active:tab.move:left');
  world.focus.tab = 'third'; mod.command('active:tab.move:right');
  world.focus.tab = 'stale'; mod.command('active:tab.move:left');
  world.focus.tab = 'second'; world.machines[0].layout = 'unavailable'; mod.command('active:tab.move:left');
  world.machines[0].layout = 'ready'; mod.command('herd-add'); mod.command('active:tab.move:left');
  assert.equal(calls.length, 0);
});

test('help button stays discoverable in compact mode and uses an effective hint', async () => {
  const {mod, world, values, calls} = await setup();
  world.keys = [
    {section: 'global', keys: 'ctrl-h', action: 'app.help'},
    {section: 'layout:rowan-terminal', keys: 'ctrl-h', action: 'tab.new'},
    {section: 'layout:rowan-terminal', keys: 'ctrl-space f', action: 'app.help'},
    {section: 'layout:other', keys: 'alt-h', action: 'app.help'},
  ];
  const find = (node, id) => node?.idValue === id ? node : node?.items?.map(x => find(x, id)).find(Boolean);
  for (const compact of [false, true]) {
    values.set('sidebar.collapsed', compact);
    const root = mod.render({spawn: fn => fn()});
    const button = find(root, 'sidebar-help-button');
    assert.equal(button.hint, 'Keybinds (ctrl-space f)');
    assert.equal(button.items[0], compact ? '?' : 'Keys');
    button.click(); assert.equal(calls.at(-1).name, 'app.help');
    assert.equal(Boolean(find(root, 'sidebar-font-controls')), !compact);
  }
});

 test('navigation stays in herd and includes folded machine and repository children', async () => {
  const {mod, world, calls} = await setup();
  const a = space('a'), b = space('b'), remote = space('remote', 'ash');
  world.spaces = [a, b, remote];
  world.machines.push({name: 'ash', layout: 'ready'});
  mod.machines = [{id: 'ash-id', name: 'ash'}]; mod.inventory(world.spaces);
  const ga = git(null, a.folder, '/project/.git'), gb = git(null, b.folder, '/project/.git', true);
  mod.git[ga.key] = ga.value; mod.git[gb.key] = gb.value;
  mod.shown = new Set(world.spaces.map(s => s.id));
  mod.command('herd-add'); mod.command('machine-move:ash:1'); mod.command('herd-select:0');
  mod.command('machine-toggle:%40local'); mod.command(`repo-toggle:${encodeURIComponent(ga.value.repo)}`);
  world.focus = {space: 'a', tab: 'a-tab', pane: null}; calls.length = 0;
  mod.command('workspace-next');
  assert.equal(calls[0].name, 'space.select'); assert.equal(calls[0].args.id, 'b');
  world.focus = {space: 'b', tab: 'b-tab', pane: null}; calls.length = 0;
  mod.command('workspace-next'); assert.equal(calls[0].args.id, 'a');
});

test('empty herd persists and neither switching nor navigation focuses another target', async () => {
  const {mod, world, calls, saved} = await setup();
  world.spaces = [space('a')]; mod.inventory(world.spaces);
  world.focus = {space: 'a', tab: 'a-tab', pane: null};
  mod.command('herd-add'); mod.command('workspace-next');
  assert.equal(calls.length, 0);
  const stored = JSON.parse(saved.get('rowan.state'));
  assert.equal(stored.active, 1); assert.equal(stored.herds[1].members.length, 0);
});

test('labels survive reorder and reload', async () => {
  const {mod, create, world, saved} = await setup();
  const a = space('a'), b = space('b');
  world.spaces = [a, b]; mod.inventory(world.spaces);
  const first = mod.label(a), second = mod.label(b);
  world.spaces.reverse(); mod.inventory(world.spaces);
  assert.equal(mod.label(a), first); assert.equal(mod.label(b), second); assert.notEqual(first, second);
  const reloaded = create();
  assert.equal(reloaded.label(a), first); assert.equal(reloaded.label(b), second);
  const stored = JSON.parse(saved.get('rowan.state'));
  assert.equal(stored.labels[mod.spaceKey(a)], first); assert.equal(stored.labels[mod.spaceKey(b)], second);
});

test('identical repository paths on distinct profiles remain separate', async () => {
  const {mod, world} = await setup();
  const a = space('a', 'ash'), b = space('b', 'ash-other');
  world.spaces = [a, b]; world.machines.push({name: 'ash', layout: 'ready'}, {name: 'ash-other', layout: 'ready'});
  mod.machines = [{id: 'one', name: 'ash'}, {id: 'two', name: 'ash-other'}]; mod.inventory(world.spaces);
  const ga = git('ash', a.folder, '/same/.git'), gb = git('ash-other', b.folder, '/same/.git');
  mod.git[ga.key] = ga.value; mod.git[gb.key] = gb.value; mod.shown = new Set(['a', 'b']);
  const rows = mod.ordered(); assert.equal(rows.length, 2); assert.notEqual(rows[0].g.repo, rows[1].g.repo);
  mod.command(`repo-toggle:${encodeURIComponent(ga.value.repo)}`);
  assert.equal(mod.repoFolded.has(ga.value.repo), true); assert.equal(mod.repoFolded.has(gb.value.repo), false);
});

test('switching back restores the exact still-live tab and pane', async () => {
  const {mod, world, calls, saved} = await setup();
  const a = space('a'); a.tabs.push({id: 'a-tab-2'});
  world.spaces = [a]; world.panes = [{tab: 'a-tab-2', pane: 'pane-2'}];
  world.focus = {space: 'a', tab: 'a-tab-2', pane: 'pane-2'};
  mod.inventory(world.spaces); mod.remember(world.spaces, world.panes);
  mod.command('herd-add'); calls.length = 0; mod.command('herd-select:0');
  assert.equal(calls.map(c => c.name).join(','), 'space.select,tab.select,pane.focus');
  assert.equal(calls[0].args.id, 'a'); assert.equal(calls[1].args.id, 'a-tab-2'); assert.equal(calls[2].args.pane, 'pane-2');
  const last = JSON.parse(saved.get('rowan.state')).herds[0].last;
  assert.equal(last.space, 'a'); assert.equal(last.tab, 'a-tab-2'); assert.equal(last.pane, 'pane-2');
});

test('new populated herd selects only a ready member; unavailable members never focus', async () => {
  const {mod, world, calls, values} = await setup();
  const local = space('local'), remote = space('ash/remote', 'ash');
  world.spaces = [local, remote];
  world.machines.push({name: 'ash', layout: 'ready'});
  mod.machines = [{id: 'ash-id', name: 'ash'}]; mod.inventory(world.spaces);
  mod.shown = new Set(world.spaces.map(s => s.id));
  world.focus = {space: 'local', tab: 'local-tab', pane: null};
  mod.command('herd-add'); mod.command('machine-move:ash:1');
  mod.command('herd-select:0'); calls.length = 0;
  mod.command('herd-select:1');
  assert.equal(calls.length, 1); assert.equal(calls[0].name, 'space.select');
  assert.equal(calls[0].args.id, remote.id);
  mod.render({spawn: fn => fn()});
  assert.equal(values.get('rowan.sidebar.scope').selectedReady, false);
  assert.equal(values.get('rowan.sidebar.scope').empty, false);
  assert.equal(calls.at(-1).args.child, 'rowan-empty');
  world.focus = {space: remote.id, tab: 'ash/remote-tab', pane: null};
  mod.render({spawn: fn => fn()});
  assert.equal(values.get('rowan.sidebar.scope').selectedReady, true);
  assert.equal(calls.at(-1).args.child, 'rowan-workspace');
  mod.command('herd-select:0');
  world.machines[1].layout = 'unavailable'; calls.length = 0;
  mod.command('herd-select:1');
  assert.equal(calls.length, 0);
  mod.render({spawn: fn => fn()});
  assert.equal(values.get('rowan.sidebar.scope').selectedReady, false);
});

test('implicit actions require a focused ready workspace in the active herd', async () => {
  const {mod, world, calls} = await setup();
  const local = space('local'), remote = space('ash/remote', 'ash');
  world.spaces = [local, remote]; world.machines.push({name: 'ash', layout: 'ready'});
  mod.machines = [{id: 'ash-id', name: 'ash'}]; mod.inventory(world.spaces);
  world.focus = {space: 'local', tab: 'local-tab', pane: null};
  mod.command('active:terminal.paste');
  mod.command('active:tab.select:3');
  mod.command('active:pane.split:down');
  assert.equal(calls.map(c => c.name).join(','), 'terminal.paste,tab.select,pane.split');
  assert.equal(calls[1].args.index, 3); assert.equal(calls[2].args.direction, 'down');
  calls.length = 0;
  mod.command('active:terminal.kill'); mod.command('active:tab.select:10');
  mod.command('active:pane.split:left'); mod.command('active:pane.go:invalid');
  assert.equal(calls.length, 0);
  mod.command('herd-add'); calls.length = 0;
  mod.command('active:terminal.paste'); mod.command('active:tab.close');
  assert.equal(calls.length, 0);
  mod.command('machine-move:ash:1');
  world.focus = {space: remote.id, tab: 'ash/remote-tab', pane: null};
  world.machines[1].layout = 'unavailable';
  mod.command('active:terminal.paste'); mod.command('active:pane.close');
  assert.equal(calls.length, 0);
  world.machines[1].layout = 'ready';
  mod.command('active:terminal.paste_image');
  assert.equal(calls.length, 1); assert.equal(calls[0].name, 'terminal.paste_image');
});

test('profile rename migrates exact remembered selection and folds without merging another profile', async () => {
  const {mod, world, calls} = await setup();
  const original = space('ash/work', 'ash'), other = space('ash-session/work', 'ash-session');
  original.tabs = [{id: 'ash/tab-1'}, {id: 'ash/tab-2'}];
  world.spaces = [original, other];
  world.panes = [{tab: 'ash/tab-2', pane: 'ash/pane-2'}];
  world.machines.push({name: 'ash', layout: 'ready'}, {name: 'ash-session', layout: 'ready'});
  mod.machines = [{id: 'one', name: 'ash', host: 'same'}, {id: 'two', name: 'ash-session', host: 'same'}];
  mod.inventory(world.spaces);
  const label = mod.label(original), otherLabel = mod.label(other);
  mod.command('herd-add'); mod.command('machine-move:ash:1');
  world.focus = {space: original.id, tab: 'ash/tab-2', pane: 'ash/pane-2'};
  mod.remember(world.spaces, world.panes);
  mod.toggleMachine('id:one'); const oldRepo = repo('ash', '/project/.git');
  mod.toggleRepo(oldRepo);
  mod.command('herd-select:0');
  const renamed = space('new/work', 'new');
  renamed.tabs = [{id: 'new/tab-1'}, {id: 'new/tab-2'}];
  world.spaces = [renamed, other];
  world.panes = [{tab: 'new/tab-2', pane: 'new/pane-2'}];
  world.machines[1].name = 'new'; mod.machines[0].name = 'new';
  mod.inventory(world.spaces);
  assert.equal(mod.label(renamed), label); assert.equal(mod.label(other), otherLabel);
  assert.notEqual(label, otherLabel);
  assert.equal(mod.folded.has('new'), true);
  assert.equal(mod.repoFolded.has(repo('new', '/project/.git')), true);
  assert.equal(mod.state.herds[0].members.includes('id:two'), true);
  assert.equal(mod.state.herds[1].members.includes('id:one'), true);
  calls.length = 0; mod.command('herd-select:1');
  assert.equal(calls.map(c => c.name).join(','), 'space.select,tab.select,pane.focus');
  assert.equal(calls[0].args.id, 'new/work');
  assert.equal(calls[1].args.id, 'new/tab-2'); assert.equal(calls[2].args.pane, 'new/pane-2');
});

test('relative workspace navigation skips unavailable machines and wraps', async () => {
  const {mod, world, calls} = await setup();
  const a = space('a'), b = space('ash/b', 'ash'), c = space('z/c', 'z');
  world.spaces = [a, b, c];
  world.machines.push({name: 'ash', layout: 'unavailable'}, {name: 'z', layout: 'ready'});
  mod.machines = [{id: 'one', name: 'ash'}, {id: 'two', name: 'z'}];
  mod.inventory(world.spaces); mod.shown = new Set(world.spaces.map(s => s.id));
  world.focus = {space: 'a', tab: 'a-tab', pane: null};
  mod.command('workspace-next'); assert.equal(calls[0].args.id, 'z/c');
  world.focus = {space: 'z/c', tab: 'z/c-tab', pane: null}; calls.length = 0;
  mod.command('workspace-next'); assert.equal(calls[0].args.id, 'a');
  calls.length = 0; mod.command('workspace-select:2'); assert.equal(calls.length, 0);
});

test('space actions target only the focused ready herd member and its machine', async () => {
  const {mod, world, calls} = await setup();
  const local = space('local'), remote = space('ash/remote', 'ash');
  world.spaces = [local, remote];
  world.machines.push({name: 'ash', layout: 'ready'});
  mod.machines = [{id: 'ash-id', name: 'ash'}]; mod.inventory(world.spaces);
  world.focus = {space: remote.id, tab: 'ash/remote-tab', pane: null};
  mod.command('active:space.new'); mod.command('active:space.rename');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, 'space.new'); assert.equal(calls[0].args.machine, 'ash');
  assert.equal(calls[1].name, 'space.rename'); assert.equal(calls[1].args.id, remote.id);
  world.machines[1].layout = 'unavailable'; calls.length = 0;
  mod.command('active:space.new'); mod.command('active:space.rename');
  assert.equal(calls.length, 0);
  mod.command('herd-add'); calls.length = 0;
  mod.command('active:space.new'); mod.command('active:space.rename');
  assert.equal(calls.length, 0);
});

test('sidebar ratio follows terminal size independently of global zoom and survives reload', async () => {
  const {mod, create, world} = await setup();
  mod.command('font-ratio:100');
  assert.equal(mod.fontMetrics().fontSize, 15);
  world.settings.zoom = 2;
  assert.equal(mod.fontMetrics().fontSize, 15);
  world.settings.font_size = 20;
  assert.equal(mod.fontMetrics().fontSize, 20);
  const reloaded = create();
  assert.equal(reloaded.fontMetrics().ratio, 1);
  reloaded.command('font-smaller');
  assert.equal(mod.fontMetrics().fontSize, 19);
  assert.equal(world.settings.font_size, 20);
  assert.equal(world.settings.zoom, 2);
});

test('sidebar font controls clamp their range and reject invalid persisted ratios', async () => {
  const {mod, values} = await setup();
  mod.command('font-ratio:60');
  mod.command('font-smaller');
  assert.equal(mod.fontMetrics().ratio, 0.6);
  mod.command('font-ratio:120');
  mod.command('font-larger');
  assert.equal(mod.fontMetrics().ratio, 1.2);
  values.set('rowan.sidebar.fontRatio', 'large');
  assert.equal(mod.fontMetrics().ratio, 0.8);
  values.set('rowan.sidebar.fontRatio', Infinity);
  assert.equal(mod.fontMetrics().ratio, 0.8);
  mod.command('font-reset');
  assert.equal(values.get('rowan.sidebar.fontRatio'), 0.8);
});

const pointer = (x, y) => ({position: {x, y}});
const dragContext = {notify() {}};

test('drag reorders by stable identity despite an intervening insert, without changing focus or aliases', async () => {
  const {mod, create, world, calls} = await setup();
  const a = space('a'), b = space('b'), c = space('c');
  world.spaces = [a, b, c]; mod.inventory(world.spaces);
  world.focus = {space: c.id, tab: 'c-tab', pane: null};
  const label = mod.label(a);
  mod.startDrag(a, pointer(20, 20));
  world.spaces.unshift(space('new'));
  mod.dragOver(c, pointer(20, 60), dragContext);
  mod.finishDrag(c, dragContext);
  assert.equal(world.spaces.map(s => s.id).join(','), 'new,b,c,a');
  assert.equal(world.focus.space, c.id);
  assert.equal(create().label(a), label);
  assert.equal(calls.some(c => c.name === 'space.select'), false);
  mod.startDrag(a, pointer(20, 60));
  mod.dragOver(b, pointer(20, 20), dragContext);
  mod.finishDrag(b, dragContext);
  assert.equal(world.spaces.map(s => s.id).join(','), 'new,a,b,c');
});

test('a click with pointer jitter selects; cancelled drags never move or select', async () => {
  const {mod, world, calls} = await setup();
  const a = space('a'), b = space('b');
  world.spaces = [a, b]; mod.inventory(world.spaces);
  mod.startDrag(a, pointer(20, 20));
  mod.dragOver(a, pointer(22, 21), dragContext);
  mod.finishDrag(a, dragContext);
  assert.equal(calls[0].name, 'space.select'); assert.equal(calls[0].args.id, a.id);
  calls.length = 0;
  mod.startDrag(a, pointer(20, 20));
  mod.dragOver(b, pointer(20, 60), dragContext);
  mod.cancelDrag(dragContext);
  mod.finishDrag(b, dragContext);
  assert.equal(world.spaces.map(s => s.id).join(','), 'a,b');
  assert.deepEqual(calls, []);
});

test('cross-machine, disconnected, removed and off-herd drag targets cannot mutate or steal focus', async () => {
  for (const change of ['cross-machine', 'disconnected', 'removed', 'off-herd']) {
    const {mod, world, calls} = await setup();
    const a = space('a'), b = space('b', change === 'cross-machine' ? 'ash' : null);
    world.spaces = [a, b]; world.machines.push({name: 'ash', layout: 'ready'});
    mod.inventory(world.spaces);
    mod.startDrag(a, pointer(20, 20));
    mod.dragOver(b, pointer(20, 60), dragContext);
    if (change === 'disconnected') world.machines[0].layout = 'loading';
    if (change === 'removed') world.spaces.shift();
    if (change === 'off-herd') mod.herd().members = [];
    const before = world.spaces.map(s => s.id).join(',');
    mod.finishDrag(b, dragContext);
    assert.equal(world.spaces.map(s => s.id).join(','), before, change);
    assert.deepEqual(calls, [], change);
  }
});

test('section order migrates once, persists per herd and drives navigation across renamed profiles', async () => {
  const {mod, create, world, calls} = await setup();
  world.spaces = [space('local'), space('z/work', 'z'), space('ash/work', 'ash')];
  world.machines.push({name: 'z', layout: 'ready'}, {name: 'ash', layout: 'ready'});
  mod.machines = [{id: 'z-id', name: 'z'}, {id: 'ash-id', name: 'ash'}];
  mod.inventory(world.spaces); mod.shown = new Set(world.spaces.map(s => s.id));
  assert.equal(mod.herd().members.join(','), '@local,id:ash-id,id:z-id');
  mod.command('machine-reorder:z:up'); mod.command('machine-reorder:z:up');
  assert.equal(mod.herd().members.join(','), 'id:z-id,@local,id:ash-id');
  assert.equal(mod.ordered().map(r => r.w.id).join(','), 'z/work,local,ash/work');
  world.focus = {space: 'z/work', tab: 'z/work-tab'};
  mod.command('workspace-next'); assert.equal(calls.at(-1).args.id, 'local');
  const reloaded = create(); reloaded.machines = mod.machines;
  world.spaces[1].machine = 'renamed'; world.spaces[1].id = 'renamed/work';
  world.machines[1].name = 'renamed'; reloaded.machines[0].name = 'renamed';
  reloaded.inventory(world.spaces);
  assert.equal(reloaded.herd().members.join(','), 'id:z-id,@local,id:ash-id');
  reloaded.command('herd-add'); reloaded.command('machine-move:renamed:1');
  assert.equal(reloaded.herd().members.join(','), 'id:z-id');
  reloaded.command('machine-reorder:renamed:up');
  reloaded.command('herd-select:0');
  assert.equal(reloaded.herd().members.join(','), '@local,id:ash-id');
});

test('heading drag moves whole offline or folded sections without folding, focusing or changing aliases', async () => {
  const {mod, create, world, calls} = await setup();
  const a = space('local'), b = space('ash/b', 'ash'), c = space('ash/c', 'ash');
  world.spaces = [a, b, c]; world.machines.push({name: 'ash', layout: 'unavailable'});
  mod.machines = [{id: 'remote', name: 'ash'}]; mod.inventory(world.spaces);
  mod.folded.add('ash'); const label = mod.label(b);
  mod.startMachineDrag('id:remote', pointer(20, 60));
  mod.dragMachineOver('@local', pointer(20, 20), dragContext);
  mod.finishMachineDrag('@local', dragContext);
  assert.equal(mod.herd().members.join(','), 'id:remote,@local');
  assert.equal(mod.folded.has('ash'), true);
  assert.equal(create().label(b), label);
  assert.deepEqual(world.spaces, [a, b, c]); assert.deepEqual(calls, []);
  mod.startMachineDrag('id:remote', pointer(20, 20));
  mod.dragMachineOver('@local', pointer(20, 60), dragContext);
  mod.finishMachineDrag('@local', dragContext);
  assert.equal(mod.herd().members.join(','), '@local,id:remote');
});

test('heading click jitter folds but cancelled, stale and cross-herd drags never reorder', async () => {
  const {mod, world} = await setup();
  world.spaces = [space('local'), space('ash/work', 'ash')];
  mod.machines = [{id: 'remote', name: 'ash'}]; mod.inventory(world.spaces);
  mod.startMachineDrag('@local', pointer(20, 20));
  mod.dragMachineOver('@local', pointer(22, 21), dragContext);
  mod.finishMachineDrag('@local', dragContext);
  assert.equal(mod.folded.has(null), true);
  for (const invalidate of [
    () => mod.cancelDrag(dragContext),
    () => { mod.state.active = 1; mod.state.herds.push({id: 1, members: ['@local', 'id:remote'], sectionOrder: true}); },
    () => { mod.herd().members = ['@local']; },
  ]) {
    mod.state.active = 0; mod.state.herds = [{id: 0, members: ['@local', 'id:remote'], sectionOrder: true}];
    mod.startMachineDrag('@local', pointer(20, 20));
    mod.dragMachineOver('id:remote', pointer(20, 60), dragContext);
    invalidate();
    const before = mod.herd().members.join(',');
    mod.finishMachineDrag('id:remote', dragContext);
    assert.equal(mod.herd().members.join(','), before);
  }
});
