import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

// Exercise the real mod class with only its host APIs replaced; no live app or core.
async function setup(documents = new Map()) {
  const saved = new Map(), calls = [], values = new Map();
  const world = {spaces: [], panes: [], machines: [{name: null, layout: 'ready'}], focus: null, settings: {font_size: 15, zoom: 1}, keys: [], layout: 'rowan-terminal', applyMoves: true, ackMoves: true, hc: async () => ({code: 0, stdout: '{"machines":[]}'})};
  // Deterministic clock: the mod's scan stamps (entry `at`) and slot cooldowns
  // read Date.now(); tests move world.now when they need time to pass.
  world.now = Date.now();
  class FakeDate extends Date {
    constructor() { super(world.now); }
    static now() { return world.now; }
  }
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const docKey = (name, on) => JSON.stringify([on ?? null, name]);
  world.documents = documents;
  world.docKey = docKey;
  world.readDocument = async (name, options = {}) => {
    const on = options.on ?? null;
    const prefix = on ? `${on}/` : '';
    const layout = {spaces: world.spaces.filter(s => (s.machine ?? null) === on).map(s => ({
      id: prefix && s.id.startsWith(prefix) ? s.id.slice(prefix.length) : s.id,
    }))};
    const doc = documents.get(docKey(name, on)) ?? {value: name === 'herdr-app' ? layout : null, version: 0};
    return copy(doc);
  };
  world.writeDocument = async (name, value, version, options = {}) => {
    const key = docKey(name, options.on);
    const current = documents.get(key) ?? {value: null, version: 0};
    if (current.version !== version) return {written: false, ...copy(current)};
    const next = {value: copy(value), version: version + 1};
    documents.set(key, next);
    return {written: true, version: next.version};
  };
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
  const context = vm.createContext({localStorage, console, Date: FakeDate, JSON, Set, Map, Object, Array, Math, Number, String, RegExp, encodeURIComponent, decodeURIComponent});
  const modules = {
    'gpui-kit': {View: class {}, div: el, svg: el},
    'gpui-base': {v_flex: el, h_flex: el},
    herdr: {
      spaces: () => world.spaces, panes: () => world.panes, machines: () => world.machines,
      // Content fingerprints stand in for the app's change counters.
      revisions: (keys = []) => Object.fromEntries((keys.length ? keys : ['spaces', 'panes', 'machines', 'focused']).map(k => [k, ({
        spaces: world.spaces.length * 1000003 + JSON.stringify(world.spaces).length,
        panes: world.panes.length * 1000003 + JSON.stringify(world.panes).length,
        machines: world.machines.length * 1000003 + JSON.stringify(world.machines).length,
        focused: JSON.stringify(world.focus ?? null).length,
      })[k] ?? 0])),
      settings: () => world.settings,
      focused: () => world.focus, run: (name, args) => {
        calls.push({name, args});
        if (name === 'space.move' && world.applyMoves) {
          const from = world.spaces.findIndex(s => s.id === args.id);
          const [moving] = world.spaces.splice(from, 1);
          world.spaces.splice(args.index - 1, 0, moving);
          if (world.ackMoves) {
            const machine = world.machines.find(m => m.name === moving.machine);
            if (machine) machine.space_order = world.spaces.filter(s => s.machine === moving.machine).map(s => s.id);
          }
        }
      },
      shared: key => values.get(key), setShared: (key, value) => values.set(key, value),
      theme: () => ({dim: 'dim', foreground: 'fg', selected: 'selected', hover: 'hover', chrome: 'chrome', unknown: 'unknown'}),
      window: () => ({active: world.active ?? false, layout_name: world.layout}), keys: () => world.keys, openOverlay: spec => calls.push({name: 'openOverlay', spec}), exec: (...args) => world.exec(...args), hc: args => world.hc(args), watchFolder: () => new Promise(() => {}), nextCommand() {},
      readDocument: (...args) => world.readDocument(...args), writeDocument: (...args) => world.writeDocument(...args),
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
    instance.init({}, {timer: {every() {}}, spawn() {}, notify() {}, focus_handle: () => ({focus() { values.set('spaces.keyboardFocus', true); }})});
    return instance;
  };
  const mod = create();
  return {mod, create, world, saved, calls, values};
}

const space = (id, machine = null) => ({id, machine, name: id, folder: `/${id}`, tabs: [{id: `${id}-tab`}], status: null, active: false});
const repo = (machine, dir) => JSON.stringify([machine, dir]);
const git = (machine, folder, common, linked = false) => ({key: JSON.stringify([machine, folder]), value: {repo: repo(machine, common), name: 'project', linked}});

test('worktree commands retain focused context and reject stale or offline workspaces', async () => {
  const {mod, world, calls} = await setup();
  const s = space('a'); world.spaces = [s]; world.focus = {space: 'a', tab: 'a-tab', cwd: '/a/live'};
  mod.inventory(world.spaces);
  for (const action of ['new', 'open', 'remove']) mod.command(`worktree-${action}`);
  assert.deepEqual(calls.map(c => c.spec.props.action), ['new', 'open', 'remove']);
  assert.equal(calls[0].spec.props.folder, '/a/live');
  assert.equal(calls[0].spec.props.space, 'a');
  const other = space('other'); world.spaces.push(other);
  mod.command('worktree-open:other');
  assert.equal(calls[3].spec.props.space, 'other'); assert.equal(calls[3].spec.props.folder, '/other');
  calls.length = 0; world.machines[0].layout = 'unavailable'; mod.command('worktree-remove');
  world.machines[0].layout = 'ready'; world.focus.space = 'stale'; mod.command('worktree-new');
  assert.equal(calls.length, 0);
});

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

test('delayed repository discovery is bounded and publishes a complete hierarchy at once', async () => {
  const {mod, world} = await setup();
  const items = ['linked', 'other', 'main', 'extra1', 'extra2', 'extra3'].map(id => space(id, 'ash'));
  world.spaces = items;
  world.machines.push({name: 'ash', layout: 'ready'});
  mod.machines = [{id: 'core-one', name: 'ash'}]; mod.inventory(items);
  mod.shown = new Set(items.map(s => s.id));
  const lookups = [];
  let active = 0, peak = 0;
  world.exec = (cmd, args, opts) => {
    if (args[0] === 'rev-parse') {
      active++; peak = Math.max(peak, active);
      return new Promise(resolve => lookups.push({cwd: opts.cwd, finish() {
        active--;
        const common = ['/linked', '/main'].includes(opts.cwd) ? '/main/.git' : `${opts.cwd}/.git`;
        resolve({code: 0, stdout: `${opts.cwd}\n${common}\n`});
      }}));
    }
    throw new Error(`unexpected command ${cmd} ${args.join(' ')}`);
  };
  const context = hierarchyContext(), cx = context.cx;
  const order = () => Array.from(mod.ordered(), row => row.w.id);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  mod.refreshGit(new Set(items.map(s => JSON.stringify([s.machine, s.folder]))), cx);
  assert.equal(lookups.length, 4);
  assert.deepEqual(order(), ['linked', 'other', 'main', 'extra1', 'extra2', 'extra3']);
  lookups[0].finish(); await flush();
  assert.equal(lookups.length, 5);
  assert.deepEqual(order(), ['linked', 'other', 'main', 'extra1', 'extra2', 'extra3']);
  for (let i = 1; i < 4; i++) lookups[i].finish();
  await flush();
  assert.equal(lookups.length, 6);
  lookups[4].finish(); lookups[5].finish(); await flush();
  assert.equal(peak, 4);
  assert.deepEqual(order(), ['main', 'linked', 'other', 'extra1', 'extra2', 'extra3']);
  await context.drain();
  assert.equal(mod.ordered()[0].g.repo, JSON.stringify(['ash', '/main/.git']));
});

test('machine identity changes invalidate discovery and retry transient failures', async () => {
  const {mod, world} = await setup();
  const item = space('main', 'ash'); world.spaces = [item];
  world.machines.push({name: 'ash', layout: 'ready'});
  mod.machines = [{id: 'old-core', name: 'ash'}]; mod.inventory(world.spaces);
  mod.shown.add(item.id);
  let fails = false;
  world.exec = async (cmd, args) => {
    if (fails) throw new Error('offline');
    if (args[0] === 'rev-parse') return {code: 0, stdout: '/main\n/main/.git\n'};
    throw new Error('unexpected command');
  };
  const context = hierarchyContext(), cx = context.cx;
  const key = JSON.stringify(['ash', '/main']);
  mod.refreshGit(new Set([key]), cx); await context.drain();
  assert.equal(mod.ordered()[0].g.repo, JSON.stringify(['ash', '/main/.git']));
  mod.machines = [{id: 'new-core', name: 'ash'}]; fails = true;
  mod.inventory(world.spaces);
  const due = mod.due(Date.now(), world.spaces, world.panes);
  assert.equal(due.has(key), true);
  assert.equal(mod.ordered()[0].g, null);
  mod.refreshGit(due, cx); await context.drain();
  assert.equal(mod.unsure.has(key), true);
  fails = false;
  mod.refreshGit(new Set([key]), cx); await context.drain();
  assert.equal(mod.ordered()[0].g.repo, JSON.stringify(['ash', '/main/.git']));
});

test('nested and symlinked worktrees share only their own machine repository; nonrepos stay ungrouped', async () => {
  const {mod, world} = await setup();
  const linked = space('linked', 'ash'), main = space('main', 'ash');
  const plain = space('plain', 'ash'), remote = space('remote', 'ash-other');
  linked.folder = '/worktrees/feature/src'; main.folder = '/project/nested';
  remote.folder = '/project/nested';
  world.spaces = [linked, plain, main, remote];
  world.machines.push({name: 'ash', layout: 'ready'}, {name: 'ash-other', layout: 'ready'});
  mod.machines = [{id: 'one', name: 'ash'}, {id: 'two', name: 'ash-other'}];
  mod.inventory(world.spaces); mod.shown = new Set(world.spaces.map(s => s.id));
  world.exec = async (cmd, args, opts) => {
    assert.equal(args[0], 'rev-parse');
    if (opts.cwd === '/plain') return {code: 128, stderr: 'fatal: not a git repository'};
    if (opts.cwd === linked.folder) return {code: 0, stdout: '/worktrees/feature\r\n/project/.git\r\n'};
    return {code: 0, stdout: '/project\r\n/project/.git\r\n'};
  };
  const context = hierarchyContext(), cx = context.cx;
  mod.refreshGit(new Set(world.spaces.map(s => JSON.stringify([s.machine, s.folder]))), cx);
  await context.drain();
  const rows = mod.ordered();
  assert.deepEqual(Array.from(rows, row => row.w.id), ['main', 'linked', 'plain', 'remote']);
  assert.equal(rows[0].g.repo, rows[1].g.repo);
  assert.equal(rows[1].g.linked, true);
  assert.equal(rows[2].g, null);
  assert.notEqual(rows[0].g.repo, rows[3].g.repo);
  assert.equal(mod.due(Date.now(), world.spaces, world.panes).has(JSON.stringify(['ash', '/plain'])), false);
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

test('workspace rows show names and the terminal address, never branch metadata', async () => {
  const {mod, world} = await setup();
  const texts = node => typeof node === 'string' ? [node] : node?.items?.flatMap(texts) ?? [];
  const find = (node, id) => node?.idValue === id ? node : node?.items?.map(x => find(x, id)).find(Boolean);
  for (const branch of ['main', 'feature/visible-branch', 'worktree/quiet-river', '(detached)']) {
    const workspace = {...space('a'), name: 'Graph UI', branch};
    world.spaces = [workspace]; mod.shown = new Set(['a']); mod.inventory(world.spaces);
    world.panes = [{tab: 'a-tab', pane: 'a-pane', terminal: 't7', focused: true, cwd: workspace.folder}];
    const metadata = git(null, workspace.folder, '/project/.git');
    mod.git[metadata.key] = {...metadata.value, branch};
    const row = find(mod.render({spawn: fn => fn()}), 'space-a');
    const rendered = texts(row);
    assert.ok(rendered.includes('Graph UI'));
    assert.ok(rendered.includes(mod.refOf(workspace)));
    // The per-screen `w` tag is retired as a display id: agents and `hc` name a
    // workspace by its terminal address, and the row says what they say.
    assert.ok(!rendered.includes(mod.label(workspace)));
    assert.ok(!rendered.some(text => text.includes(branch)));
  }
});

test('focused sidebar keyboard selection stays within ready herd workspaces', async () => {
  const {mod, world, calls, values} = await setup();
  world.spaces = [space('a'), space('b'), space('remote', 'ash')];
  mod.shown = new Set(world.spaces.map(s => s.id));
  world.machines.push({name: 'ash', layout: 'ready'});
  mod.machines = [{id: 'ash-id', name: 'ash'}]; mod.inventory(world.spaces);
  mod.command('herd-add'); mod.command('machine-move:ash:1'); mod.command('herd-select:0');
  world.focus = {space: 'a', tab: 'a-tab'}; calls.length = 0;
  mod.command('focus');
  const cx = {notify() {}, stop_propagation() {}};
  mod.keyboard({key: 'down', modifiers: {}}, cx);
  assert.equal(values.get('spaces.keyboardFocus'), true);
  assert.equal(mod.cursor, 'b');
  assert.equal(calls.length, 0);
  mod.keyboard({key: 'enter', modifiers: {}}, cx);
  assert.equal(calls.at(-1).args.id, 'b');
  mod.cursor = 'remote'; calls.length = 0;
  mod.keyboard({key: 'enter', modifiers: {}}, cx);
  assert.equal(calls.length, 0);
  mod.keyboard({key: 'escape', modifiers: {}}, cx);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), {name: 'pane.go', args: {direction: 'right'}});
});

test('explicit workspace moves retry lost writes without stealing focus or reordering new work', async () => {
  const {mod, world, calls} = await setup();
  const a = space('a'), b = space('b');
  world.spaces = [a, b]; mod.inventory(world.spaces);
  world.focus = {space: 'a', tab: 'a-tab'};
  world.applyMoves = false;
  mod.queueMove(a, b);
  const first = mod.ordering.at;
  assert.deepEqual(world.spaces.map(s => s.id), ['a', 'b']);
  mod.reconcileOrder(first + 999);
  assert.equal(calls.length, 1);
  world.applyMoves = true;
  mod.reconcileOrder(first + 1000);
  assert.deepEqual(world.spaces.map(s => s.id), ['b', 'a']);
  assert.equal(world.focus.space, 'a');
  mod.reconcileOrder(first + 1001);
  assert.equal(mod.ordering, null);
  world.applyMoves = false;
  mod.queueMove(a, b);
  world.spaces.push(space('new'));
  const before = calls.length;
  mod.reconcileOrder(Date.now() + 2000);
  assert.equal(mod.ordering, null);
  assert.equal(calls.length, before);
});

test('optimistic order cannot retire a drag before a delayed conflict is retried and acknowledged', async () => {
  const {mod, world, calls} = await setup();
  const a = space('a'), b = space('b');
  world.spaces = [a, b]; world.machines[0].space_order = ['a', 'b'];
  world.ackMoves = false; mod.inventory(world.spaces);
  world.focus = {space: 'a', tab: 'a-tab'};
  mod.queueMove(a, b);
  const started = mod.ordering.at;
  assert.deepEqual(world.spaces.map(s => s.id), ['b', 'a']);
  mod.reconcileOrder(started + 250);
  assert.ok(mod.ordering);
  assert.equal(calls.length, 1);
  // A late CAS rejection rolls the optimistic projection back to the core order.
  world.spaces = [a, b];
  mod.reconcileOrder(started + 1001);
  assert.deepEqual(world.spaces.map(s => s.id), ['b', 'a']);
  assert.equal(calls.length, 2);
  assert.ok(mod.ordering);
  world.machines[0].space_order = ['b', 'a'];
  mod.reconcileOrder(started + 1002);
  assert.equal(mod.ordering, null);
  assert.equal(world.focus.space, 'a');
});

test('rebuilt profile identity retains herd position and visible workspace tags', async () => {
  const {mod, world} = await setup();
  const remote = space('ash/one', 'ash');
  world.spaces = [remote]; world.machines.push({name: 'ash', layout: 'ready'});
  mod.machines = [{id: 'old', name: 'ash'}]; mod.inventory(world.spaces);
  mod.command('herd-add'); mod.command('machine-move:ash:1');
  const tag = mod.label(remote);
  mod.machines = [{id: 'replacement', name: 'ash'}]; mod.inventory(world.spaces);
  assert.deepEqual(Array.from(mod.herd().members), ['id:replacement']);
  assert.equal(mod.state.herds[0].members.includes('id:replacement'), false);
  assert.equal(mod.label(remote), tag);
  assert.equal(mod.state.profiles['id:old'], undefined);
});

test('rebuilt machine retry persists successful removal and never repairs ordinary offline peers', async () => {
  const {mod, create, world, saved} = await setup();
  const machine = {name: 'ash', id: 'old', state: 'unreachable', why: 'a different core answers there ("new")', target: 'host', session: 'auri'};
  mod.machines = [machine]; mod.inventory([]);
  const jobs = [], requests = [];
  const cx = {notify() {}, spawn: fn => jobs.push(fn)};
  let fail = true;
  world.hc = async args => {
    requests.push(args);
    if (args[1] === 'add' && fail) return {code: 1, stdout: '{"error":{"message":"temporarily unavailable"}}'};
    return {code: 0, stdout: '{"machines":[]}'};
  };
  mod.reconnect(machine, cx);
  while (jobs.length) await jobs.shift()(cx);
  assert.equal(JSON.parse(saved.get('machines.reconnecting')).ash.removed, true);
  assert.equal(mod.reconnecting.ash.error, 'temporarily unavailable');
  const reloaded = create();
  fail = false; reloaded.reconnect(machine, cx);
  while (jobs.length) await jobs.shift()(cx);
  assert.equal(requests.filter(args => args[1] === 'rm').length, 1);
  assert.ok(requests.filter(args => args[1] === 'add').every(args => args.includes('auri')));
  assert.equal(saved.get('machines.reconnecting'), '{}');
  const before = requests.length;
  reloaded.reconnect({...machine, name: 'unrelated', why: 'connection refused'}, cx);
  assert.equal(jobs.length, 0);
  assert.equal(requests.length, before);
});

// A core owns both documents; profile names are routes, not document keys.
const sidebarEntry = (cwd, commonDir = '/project/.git', linked = false, at) =>
  ({cwd, git: {name: 'project', commonDir, linked}, ...(at === undefined ? {} : {at})});
const sidebar = spaces => ({schema: 1, spaces});
const doc = (world, name, value, on = 'ash', version = 1) =>
  world.documents.set(world.docKey(name, on), {value, version});
const documentValue = (world, name, on = 'ash') =>
  world.documents.get(world.docKey(name, on))?.value;
const json = value => JSON.parse(JSON.stringify(value));

function hierarchyContext() {
  const jobs = [];
  const cx = {spawn: fn => { jobs.push(Promise.resolve(fn(cx))); }, notify() {}};
  return {cx, async drain() {
    while (jobs.length) await jobs.shift();
  }};
}

function hierarchyWorld(mod, world, ids, machineId = 'core-one') {
  world.machines = [{name: 'ash', layout: 'ready'}];
  world.spaces = ids.map(id => {
    const s = space(`ash/${id}`, 'ash');
    s.folder = `/${id}`;
    return s;
  });
  mod.machines = [{id: machineId, name: 'ash'}];
  mod.inventory(world.spaces);
  mod.shown = new Set(world.spaces.map(s => s.id));
}

async function syncHierarchy(mod, context) {
  mod.syncHierarchy(context.cx);
  await context.drain();
}

function groups(mod) {
  return Object.fromEntries(Array.from(mod.ordered(), row => [row.w.id, row.g && {
    repo: row.g.repo, name: row.g.name, linked: row.g.linked,
  }]));
}

test('a fresh frontend restores worktree grouping from its core before Git discovery', async () => {
  const {mod, create, world} = await setup();
  hierarchyWorld(mod, world, ['main', 'linked']);
  doc(world, 'herdr-app', {spaces: [{id: 'main'}, {id: 'linked'}]});
  doc(world, 'sprig-sidebar', sidebar({
    main: sidebarEntry('/main'), linked: sidebarEntry('/linked', '/project/.git', true),
  }));
  let gitCalls = 0;
  world.exec = async () => { gitCalls++; throw new Error('Git must not be needed to restore'); };
  const fresh = create();
  hierarchyWorld(fresh, world, ['main', 'linked']);
  const ctx = hierarchyContext();
  fresh.checkNew(ctx.cx);
  await ctx.drain();
  const rows = groups(fresh);
  assert.equal(rows['ash/main'].repo, JSON.stringify(['ash', '/project/.git']));
  assert.equal(rows['ash/linked'].repo, rows['ash/main'].repo);
  assert.equal(rows['ash/linked'].linked, true);
  assert.equal(gitCalls, 0);
});

test('a conflicting concurrent workspace update is merged instead of overwritten', async () => {
  const {mod, world} = await setup();
  hierarchyWorld(mod, world, ['main', 'linked']);
  doc(world, 'herdr-app', {spaces: [{id: 'main'}, {id: 'linked'}]});
  doc(world, 'sprig-sidebar', sidebar({}));
  const ctx = hierarchyContext();
  await syncHierarchy(mod, ctx);
  world.exec = async (_cmd, _args, opts) => ({code: 0, stdout: `${opts.cwd}\n/project/.git\n`});
  const write = world.writeDocument;
  let conflicted = false;
  world.writeDocument = async (name, value, version, options) => {
    if (name === 'sprig-sidebar' && !conflicted) {
      conflicted = true;
      const current = world.documents.get(world.docKey(name, options?.on));
      world.documents.set(world.docKey(name, options?.on), {
        version: current.version + 1,
        value: sidebar({...current.value.spaces, linked: sidebarEntry('/linked', '/project/.git', true)}),
      });
    }
    return write(name, value, version, options);
  };
  mod.refreshGit(new Set([JSON.stringify(['ash', '/main'])]), ctx.cx);
  await ctx.drain();
  await syncHierarchy(mod, ctx);
  assert.equal(conflicted, true);
  assert.deepEqual(json(documentValue(world, 'sprig-sidebar')), sidebar({
    main: sidebarEntry('/main', '/project/.git', true, world.now),
    linked: sidebarEntry('/linked', '/project/.git', true),
  }));
});

test('authoritative closure removes only the closed workspace, preserving its worktree', async () => {
  const {mod, world} = await setup();
  hierarchyWorld(mod, world, ['main', 'linked']);
  doc(world, 'herdr-app', {spaces: [{id: 'main'}, {id: 'linked'}]});
  doc(world, 'sprig-sidebar', sidebar({
    main: sidebarEntry('/main'), linked: sidebarEntry('/linked', '/project/.git', true),
  }));
  const ctx = hierarchyContext();
  await syncHierarchy(mod, ctx);
  world.spaces = world.spaces.filter(s => s.id !== 'ash/main');
  doc(world, 'herdr-app', {spaces: [{id: 'linked'}]}, 'ash', 2);
  await syncHierarchy(mod, ctx);
  assert.deepEqual(json(documentValue(world, 'sprig-sidebar')), sidebar({
    linked: sidebarEntry('/linked', '/project/.git', true),
  }));
  assert.equal(groups(mod)['ash/linked'].repo, JSON.stringify(['ash', '/project/.git']));
});

test('a transient missing workspace and an offline machine do not delete metadata', async () => {
  const {mod, world} = await setup();
  hierarchyWorld(mod, world, ['main', 'linked']);
  const expected = sidebar({main: sidebarEntry('/main'), linked: sidebarEntry('/linked', '/project/.git', true)});
  doc(world, 'herdr-app', {spaces: [{id: 'main'}, {id: 'linked'}]});
  doc(world, 'sprig-sidebar', expected);
  const ctx = hierarchyContext();
  await syncHierarchy(mod, ctx);
  world.spaces = world.spaces.filter(s => s.id !== 'ash/main');
  await syncHierarchy(mod, ctx);
  assert.deepEqual(json(documentValue(world, 'sprig-sidebar')), expected);
  world.machines[0].layout = 'offline';
  world.spaces = [];
  const read = world.readDocument;
  world.readDocument = async (name, options) => {
    if (options?.on === 'ash') throw new Error('offline');
    return read(name, options);
  };
  await syncHierarchy(mod, ctx);
  assert.deepEqual(json(documentValue(world, 'sprig-sidebar')), expected);
});

test('hydration rejects a stale cwd and data from a replaced machine identity', async () => {
  const {mod, create, world} = await setup();
  hierarchyWorld(mod, world, ['main']);
  doc(world, 'herdr-app', {spaces: [{id: 'main'}]});
  doc(world, 'sprig-sidebar', sidebar({main: sidebarEntry('/old')}));
  const ctx = hierarchyContext();
  await syncHierarchy(mod, ctx);
  assert.equal(groups(mod)['ash/main'], null);
  doc(world, 'sprig-sidebar', sidebar({main: sidebarEntry('/main')}));
  const fresh = create();
  hierarchyWorld(fresh, world, ['main']);
  const freshContext = hierarchyContext();
  await syncHierarchy(fresh, freshContext);
  assert.equal(groups(fresh)['ash/main'].repo, JSON.stringify(['ash', '/project/.git']));
  // A second core with the same route must not inherit the first core's cache.
  hierarchyWorld(fresh, world, ['main'], 'core-two');
  doc(world, 'sprig-sidebar', sidebar({main: sidebarEntry('/elsewhere')}));
  fresh.checkNew(freshContext.cx);
  await freshContext.drain();
  assert.equal(groups(fresh)['ash/main'], null);
});

test('transient Git discovery errors preserve restored repository metadata', async () => {
  const {mod, world} = await setup();
  hierarchyWorld(mod, world, ['main']);
  const expected = sidebar({main: sidebarEntry('/main')});
  doc(world, 'herdr-app', {spaces: [{id: 'main'}]});
  doc(world, 'sprig-sidebar', expected);
  const ctx = hierarchyContext();
  await syncHierarchy(mod, ctx);
  world.exec = async () => { throw new Error('temporary transport failure'); };
  mod.refreshGit(new Set([JSON.stringify(['ash', '/main'])]), ctx.cx);
  await ctx.drain();
  await syncHierarchy(mod, ctx);
  assert.equal(groups(mod)['ash/main'].repo, JSON.stringify(['ash', '/project/.git']));
  assert.deepEqual(json(documentValue(world, 'sprig-sidebar')), expected);
});

test('unknown sidebar schemas are never overwritten by discovery or cleanup', async () => {
  const {mod, world} = await setup();
  hierarchyWorld(mod, world, ['main']);
  const unknown = {schema: 42, spaces: {closed: {future: true}}, extra: 'keep'};
  doc(world, 'herdr-app', {spaces: [{id: 'main'}]});
  doc(world, 'sprig-sidebar', unknown);
  const ctx = hierarchyContext();
  await syncHierarchy(mod, ctx);
  world.exec = async () => ({code: 0, stdout: '/main\n/project/.git\n'});
  mod.refreshGit(new Set([JSON.stringify(['ash', '/main'])]), ctx.cx);
  await ctx.drain();
  await syncHierarchy(mod, ctx);
  assert.deepEqual(json(documentValue(world, 'sprig-sidebar')), unknown);
});

test('cleanup retains a workspace published between hierarchy and layout reads', async () => {
  const {mod, world} = await setup();
  hierarchyWorld(mod, world, ['main']);
  doc(world, 'herdr-app', {spaces: [{id: 'main'}]});
  doc(world, 'sprig-sidebar', sidebar({main: sidebarEntry('/main')}));
  const read = world.readDocument;
  let published = false;
  const expected = sidebar({main: sidebarEntry('/main'), linked: sidebarEntry('/linked', '/project/.git', true)});
  world.readDocument = async (name, options) => {
    if (name === 'sprig-sidebar' && !published) {
      published = true;
      doc(world, 'herdr-app', {spaces: [{id: 'main'}, {id: 'linked'}]}, 'ash', 2);
      doc(world, 'sprig-sidebar', expected, 'ash', 2);
    }
    return read(name, options);
  };
  await syncHierarchy(mod, hierarchyContext());
  assert.deepEqual(json(documentValue(world, 'sprig-sidebar')), expected);
});

test('a restored non-repository is revalidated after becoming a repository while closed', async () => {
  const {mod, world} = await setup();
  hierarchyWorld(mod, world, ['main']);
  doc(world, 'herdr-app', {spaces: [{id: 'main'}]});
  doc(world, 'sprig-sidebar', sidebar({main: {cwd: '/main', git: null}}));
  const ctx = hierarchyContext();
  await syncHierarchy(mod, ctx);
  assert.equal(groups(mod)['ash/main'], null);
  world.active = true;
  const start = Date.now();
  assert.equal(mod.due(start, world.spaces, []).size, 0);
  const due = mod.due(start + 60001, world.spaces, []);
  assert.deepEqual([...due], [JSON.stringify(['ash', '/main'])]);
  world.exec = async () => ({code: 0, stdout: '/main\n/project/.git\n'});
  mod.refreshGit(due, ctx.cx);
  await ctx.drain();
  assert.equal(groups(mod)['ash/main'].repo, JSON.stringify(['ash', '/project/.git']));
  assert.equal(documentValue(world, 'sprig-sidebar').spaces.main.git.commonDir, '/project/.git');
});

test('two windows on one machine converge on the hierarchy document without flapping', async () => {
  const {mod: a, create, world} = await setup();
  hierarchyWorld(a, world, ['main']);
  doc(world, 'herdr-app', {spaces: [{id: 'main'}]});
  doc(world, 'sprig-sidebar', sidebar({}));
  const ctx = hierarchyContext();
  await syncHierarchy(a, ctx);
  world.exec = async (_cmd, _args, opts) => ({code: 0, stdout: `${opts.cwd}\n/project/.git\n`});
  // Window A scans at t=1000 and publishes.
  a.refreshGit(new Set([JSON.stringify(['ash', '/main'])]), ctx.cx);
  await ctx.drain();
  await syncHierarchy(a, ctx);
  const published = json(documentValue(world, 'sprig-sidebar'));
  assert.equal(published.spaces.main.at, world.now);

  // Window B adopts the entry and must not restamp it as a fresh local scan:
  // restamping made B overwrite A's data, and A write its stale scan back.
  const b = create();
  hierarchyWorld(b, world, ['main']);
  b.restoreHierarchy({on: 'ash', identity: b.machineKey('ash')}, published, ctx.cx);
  assert.equal(b.checked[JSON.stringify(['ash', '/main'])], world.now);
  await syncHierarchy(b, ctx);
  assert.deepEqual(json(documentValue(world, 'sprig-sidebar')), published);

  // A stale scan must never clobber a newer published one: age A's stamp,
  // re-fire the refresh, and the document stays byte-identical.
  a.checked[JSON.stringify(['ash', '/main'])] = world.now - 1500;
  world.now += 1000;
  for (const s of a.verified.keys()) a.verified.set(s, 999);
  await a.refreshHierarchy(a.hierarchy.get('ash'), ctx.cx);
  assert.deepEqual(json(documentValue(world, 'sprig-sidebar')), published);
});
