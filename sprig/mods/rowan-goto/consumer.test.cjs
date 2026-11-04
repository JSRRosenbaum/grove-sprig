const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function host(mod) {
  const calls = [], state = {spaces: [], panes: [], machines: [], scope: null, focus: null, keys: []};
  const el = () => { const p = new Proxy({}, {get: () => (...args) => { if (args.length === 2 && typeof args[1] === 'function' && args[0]) args[1](p); return p; }}); return p; };
  const input = () => { let value = '', handlers = {}; return {on(k, f) {handlers[k] = f;}, value: () => value, set_value(v) {value = v; handlers.change?.(null, cx);}, focus() {}}; };
  const cx = {focus_handle: () => ({focus() {}}), notify() {}, stop_propagation() {}};
  const env = {View: class {}, div:el, v_flex:el, h_flex:el, Input:{new:el}, InputState:{new:input},
    spaces:()=>state.spaces, panes:()=>state.panes, machines:()=>state.machines, focused:()=>state.focus,
    shared:()=>state.scope, keys:()=>state.keys, window:()=>({layout_name:'rowan-terminal'}), props:()=>({overlay:'o'}), theme:()=>({}),
    closeOverlay:()=>calls.push(['close']), run:(...args)=>calls.push(args)};
  const source = fs.readFileSync(path.join(__dirname, '..', mod, 'main.js'), 'utf8').replace(/^import .*;\n/gm, '').replace(/export default class (\w+)/, 'class $1').replace(/export function /g, 'function ');
  const name = { 'rowan-goto':'Goto', 'rowan-navigate':'Navigate', 'rowan-help':'Help' }[mod];
  vm.runInNewContext(`${source}\nglobalThis.Class = ${name}`, env);
  const instance = new env.Class();
  return {state, calls, instance, init:()=>instance.init({}, cx), key:(key, modifiers={})=>instance.key({key, modifiers}, cx)};
}
const space = (id,machine=null) => ({id,machine,name:id,tabs:[{id:id+'-tab',name:id+' tab'}]});
const pane = (id,tab,status) => ({pane:id,terminal:'term-'+id,tab,title:id,status,program:{name:'shell'}});
function fixture(h) {
  h.state.spaces=[space('a'),space('b','remote')]; h.state.panes=[pane('p1','a-tab','working'),pane('p2','a-tab','blocked'),pane('p3','b-tab','done')];
  h.state.machines=[{name:null,layout:'ready'},{name:'remote',layout:'ready'}]; h.state.scope={spaceIds:['a','b'],orderedIds:['b','a'],machineKeys:['@local','remote'],labels:{}};
  h.state.focus={space:'a',tab:'a-tab',pane:'p1'};
}
test('goto exposes every pane, filters status, selects exact pane and rejects stale targets',()=>{
  const h=host('rowan-goto'); fixture(h); h.init();
  assert.deepEqual(Array.from(h.instance.rows().filter(r=>r.kind==='pane'),r=>r.p.pane),['p1','p2','p3']);
  h.key('b'); const blocked=h.instance.rows().find(r=>r.kind==='pane'); assert.equal(blocked.p.pane,'p2');
  h.instance.go(blocked); assert.deepEqual(h.calls.map(c=>c[0]),['close','space.select','tab.select','pane.focus']); assert.equal(h.calls[3][1].pane,'p2');
  h.calls.length=0; h.state.machines[0].layout='unavailable'; h.instance.go(blocked); assert.equal(h.calls.length,0);
  h.state.machines[0].layout='ready'; h.state.panes=h.state.panes.filter(p=>p.pane!=='p2'); h.instance.go(blocked); assert.equal(h.calls.length,0);
});
test('goto activates a ready empty machine and refuses it after herd or connection changes',()=>{
  const h=host('rowan-goto'); fixture(h);
  h.state.scope.machineKeys.push('empty'); h.state.machines.push({name:'empty',layout:'ready'}); h.init();
  const row=h.instance.rows().find(r=>r.kind==='machine' && r.machine==='empty');
  h.instance.go(row); assert.equal(h.calls[1][0],'machine.select'); assert.equal(h.calls[1][1].machine,'empty');
  h.calls.length=0; h.state.scope.machineKeys.pop(); h.instance.go(row); assert.equal(h.calls.length,0);
  h.state.scope.machineKeys.push('empty'); h.state.machines[2].layout='unavailable'; h.instance.go(row); assert.equal(h.calls.length,0);
});
test('goto retains target identity across row removal and refuses a vanished target',()=>{
  const h=host('rowan-goto'); fixture(h); h.init(); h.key('j');
  h.state.panes=h.state.panes.filter(p=>p.pane!=='p1'); h.key('enter');
  assert.equal(h.calls[3][1].pane,'p2');
  h.calls.length=0; h.state.panes=h.state.panes.filter(p=>p.pane!=='p2'); h.key('enter'); assert.equal(h.calls.length,0);
  h.key('j'); h.key('enter'); assert.notEqual(h.calls.length,0);
});
test('goto workspace jumps from machine header use that header boundary',()=>{
  const h=host('rowan-goto'); fixture(h); h.init();
  const rows=h.instance.rows(); h.instance.choose(rows, rows.findIndex(r=>r.kind==='machine' && r.machine==='remote'));
  h.key('right'); assert.equal(h.instance.rows()[h.instance.at].p.pane,'p3');
  h.instance.choose(rows, rows.findIndex(r=>r.kind==='machine' && r.machine==='remote'));
  h.key('left'); assert.equal(h.instance.rows()[h.instance.at].p.pane,'p1');
});
test('goto workspace jumps and search transitions preserve query on escape',()=>{
  const h=host('rowan-goto'); fixture(h); h.init(); h.key('right'); assert.equal(h.instance.rows()[h.instance.at].p.pane,'p3');
  h.key('/'); assert.equal(h.instance.searching,true); h.instance.input.set_value('p2'); assert.equal(h.instance.rows().filter(r=>r.kind==='pane')[0].p.pane,'p2');
  h.key('escape'); assert.equal(h.instance.searching,false); assert.equal(h.instance.query,'p2'); h.key('escape'); assert.equal(h.calls[0][0],'close');
});
test('navigate respects configured keys, blocks foreign actions until accepted and cancels prefix',()=>{
  const h=host('rowan-navigate'); fixture(h); h.state.keys=[{section:'layout:rowan-terminal',keys:'ctrl-b escape',action:'legacy.prefix_cancel'},{section:'layout:rowan-terminal',keys:'ctrl-b s',action:'mod.open:rowan-navigate'},{section:'mod:rowan-navigate',keys:'j',action:'rowan-navigate.workspace-down'},{section:'layout:rowan-terminal',keys:'ctrl-b c',action:'tab.new'}]; h.init();
  h.key('j'); assert.equal(h.instance.preview,'b'); h.key('c'); assert.equal(h.calls.length,0); assert.match(h.instance.notice,/Confirm/);
  h.key('enter'); assert.equal(h.calls[1][0],'space.select'); assert.equal(h.calls[1][1].id,'b');
  h.calls.length=0; h.init(); h.key('b',{control:true}); assert.equal(h.calls[0][0],'close');
});
test('navigate dispatches effective suffix with preview context and rejects stale previews',()=>{
  const h=host('rowan-navigate'); fixture(h);
  h.state.keys=[{section:'layout:rowan-terminal',keys:'ctrl-x escape',action:'legacy.prefix_cancel'}, {section:'layout:rowan-terminal',keys:'ctrl-x c',action:'tab.new'}];
  h.init(); h.key('c'); assert.equal(h.calls[1][0],'legacy.key'); assert.equal(h.calls[1][1].keys,'ctrl-x c'); assert.equal(h.calls[1][1].space,'a');
  h.calls.length=0; h.init(); h.state.machines[0].layout='unavailable'; h.key('enter'); assert.equal(h.calls.length,0);
});
test('help navigation uses effective keys and search escape closes search first',()=>{
  const h=host('rowan-help'); h.state.keys=[{section:'global',keys:'x',action:'old'},{section:'layout:rowan-terminal',keys:'x',action:'new'}]; h.init();
  assert.equal(h.instance.rows().length,1); assert.equal(h.instance.rows()[0].action,'new'); h.key('/'); h.instance.input.set_value('new'); h.key('escape'); assert.equal(h.instance.query,''); assert.equal(h.calls.length,0); h.key('?'); assert.equal(h.calls[0][0],'close');
});
