import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

test('legacy settings section and choice navigation is layout scoped', async () => {
  let layout = 'rowan-terminal';
  const calls = [];
  const modules = {
    'gpui-kit': {View: class {}, div() {}, svg() {}, image() {}},
    'gpui-base': {v_flex() {}, h_flex() {}, Scrollbar: {}, InputState: {}, Input: {}, Popup: {new: () => { const p = {}; p.when = () => p; p.content = () => p; return p; }}},
    herdr: {
      hc() {}, run: (...a) => calls.push(a), theme() {}, themes: () => [{name: 'dark', light: false}, {name: 'light', light: true}],
      fonts: () => ['A', 'B'], updates: () => ({core: {version: '2.0.0', ready: '2.1'}, app: {updates: true, ready: '3'}, checks: true}), telemetry() {}, settings: () => ({font_size: 15}), layouts: () => [], shared: () => 'rowan-terminal',
      appHome() {}, readTextFile() {}, writeTextFile() {}, playSound() {}, props() {}, closeOverlay() {},
      window: () => ({layout_name: layout, platform: 'linux'}),
    },
  };
  const context = vm.createContext({});
  const main = new vm.SourceTextModule(await readFile(new URL('./main.js', import.meta.url), 'utf8'), {context});
  await main.link(name => new vm.SyntheticModule(Object.keys(modules[name]), function () {
    for (const [key, value] of Object.entries(modules[name])) this.setExport(key, value);
  }, {context}));
  await main.evaluate();
  const view = new main.namespace.default();
  view.section = 'look'; view.legacyChoice = 0; view.person = {}; view.machineEdit = null; view.picking = null;
  view.machineList = [{name: 'remote', version: '1.0.0'}]; view.machineBusy = {};
  view.handle = {focus() {}}; view.fontInput = {set_value() {}, focus() {}};
  view.renameInput = {set_value() {}, set_selected_range() {}, focus() {}};
  let stopped = 0;
  const cx = {stop_propagation() { stopped++; }, notify() {}, spawn() {}};
  const key = (key, modifiers = {}) => view.legacyKey({key, modifiers}, cx);
  assert.equal(key('j'), true);
  assert.equal(view.legacyChoice, 1);
  view.legacyChoice = 4;
  assert.equal(key('enter'), true);
  assert.equal(calls[0][0], 'app.theme');
  assert.equal(calls[0][1].name, 'light');
  key('tab'); assert.equal(view.section, 'machines');
  key('tab', {shift: true}); assert.equal(view.section, 'look');
  assert.equal(view.legacyChoice, 0);
  view.section = 'machines'; view.legacyChoice = 1;
  key('enter'); assert.equal(view.machineEdit.action, 'rename');
  view.machineEdit = null; view.section = 'updates'; view.legacyChoice = 1;
  key('enter'); assert.equal(calls.at(-1)[0], 'app.update');
  view.section = 'look';
  layout = 'main'; assert.equal(key('tab'), false);
  assert.equal(view.section, 'look');
  assert.equal(stopped, 6);
});
