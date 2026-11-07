// Modified from Herdr 0.1.7 for Square Dracula.
// Upstream: https://github.com/herdrdev/herdr-app (Apache-2.0).

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, panes, run, openOverlay, exec, hc, readDocument, writeDocument, theme, shared, setShared, watchFolder, window, focused, nextCommand, settings, keys, revisions } from "herdr";

// Every read of a host list copies the whole list into the script, so the model
// is taken once per change and handed down. `revisions` names the parts watched:
// it costs nothing while nothing moved, and says when something did.
let _seen = null, _model = null, _lastPs = null;
function model() {
  const r = revisions(["spaces", "panes", "machines", "focused"]);
  if (_seen && r.spaces === _seen.spaces && r.panes === _seen.panes &&
      r.machines === _seen.machines && r.focused === _seen.focused) return _model;
  _seen = r;
  _model = { sp: spaces(), ps: panes(), ms: machines(), fc: focused() };
  // Cached for callers outside a render (the hierarchy poll): `revisions()`
  // subscribes to the calling context, so anything below render() reads this
  // cache instead of the store. Addresses are then at most one render stale.
  _lastPs = _model.ps;
  return _model;
}

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane). The
// first pane of a tab that reports a folder is that tab's folder, so one pass
// over the panes answers every space instead of a scan for each.
let _ps = null, _tabs = null;
function tabFolders(ps) {
  if (ps !== _ps) {
    _ps = ps;
    _tabs = new Map();
    ps.forEach((p, i) => { if (p.cwd && !_tabs.has(p.tab)) _tabs.set(p.tab, [i, p.cwd]); });
  }
  return _tabs;
}
function place(s, ps) {
  const tabs = tabFolders(ps);
  let best = null;
  for (const c of s.tabs ?? []) {
    const at = tabs.get(c.id);
    if (at && (best === null || at[0] < best[0])) best = at;
  }
  return best ? best[1] : s.folder;
}

// The address a space answers to: the focused terminal in the tab it shows,
// else its first terminal. Remote ids already carry the machine prefix, so this
// reads exactly as `hc` and the agents name a terminal (t13, nix/t13). One pass
// over the panes builds the index, as tabFolders does for folders.
let _psRef = null, _tabRefs = null;
function tabRefs(ps) {
  if (ps !== _psRef) {
    _psRef = ps;
    _tabRefs = new Map();
    ps.forEach(p => {
      if (!p.terminal) return;
      if (!_tabRefs.has(p.tab) || p.focused) _tabRefs.set(p.tab, p.terminal);
    });
  }
  return _tabRefs;
}
function ref(s, ps) {
  const byTab = tabRefs(ps), tabs = s.tabs ?? [];
  const shown = tabs.find(c => c.active) ?? tabs[0];
  for (const c of (shown ? [shown, ...tabs.filter(x => x !== shown)] : tabs)) {
    const at = byTab.get(c.id);
    if (at) return at;
  }
  return null;
}
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "idle" ? "○" : status === "blocked" || status === "done" || status === "working" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    this.git = {}; this.checked = {}; this.unsure = new Set(); this.pending = new Set(); this.inFlight = new Set(); this.gitMachine = {};
    this.hierarchy = new Map(); this.verified = new Map(); this.gitRevision = 0;
    this.busy = {}; this.ready = {}; this.at = {}; this.watching = new Set();
    this.shown = new Set(spaces().map(s => s.id)); this.born = {}; this.machines = [];
    this.handle = cx.focus_handle();
    this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
    for (const state of Object.values(this.reconnecting)) state.busy = false;
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.repoFolded = new Set(JSON.parse(localStorage.getItem("repos.folded") ?? "[]"));
    this.state = JSON.parse(localStorage.getItem("rowan.state") ?? "null") || {
      herds: [{id: 0, members: ["@local"], last: null}], active: 0, labels: {}, nextLabel: 1
    };
    this.state.profiles ??= {};
    this.menuMachine = null; this.selecting = null; this.scopeJson = "";
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    cx.timer.every(250, cx => this.checkNew(cx));
    cx.spawn(async cx => { for (;;) { const command = await nextCommand(); this.command(command, cx); cx.notify(); } });
  }
  save() { localStorage.setItem("rowan.state", JSON.stringify(this.state)); }
  herd() { return this.state.herds.find(h => h.id === this.state.active) || this.state.herds[0]; }
  machineKey(machine) {
    if (machine == null) return "@local";
    const current = this.machines.find(m => m.name === machine && m.id);
    if (current) return `id:${current.id}`;
    const found = Object.entries(this.state.profiles).find(([, name]) => name === machine);
    return found ? found[0] : `name:${machine}`;
  }
  machineName(key) { return key === "@local" ? null : this.state.profiles[key] ?? key.slice(5); }
  spaceKey(s) {
    const prefix = s.machine ? `${s.machine}/` : "";
    const localId = prefix && s.id.startsWith(prefix) ? s.id.slice(prefix.length) : s.id;
    return JSON.stringify([this.machineKey(s.machine), localId]);
  }
  inventory(sp) {
    let changed = false;
    for (const m of this.machines) {
      if (!m.id || !m.name) continue;
      const id = `id:${m.id}`, old = `name:${m.name}`;
      const replaced = Object.entries(this.state.profiles).find(([key, name]) =>
        key !== id && name === m.name && !this.machines.some(other => `id:${other.id}` === key))?.[0];
      if (replaced) {
        for (const herd of this.state.herds)
          herd.members = [...new Set(herd.members.map(key => key === replaced ? id : key))];
        for (const [key, value] of Object.entries(this.state.labels)) {
          const parts = JSON.parse(key);
          if (parts[0] !== replaced) continue;
          this.state.labels[JSON.stringify([id, parts[1]])] ??= value;
          delete this.state.labels[key];
        }
        delete this.state.profiles[replaced];
        changed = true;
      }
      const previous = this.state.profiles[id];
      if (previous && previous !== m.name) {
        const prefix = `${previous}/`, replacement = `${m.name}/`;
        const renamed = value => typeof value === "string" && value.startsWith(prefix)
          ? replacement + value.slice(prefix.length) : value;
        for (const h of this.state.herds) {
          if (!h.members.includes(id) || !h.last?.space?.startsWith(prefix)) continue;
          h.last = {space: renamed(h.last.space), tab: renamed(h.last.tab), pane: renamed(h.last.pane)};
        }
        if (this.folded.delete(previous)) {
          this.folded.add(m.name);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        }
        let repoChanged = false;
        for (const repo of [...this.repoFolded]) {
          const parts = JSON.parse(repo);
          if (parts[0] !== previous) continue;
          this.repoFolded.delete(repo); this.repoFolded.add(JSON.stringify([m.name, parts[1]]));
          repoChanged = true;
        }
        if (repoChanged) localStorage.setItem("repos.folded", JSON.stringify([...this.repoFolded]));
        this.selecting = null;
      }
      if (previous !== m.name) { this.state.profiles[id] = m.name; changed = true; }
      for (const h of this.state.herds) {
        const i = h.members.indexOf(old);
        if (i >= 0) { h.members[i] = id; changed = true; }
      }
      for (const [key, value] of Object.entries(this.state.labels)) {
        const parts = JSON.parse(key);
        if (parts[0] === old) { this.state.labels[JSON.stringify([id, parts[1]])] = value; delete this.state.labels[key]; changed = true; }
      }
    }
    const keys = new Set(["@local", ...this.machines.map(m => this.machineKey(m.name)), ...machines().map(m => this.machineKey(m.name)), ...Object.keys(this.reconnecting).map(name => this.machineKey(name)), ...sp.map(s => this.machineKey(s.machine))]);
    for (const key of keys) if (!this.state.herds.some(h => h.members.includes(key))) { this.state.herds[0].members.push(key); changed = true; }
    for (const h of this.state.herds) if (!h.sectionOrder) {
      h.members.sort((a,b) => a === "@local" ? -1 : b === "@local" ? 1 : this.machineName(a).localeCompare(this.machineName(b)));
      h.sectionOrder = true; changed = true;
    }
    for (const s of sp) {
      const key = this.spaceKey(s);
      if (!this.state.labels[key]) { this.state.labels[key] = `w${(this.state.nextLabel++).toString(36).toUpperCase()}`; changed = true; }
    }
    if (changed) this.save();
  }
  label(s) { return this.state.labels[this.spaceKey(s)]; }
  refOf(s) { return ref(s, _lastPs); }
  remember(sp, ps) {
    const f = focused(), h = this.herd();
    if (this.selecting) {
      if (f?.space === this.selecting.space && (!this.selecting.tab || f.tab === this.selecting.tab) && (!this.selecting.pane || f.pane === this.selecting.pane)) this.selecting = null;
      else if (Date.now() < this.selecting.until && sp.some(s => s.id === this.selecting.space)) return;
      else this.selecting = null;
    }
    const s = sp.find(s => s.id === f?.space && h.members.includes(this.machineKey(s.machine)));
    if (!s || !s.tabs.some(t => t.id === f.tab)) return;
    const pane = ps.some(p => p.tab === f.tab && p.pane === f.pane) ? f.pane : null;
    const last = {space: s.id, tab: f.tab, pane};
    if (JSON.stringify(h.last) !== JSON.stringify(last)) { h.last = last; this.save(); }
  }
  select(s, last) {
    if (!s || !this.herd().members.includes(this.machineKey(s.machine))) return;
    if (machines().find(m => m.name === s.machine)?.layout !== "ready") return;
    const tab = last && s.tabs.find(t => t.id === last.tab);
    const pane = tab && panes().find(p => p.tab === tab.id && p.pane === last.pane);
    this.selecting = {space: s.id, tab: tab?.id || null, pane: pane?.pane || null, until: Date.now() + 1500};
    run("space.select", {id: s.id});
    if (tab) run("tab.select", {id: tab.id});
    if (pane) run("pane.focus", {pane: pane.pane});
  }
  switchHerd(id) {
    const target = this.state.herds.find(h => h.id === id);
    if (!target || id === this.state.active) return;
    this.order = (this.order ?? 0) + 1;
    this.remember(spaces(), panes()); this.selecting = null;
    this.drag = null; this.machineDrag = null;
    this.state.active = id; this.menuMachine = null; this.save();
    const available = spaces().filter(s => target.members.includes(this.machineKey(s.machine)) &&
      machines().some(m => m.name === s.machine && m.layout === "ready"));
    const remembered = available.find(s => s.id === target.last?.space);
    const first = this.ordered().map(r => r.w).find(s => available.some(a => a.id === s.id)) ?? available[0];
    if (remembered) this.select(remembered, target.last);
    else if (first) this.select(first, null);
  }
  command(c, cx) {
    const h = this.herd(), all = this.state.herds, at = all.indexOf(h);
    if (c === "prefix-cancel") return;
    const worktree = /^worktree-(new|open|remove)(?::(.+))?$/.exec(c);
    if (worktree) {
      let target = focused()?.space;
      if (worktree[2]) { try { target = decodeURIComponent(worktree[2]); } catch { return; } }
      const current = spaces().find(s => s.id === target && h.members.includes(this.machineKey(s.machine)));
      if (!current || !machines().some(m => m.name === current.machine && m.layout === "ready")) return;
      const action = worktree[1];
      const folder = (focused()?.space === current.id && focused()?.cwd) || place(current, panes());
      openOverlay({mod: "worktree", kind: "dialog", frame: "none",
        ...(action === "open" ? {width: 560, height: 480} : {width: 460, height: 280}),
        props: {space: current.id, machine: current.machine, folder, action}});
      return;
    }
    if (c === "focus") {
      this.cursor = focused()?.space;
      this.handle.focus();
      return;
    }
    if (c.startsWith("machine-reconnect:")) {
      let name; try { name = decodeURIComponent(c.slice(18)); } catch { return; }
      const machine = this.machines.find(m => m.name === name) ?? this.reconnecting[name]?.machine;
      if (cx && machine && h.members.includes(this.machineKey(name))) this.reconnect(machine, cx);
      return;
    }
    if (c === "font-smaller") { this.setFontRatio(this.fontMetrics().ratio * 100 - 5); return; }
    if (c === "font-larger") { this.setFontRatio(this.fontMetrics().ratio * 100 + 5); return; }
    if (c === "font-reset") { this.setFontRatio(80); return; }
    if (/^font-ratio:\d+(?:\.\d+)?$/.test(c)) { this.setFontRatio(Number(c.slice(11))); return; }
    if (c === "inspect") setShared("rowan.sidebar.inspect", {state: this.state, order: this.ordered().map(r => r.w.id), repos: this.ordered().filter(r => r.g).map(r => r.g.repo), hierarchy: [...this.hierarchy.values()].map(s => ({machine: s.on, identity: s.identity, attempted: s.attempted, busy: s.busy, error: s.error}))});
    else if (c.startsWith("active:")) this.activeCommand(c.slice(7));
    else if (c === "herd-add") this.addHerd();
    else if (/^herd-select:\d+$/.test(c)) this.switchHerd(Number(c.slice(12)));
    else if (c.startsWith("machine-reorder:")) {
      const match = /^machine-reorder:([^:]+):(up|down)$/.exec(c);
      if (match) {
        let name; try { name = decodeURIComponent(match[1]); } catch { return; }
        this.shiftMachine(this.profileKey(name), match[2] === "up" ? -1 : 1);
      }
    } else if (c.startsWith("machine-move:")) {
      const match = /^machine-move:([^:]+):(\d+)$/.exec(c);
      if (match) {
        let name; try { name = decodeURIComponent(match[1]); } catch { return; }
        const key = this.profileKey(name), target = all.find(x => x.id === Number(match[2]));
        if (target && all.some(x => x.members.includes(key))) this.moveMachine(key, target);
      }
    } else if (c.startsWith("machine-toggle:")) {
      let name; try { name = decodeURIComponent(c.slice(15)); } catch { return; }
      const key = this.profileKey(name);
      if (h.members.includes(key)) this.toggleMachine(key);
    } else if (c.startsWith("repo-toggle:")) {
      let repo; try { repo = decodeURIComponent(c.slice(12)); } catch { return; }
      if (this.ordered().some(r => r.g?.repo === repo)) this.toggleRepo(repo);
    }
    else if (c === "herd-prev" || c === "herd-next") this.switchHerd(all[(at + (c === "herd-next" ? 1 : -1) + all.length) % all.length].id);
    else if (c === "workspace-prev" || c === "workspace-next" || /^workspace-select:\d+$/.test(c)) {
      const numeric = c.startsWith("workspace-select:");
      const rows = this.ordered().filter(r => h.members.includes(this.machineKey(r.w.machine)) &&
        (numeric || machines().some(m => m.name === r.w.machine && m.layout === "ready")));
      if (!rows.length) return;
      const i = rows.findIndex(r => r.w.id === focused()?.space);
      const n = c.startsWith("workspace-select:") ? Number(c.slice(17)) - 1 : i < 0 ? (c === "workspace-next" ? 0 : rows.length - 1) : (i + (c === "workspace-next" ? 1 : -1) + rows.length) % rows.length;
      if (rows[n]) this.select(rows[n].w, null);
    }
  }
  keyboard(event, cx) {
    if (event.modifiers.control || event.modifiers.platform || event.modifiers.alt) return;
    const rows = this.ordered().filter(r => machines().some(m => m.name === r.w.machine && m.layout === "ready"));
    if (event.key === "escape") {
      this.cursor = null;
      run("pane.go", {direction: "right"});
    } else if ((event.key === "up" || event.key === "down") && rows.length) {
      const index = rows.findIndex(r => r.w.id === (this.cursor ?? focused()?.space));
      const next = index < 0 ? (event.key === "down" ? 0 : rows.length - 1)
        : (index + (event.key === "down" ? 1 : -1) + rows.length) % rows.length;
      this.cursor = rows[next].w.id;
    } else if (event.key === "enter") {
      const row = rows.find(r => r.w.id === this.cursor);
      if (row) { this.cursor = null; this.select(row.w, null); }
    } else return;
    cx.stop_propagation();
    cx.notify();
  }
  fontMetrics() {
    const saved = shared("rowan.sidebar.fontRatio");
    const ratio = typeof saved === "number" && Number.isFinite(saved) && saved >= 0.6 && saved <= 1.2 ? saved : 0.8;
    const configured = settings().font_size;
    const terminalSize = typeof configured === "number" && Number.isFinite(configured) && configured > 0 ? configured : 15;
    const fontSize = Math.round(terminalSize * ratio * 100) / 100;
    return {ratio, fontSize, rowHeight: Math.ceil(fontSize * 1.45)};
  }
  setFontRatio(percent) {
    if (!Number.isFinite(percent)) return;
    const ratio = Math.max(60, Math.min(120, Math.round(percent / 5) * 5)) / 100;
    if (shared("rowan.sidebar.fontRatio") !== ratio) setShared("rowan.sidebar.fontRatio", ratio);
  }
  activeCommand(action) {
    const current = spaces().find(s => s.id === focused()?.space &&
      this.herd().members.includes(this.machineKey(s.machine)));
    if (!current || !machines().some(m => m.name === current.machine && m.layout === "ready")) return;
    if (action === "space.new") { run("space.new", {machine: current.machine}); return; }
    if (action === "space.rename") { run("space.rename", {id: current.id}); return; }
    if (action === "space.close") { run("space.close", {id: current.id}); return; }
    const move = /^tab\.move:(left|right)$/.exec(action);
    if (move) {
      const index = current.tabs.findIndex(t => t.id === focused()?.tab);
      const target = index + (move[1] === "left" ? -1 : 1);
      if (index >= 0 && target >= 0 && target < current.tabs.length)
        run("tab.move", {id: current.tabs[index].id, index: target + 1});
      return;
    }
    const simple = ["tab.new", "tab.close", "tab.rename", "tab.next", "tab.prev",
      "pane.close", "pane.zoom", "terminal.copy", "terminal.paste", "terminal.paste_image"];
    if (simple.includes(action)) { run(action); return; }
    const tab = /^tab\.select:([1-9])$/.exec(action);
    if (tab) { run("tab.select", {index: Number(tab[1])}); return; }
    const pane = /^pane\.(go|swap|split):(left|right|up|down)$/.exec(action);
    if (pane && (pane[1] !== "split" || pane[2] === "right" || pane[2] === "down")) {
      run(`pane.${pane[1]}`, {direction: pane[2]});
    }
  }
  profileKey(name) {
    if (name === "@local" || name.startsWith("id:") || name.startsWith("name:")) return name;
    return this.machineKey(name);
  }
  addHerd() {
    const id = Math.max(...this.state.herds.map(x => x.id)) + 1;
    this.state.herds.push({id, members: [], last: null, sectionOrder: true}); this.save(); this.switchHerd(id);
  }
  toggleMachine(key) {
    const machine = this.machineName(key);
    this.folded.has(machine) ? this.folded.delete(machine) : this.folded.add(machine);
    localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
  }
  toggleRepo(repo) {
    this.repoFolded.has(repo) ? this.repoFolded.delete(repo) : this.repoFolded.add(repo);
    localStorage.setItem("repos.folded", JSON.stringify([...this.repoFolded]));
  }
  reorderMachine(key, target) {
    const members = this.herd().members, from = members.indexOf(key), to = members.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    members.splice(to, 0, members.splice(from, 1)[0]);
    this.menuMachine = null; this.save();
  }
  shiftMachine(key, direction) {
    const members = this.herd().members, from = members.indexOf(key);
    if (from >= 0 && members[from + direction]) this.reorderMachine(key, members[from + direction]);
  }
  startMachineDrag(key, event) {
    this.drag = null; this.menuMachine = null;
    this.machineDrag = this.herd().members.includes(key)
      ? {key, herd: this.herd().id, start: event.position, moved: false, over: null} : null;
  }
  dragMachineOver(key, event, cx) {
    const d = this.machineDrag;
    if (!d || d.herd !== this.herd().id) return;
    if (!d.moved && Math.hypot(event.position.x - d.start.x, event.position.y - d.start.y) < 4) return;
    const over = key !== d.key && this.herd().members.includes(key) ? key : null;
    if (!d.moved || d.over !== over) { d.moved = true; d.over = over; cx.notify(); }
  }
  finishMachineDrag(key, cx) {
    const d = this.machineDrag; this.machineDrag = null;
    if (!d || d.herd !== this.herd().id || !this.herd().members.includes(d.key)) return;
    if (d.moved && d.over === key) this.reorderMachine(d.key, key);
    else if (!d.moved && d.key === key) this.toggleMachine(key);
    cx.notify();
  }
  startDrag(w, event) {
    this.machineDrag = null;
    this.cursor = null;
    this.drag = machines().some(m => m.name === w.machine && m.layout === "ready")
      ? {id: w.id, start: event.position, moved: false, over: null} : null;
  }
  dragOver(w, event, cx) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(event.position.x - d.start.x, event.position.y - d.start.y) < 4) return;
    const source = spaces().find(s => s.id === d.id);
    const over = source && source.machine === w.machine && w.id !== source.id ? w.id : null;
    if (!d.moved || d.over !== over) {
      d.moved = true; d.over = over; cx.notify();
    }
  }
  finishDrag(w, cx) {
    const d = this.drag; this.drag = null;
    if (!d) return;
    const all = spaces(), source = all.find(s => s.id === d.id), target = all.find(s => s.id === w.id);
    if (source && target && source.machine === target.machine &&
        this.herd().members.includes(this.machineKey(source.machine)) &&
        machines().some(m => m.name === source.machine && m.layout === "ready")) {
      if (d.moved && d.over === target.id) this.queueMove(source, target);
      else if (!d.moved && source.id === target.id) this.select(source, null);
    }
    cx.notify();
  }
  cancelDrag(cx) {
    if (this.drag || this.machineDrag) { this.drag = null; this.machineDrag = null; cx.notify(); }
  }
  moveSpace(w, direction) {
    const same = this.ordered().map(r => r.w).filter(s => s.machine === w.machine);
    const i = same.findIndex(s => s.id === w.id), other = same[i + direction];
    if (!other || machines().find(m => m.name === w.machine)?.layout !== "ready") return;
    this.queueMove(w, other);
  }
  queueMove(source, target) {
    const ids = spaces().filter(s => s.machine === source.machine).map(s => s.id);
    const from = ids.indexOf(source.id), to = ids.indexOf(target.id);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    this.ordering = {machine: source.machine, ids, at: 0};
    this.reconcileOrder(Date.now());
  }
  reconcileOrder(now) {
    const pending = this.ordering;
    if (!pending) return;
    const all = spaces().slice(), current = all.filter(s => s.machine === pending.machine).map(s => s.id);
    // A new/deleted workspace invalidates this explicit drag; never reorder it by guess.
    if (current.length !== pending.ids.length || current.some(id => !pending.ids.includes(id)) ||
        !this.herd().members.includes(this.machineKey(pending.machine))) {
      this.ordering = null;
      return;
    }
    const machine = machines().find(m => m.name === pending.machine);
    // spaces() is optimistic; only the core's document can retire this intent.
    if (machine?.space_order?.length === pending.ids.length &&
        machine.space_order.every((id, i) => id === pending.ids[i])) { this.ordering = null; return; }
    if (current.every((id, i) => id === pending.ids[i])) return;
    if (now - pending.at < 1000 || machine?.layout !== "ready") return;
    pending.at = now;
    for (let i = 0; i < pending.ids.length; i++) {
      const from = current.indexOf(pending.ids[i]);
      if (from === i) continue;
      const index = all.findIndex(s => s.id === current[i]);
      run("space.move", {id: pending.ids[i], index: index + 1});
      const moved = all.splice(all.findIndex(s => s.id === pending.ids[i]), 1)[0];
      all.splice(index, 0, moved);
      current.splice(i, 0, current.splice(from, 1)[0]);
    }
  }
  moveMachine(key, target) {
    if (target.members.includes(key)) { this.menuMachine = null; return; }
    for (const h of this.state.herds) h.members = h.members.filter(k => k !== key);
    target.members.push(key); this.menuMachine = null; this.save();
  }
  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    this.syncHierarchy(cx);
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    this.reconcileOrder(now);
    if (sp.some((s) => !this.shown.has(s.id))) cx.notify();
  }

  // Core stores the facts, not this window's ordering, selection or fold state.
  // A first document read precedes Git discovery; later reads share other
  // frontends' changes without rescanning their checkouts.
  syncHierarchy(cx) {
    const now = Date.now(), sp = spaces(), ps = panes();
    for (const m of machines()) {
      const on = m.name ?? null, identity = this.machineKey(on);
      let slot = this.hierarchy.get(on);
      if (!slot || slot.identity !== identity) {
        for (const key of Object.keys(this.git)) if (JSON.parse(key)[0] === on && this.gitMachine[key] !== identity) {
          delete this.git[key]; delete this.checked[key]; delete this.gitMachine[key];
          this.order = (this.order ?? 0) + 1;
          this.unsure.delete(key); this.verified.delete(key);
        }
        slot = {on, identity, ready: false, attempted: false, busy: false, dirty: true, next: 0, error: null};
        this.hierarchy.set(on, slot);
      }
      if (m.layout !== "ready") { slot.ready = false; continue; }
      if (!slot.ready) { slot.ready = true; slot.attempted = false; slot.next = 0; }
      const signature = JSON.stringify([
        sp.filter(s => (s.machine ?? null) === on).map(s => [s.id, place(s, ps)]).sort((a,b) => a[0].localeCompare(b[0])),
        m.space_order ?? null
      ]);
      if (signature !== slot.signature) { slot.signature = signature; slot.dirty = true; }
      if (slot.busy || (!slot.dirty && now < slot.next)) continue;
      slot.busy = true; slot.dirty = false; slot.next = now + 15000;
      cx.spawn(async cx => {
        try {
          await this.refreshHierarchy(slot, cx);
          slot.error = null;
        } catch (error) {
          slot.error = String(error.message ?? error);
          slot.next = Date.now() + 15000;
        } finally {
          slot.attempted = true; slot.busy = false;
          cx.notify();
        }
      });
    }
  }
  hierarchyCurrent(slot) {
    return this.hierarchy.get(slot.on) === slot && slot.identity === this.machineKey(slot.on) &&
      machines().some(m => (m.name ?? null) === slot.on && m.layout === "ready");
  }
  hierarchyValue(value) {
    if (value === null) return {schema: 1, spaces: {}};
    if (!value || value.schema !== 1 || !value.spaces || typeof value.spaces !== "object" || Array.isArray(value.spaces))
      throw new Error("Unsupported sprig-sidebar document; left unchanged");
    return value;
  }
  restoreHierarchy(slot, document, cx) {
    const ps = panes();
    for (const s of spaces()) {
      if ((s.machine ?? null) !== slot.on) continue;
      const id = JSON.parse(this.spaceKey(s))[1], entry = document.spaces[id], key = where(s, ps);
      if (!entry || entry.cwd !== place(s, ps) || this.verified.has(key) || this.inFlight.has(key)) continue;
      const g = entry.git;
      if (g !== null && (!g || typeof g.name !== "string" || typeof g.commonDir !== "string" || typeof g.linked !== "boolean")) continue;
      const info = g === null ? null : {name: g.name, repo: JSON.stringify([slot.on, g.commonDir]), linked: g.linked};
      if (!(key in this.git) || JSON.stringify(this.git[key]) !== JSON.stringify(info)) {
        this.git[key] = info; this.checked[key] = entry.at ?? Date.now();
        this.order = (this.order ?? 0) + 1;
        if (info === null) this.unsure.add(key);
      }
      this.gitMachine[key] = slot.identity;
      if (info && !slot.on) this.watch(g.commonDir, cx);
    }
  }
  async refreshHierarchy(slot, cx) {
    const options = {on: slot.on};
    // Read hierarchy first: a layout read before it could miss a workspace
    // another frontend has already added to the newer hierarchy snapshot.
    let snapshot = await readDocument("sprig-sidebar", options);
    let layout = await readDocument("herdr-app", options);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!this.hierarchyCurrent(slot)) return;
      const document = this.hierarchyValue(snapshot.value);
      if (layout.value !== null && (!Array.isArray(layout.value?.spaces) ||
          layout.value.spaces.some(s => !s || typeof s.id !== "string")))
        throw new Error("Cannot reconcile sidebar without a valid workspace document");
      const live = new Set((layout.value?.spaces ?? []).map(s => s.id));
      this.restoreHierarchy(slot, document, cx);
      const next = {...document, spaces: {...document.spaces}}, revisions = new Map(), ps = panes();
      // Only a fresh source-core layout can remove metadata. Missing optimistic
      // spaces(), a loading layout, and disconnected machines are not deletion.
      for (const id of Object.keys(next.spaces)) if (!live.has(id)) delete next.spaces[id];
      for (const s of spaces()) {
        if ((s.machine ?? null) !== slot.on) continue;
        const id = JSON.parse(this.spaceKey(s))[1], key = where(s, ps);
        if (!live.has(id) || !this.verified.has(key) || this.gitMachine[key] !== slot.identity || this.unsure.has(key)) continue;
        const info = this.git[key];
        if (info === undefined) continue;
        // Fresher-wins: a scan from another window that is newer than ours
        // owns the entry. Writing a stale scan back is what made two windows
        // on one machine flap the same row at each other.
        const scanned = this.checked[key] ?? 0;
        if (scanned < (document.spaces[id]?.at ?? 0)) continue;
        const entry = {cwd: place(s, ps), git: info === null ? null :
          {name: info.name, commonDir: JSON.parse(info.repo)[1], linked: info.linked}};
        // Publishing is idempotent: when our scan agrees with the published
        // entry, keep the document byte-identical - re-stamping an unchanged
        // entry every scan would notify every window and rebuild the whole
        // sidebar for nothing. Only content changes move a stamp.
        const was = document.spaces[id];
        const {at: wasAt, ...wasContent} = was ?? {};
        next.spaces[id] = JSON.stringify(wasContent) === JSON.stringify(entry) && wasAt !== undefined
          ? was : {...entry, at: scanned};
        revisions.set(key, this.verified.get(key));
      }
      let result;
      if (JSON.stringify(next) !== JSON.stringify(document)) {
        result = await writeDocument("sprig-sidebar", next, snapshot.version, options);
        if (!this.hierarchyCurrent(slot)) return;
      }
      if (!result || result.written) {
        for (const [key, revision] of revisions) if (this.verified.get(key) === revision) this.verified.delete(key);
        return;
      }
      snapshot = result;
      layout = await readDocument("herdr-app", options);
    }
    throw new Error("Sidebar changed concurrently; will reconcile on the next read");
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    for (const k of keys) {
      const on = JSON.parse(k)[0], identity = this.machineKey(on);
      if (k in this.gitMachine && this.gitMachine[k] !== identity) {
        delete this.git[k]; delete this.checked[k]; delete this.gitMachine[k]; this.unsure.delete(k);
        this.order = (this.order ?? 0) + 1;
        this.verified.delete(k);
      }
    }
    const due = new Set([...keys].filter((k) => !(k in this.git) && !this.inFlight.has(k) && !this.pending.has(k)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window()?.active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.inFlight.has(k) && !this.pending.has(k) && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return new Set([...due].filter(k => {
      const slot = this.hierarchy.get(JSON.parse(k)[0]);
      return !slot || (slot.ready && slot.attempted);
    }));
  }

  // Places sharing a repository may need rediscovery after a worktree operation.
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }
  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }
  reconnect(machine, cx) {
    const name = machine.name;
    if ((!this.rebuilt(machine) && !this.reconnecting[name]) || this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= {machine, removed: false};
    state.busy = true;
    state.error = null;
    const save = () => localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    save(); cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const reply = await hc([...args, "--json"]);
          if (reply.code !== 0) {
            let message;
            try { message = JSON.parse(reply.stdout || reply.stderr).error?.message; } catch {}
            throw new Error(message || reply.stderr || reply.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) { await ask(["machine", "rm", name]); state.removed = true; save(); }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target); else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (error) {
        state.error = String(error.message ?? error);
        state.busy = false;
      }
      save(); this.refreshMachines(cx); cx.notify();
    });
  }

  // Publish a complete discovery batch rather than moving worktrees one by one.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        keys.forEach(k => this.inFlight.add(k));
        const results = new Array(keys.length);
        let next = 0;
        await Promise.all(Array.from({length: Math.min(4, keys.length)}, async () => {
          for (;;) {
            const i = next++;
            if (i >= keys.length) return;
            results[i] = await this.identify(keys[i]);
          }
        }));
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i], result = results[i], on = JSON.parse(key)[0];
          if (result.machine !== this.machineKey(on)) { this.pending.add(key); continue; }
          this.checked[key] = Date.now();
          this.gitMachine[key] = result.machine;
          if (result.unsure) this.unsure.add(key); else this.unsure.delete(key);
          if (result.info !== undefined) this.git[key] = result.info;
          if (result.info !== undefined) {
            this.verified.set(key, ++this.gitRevision);
            const slot = this.hierarchy.get(on);
            if (slot) slot.dirty = true;
          }
          else this.git[key] ??= null;
          if (result.info && !on) this.watch(JSON.parse(result.info.repo)[1], cx);
        }
        this.order = (this.order ?? 0) + 1;
        this.syncHierarchy(cx);
        cx.notify();
        keys.forEach(k => this.inFlight.delete(k));
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // Repository identity does not require scanning a worktree's status.
  async identify(key) {
    const [on, cwd] = JSON.parse(key), machine = this.machineKey(on);
    try {
      const r = await exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], { cwd, on });
      if (r.code !== 0)
        return /not a git repository/i.test(r.stderr) ? {machine, info: null} : {machine, unsure: true};
      // Git's absolute path format is canonical; no separate realpath process
      // is needed (and that Unix utility is not available on every Windows host).
      const [top, repo] = r.stdout.trim().split(/\r?\n/).map(line => line.trim());
      if (!top || !repo) return {machine, unsure: true};
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = { name, repo: JSON.stringify([on, repo]), linked: repo !== `${top}/.git` };
      return {machine, info};
    } catch {
      return {machine, unsure: true};
    }
  }


  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }


  menu(w) { openOverlay({mod: "menu", kind: "popup", frame: "none", width: 200, height: 260, props: {tab: "space", target: {id: w.id}}}); }
  ordered() {
    const { sp, ps } = model();
    // The rows change with the model, the git information, the shown set or the
    // herd; every other render takes the rows it already has.
    const rev = revisions(["spaces", "panes"]);
    const stamp = `${rev.spaces}:${rev.panes}:${this.order ?? 0}:${this.herd().id}`;
    if (this._rows && this._stamp === stamp) return this._rows;
    for (const w of sp) if (!this.shown.has(w.id) && (where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500)) this.shown.add(w.id);
    const list = sp.map(w => ({w, g: this.git[where(w, ps)] ?? null}));
    // A repository is scoped by the complete machine profile and canonical common dir.
    const repos = new Map();
    for (const row of list) if (row.g) { const b = repos.get(row.g.repo) ?? []; b.push(row); repos.set(row.g.repo, b); }
    const out = [], emitted = new Set();
    for (const row of list) {
      if (!row.g) { out.push(row); continue; }
      if (emitted.has(row.g.repo)) continue;
      emitted.add(row.g.repo);
      out.push(...(repos.get(row.g.repo) ?? []).sort((a,b) => Number(a.g.linked) - Number(b.g.linked)));
    }
    // Machine headings determine the actual sidebar and keyboard order.
    const keys = this.herd().members;
    const byMachine = new Map(keys.map(k => [k, []]));
    for (const row of out) { const b = byMachine.get(this.machineKey(row.w.machine)); if (b && this.shown.has(row.w.id)) b.push(row); }
    this._stamp = stamp;
    return (this._rows = keys.flatMap(k => byMachine.get(k)));
  }
  row(r, t, compact, machines) {
    const w = r.w, active = w.active;
    const ready = machines.some(m => m.name === w.machine && m.layout === "ready");
    const status = r.groupStatus ?? w.status;
    const drop = this.drag?.moved && this.drag.over === w.id;
    const all = drop ? spaces() : [];
    const below = drop && all.findIndex(s => s.id === this.drag.id) < all.findIndex(s => s.id === w.id);
    const line = h_flex().relative().id(`space-${w.id}`).h(this.metrics.rowHeight).flex_none().px(compact ? 3 : 14).gap(4).items_center()
      .when(active, e => e.bg(t.selected)).hover(e => e.bg(t.hover)).cursor_pointer()
      .when(this.cursor === w.id, e => e.border_1().border_color(t.accent))
      .on_hover((on, cx) => {
        this.hoveredSpace = on ? w.id : this.hoveredSpace === w.id ? null : this.hoveredSpace;
        cx.notify();
      })
      .on_mouse_down("left", event => this.startDrag(w, event))
      .on_mouse_move((event, cx) => this.dragOver(w, event, cx))
      .on_mouse_up("left", (_event, cx) => this.finishDrag(w, cx))
      .on_mouse_down("right", () => this.menu(w))
      .when(this.drag?.moved && this.drag.id === w.id, e => e.opacity(0.6))
      .when(drop, e => e.child(div().absolute().left(0).right(0).h(2).bg(t.accent)
        .when(below, e => e.bottom(0)).when(!below, e => e.top(0))))
      .when(!compact, e => e.child(div().w(Math.ceil(this.metrics.fontSize * 1.4)).flex_none().text_color(t.muted)
        .when(Boolean(r.foldRepo), e => e.cursor_pointer()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); this.toggleRepo(r.foldRepo); cx.notify(); }))
        .child(r.foldRepo ? (this.repoFolded.has(r.foldRepo) ? "▸" : "▾") : (r.tree || ""))))
      .child(div().w(this.metrics.fontSize * 0.8).flex_none().text_color(ready ? tone(t, status) : t.muted)
        .child(ready ? glyph(status) : "·"))
      .tooltip(`${ref(w, model().ps) ?? "no terminal"} · ${this.machineName(this.machineKey(w.machine)) ?? "this computer"}` +
        (w.folder ? ` · ${w.folder}` : ""));
    if (compact) return line.child(div().min_w(0).truncate().text_color(t.muted).child(this.refOf(w) || "…"));
    return line
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground)
        .when(active, e => e.font_semibold()).child(w.name))
      .when(this.hoveredSpace === w.id, e => e
        .child(div().id(`space-up-${w.id}`).text_color(t.muted).cursor_pointer()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e,cx) => { cx.stop_propagation(); this.moveSpace(w, -1); }).child("↑"))
        .child(div().id(`space-down-${w.id}`).text_color(t.muted).cursor_pointer()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e,cx) => { cx.stop_propagation(); this.moveSpace(w, 1); }).child("↓")))
      .child(div().w(Math.ceil(this.metrics.fontSize * 3.6)).flex_none().min_w(0).truncate().text_right().text_color(t.muted)
        .cursor_pointer()
        .tooltip(this.refOf(w) ? `Copy its address (hc get ${this.refOf(w)})` : "This workspace has no terminal yet")
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); const at = this.refOf(w); if (at) cx.write_to_clipboard(at); })
        .child(this.refOf(w) || "…"));
  }
  grouped(t, compact, rows, machines) {
    const h = this.herd();
    const keys = h.members;
    return keys.flatMap((key, index) => {
      const machine = this.machineName(key);
      const layout = machines.find(m => m.name === machine)?.layout;
      const repair = this.reconnecting[machine];
      const profile = this.machines.find(m => m.name === machine) ?? repair?.machine;
      const rebuilt = this.rebuilt(profile) || Boolean(repair);
      const folded = this.folded.has(machine), mine = rows.filter(r => this.machineKey(r.w.machine) === key);
      const drop = this.machineDrag?.moved && this.machineDrag.over === key;
      const below = drop && keys.indexOf(this.machineDrag.key) < index;
      const head = h_flex().relative().id(`machine-${key}`).h(Math.ceil(this.metrics.fontSize * 2.6)).flex_none().px(compact ? 3 : 30).gap(3)
        .items_center().text_size(this.metrics.fontSize).text_color(t.foreground).cursor_pointer()
        .tooltip("Drag onto another machine heading to reorder; right-click for section controls")
        .on_mouse_down("left", event => this.startMachineDrag(key, event))
        .on_mouse_move((event, cx) => this.dragMachineOver(key, event, cx))
        .on_mouse_up("left", (_event, cx) => this.finishMachineDrag(key, cx))
        .on_mouse_down("right", (_e,cx) => { this.menuMachine = this.menuMachine === key ? null : key; cx.notify(); })
        .when(this.machineDrag?.moved && this.machineDrag.key === key, e => e.opacity(0.6))
        .when(drop, e => e.child(div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(below, e => e.bottom(0)).when(!below, e => e.top(0))))
        .child(div().flex_1().h(1).bg(t.idle))
        .when(!compact, e => e.child(h_flex().flex_none().gap(4).items_center()
          .child(div().text_color(t.idle).child("┤"))
          .child(div().font_semibold().text_color(t.ansi15).child(machine || "Local"))
          .when(folded, e => e.child(div().text_color(t.muted).child("▸")))
          .child(div().text_color(t.idle).child("├"))))
        .child(div().flex_1().h(1).bg(t.idle))
        .when(rebuilt && !compact, e => e.child(div().id(`machine-connect-${machine}`).flex_none()
          .text_color(repair?.error ? t.blocked : t.muted).cursor_pointer()
          .tooltip(repair?.error || "This machine was rebuilt. Connect to its new core identity.")
          .on_mouse_down("left", (_e,cx) => cx.stop_propagation())
          .on_click((_e,cx) => { cx.stop_propagation(); this.reconnect(profile, cx); })
          .child(repair?.busy ? "Connecting…" : "Connect")))
        .when(layout !== "ready" && !rebuilt, e => e.child(div().flex_none().text_color(t.muted)
          .child(layout === "loading" ? "…" : "!")));
      const menu = this.menuMachine === key ? [
        ...[[-1, "Move section up"], [1, "Move section down"]].filter(([direction]) => keys[index + direction]).map(([direction, label]) =>
          h_flex().id(`reorder-${key}-${direction}`).h(this.metrics.rowHeight + 4).px(14)
            .text_size(this.metrics.fontSize).text_color(t.foreground).cursor_pointer().hover(e => e.bg(t.hover))
            .on_click((_e,cx) => { this.shiftMachine(key, direction); cx.notify(); }).child(label)),
        ...this.state.herds.map(target => h_flex().id(`move-${key}-${target.id}`).h(this.metrics.rowHeight + 4).px(14)
          .text_size(this.metrics.fontSize).text_color(t.foreground).cursor_pointer().hover(e => e.bg(t.hover))
          .on_click((_e,cx) => { this.moveMachine(key, target); cx.notify(); })
          .child(`Move to herd ${target.id}${target.id === h.id ? " ✓" : ""}`)),
        ...(layout === "ready" ? [div().h(this.metrics.rowHeight + 4).px(14).text_color(t.foreground)
          .cursor_pointer().on_click(() => run("space.new", {machine: machine ?? ""})).child("New workspace")] : []),
      ] : [];
      if (folded || rebuilt) return [head, ...menu];
      const content = [], emitted = new Set();
      for (const r of mine) {
        if (!r.g) { content.push(this.row(r,t,compact,machines)); continue; }
        const repo = r.g.repo;
        if (emitted.has(repo)) continue;
        emitted.add(repo);
        const group = mine.filter(x => x.g?.repo === repo), closed = this.repoFolded.has(repo);
        const root = group.find(child => !child.g.linked) || group[0];
        const rest = group.filter(child => child !== root);
        const groupStatus = closed ? ["blocked", "done", "working", "idle"].find(status => group.some(child => child.w.status === status)) : null;
        content.push(this.row({...root, groupStatus, foldRepo: rest.length ? repo : null}, t, compact, machines));
        for (const [index, child] of rest.entries()) if (!closed || child.w.active) {
          content.push(this.row({...child, tree: child.g.linked ? (index === rest.length - 1 ? "└─" : "├─") : null}, t, compact, machines));
        }
      }
      return [head, ...menu, ...content];
    });
  }
  render(cx) {
    const t = theme(), compact = shared("sidebar.collapsed") === true, { sp, ps, ms: inventory, fc: focus } = model();
    this.metrics = this.fontMetrics();
    const metricKey = JSON.stringify(this.metrics);
    if (metricKey !== this.metricKey) {
      this.metricKey = metricKey;
      setShared("rowan.sidebar.metrics", this.metrics);
    }
    this.inventory(sp); this.remember(sp, ps);
    const h = this.herd(), scoped = sp.filter(s => h.members.includes(this.machineKey(s.machine)));
    const current = scoped.find(s => s.id === focus?.space);
    const selectedReady = Boolean(current && inventory.some(m => m.name === current.machine && m.layout === "ready"));
    const rows = this.ordered();
    const scope = {herd: h.id, machineKeys: h.members.map(key => this.machineName(key) ?? "@local"), spaceIds: scoped.map(s => s.id), orderedIds: rows.map(r => r.w.id), labels: Object.fromEntries(scoped.map(s => [s.id, this.label(s)])), refs: Object.fromEntries(scoped.map(s => [s.id, this.refOf(s)])), selectedReady, empty: scoped.length === 0};
    const surface = selectedReady ? "rowan-workspace" : "rowan-empty";
    if (surface !== this.surfaceDesired) {
      this.surfaceDesired = surface;
      cx.spawn(async () => {
        if (this.surfaceDesired === surface) run("layout.select", {stack: "rowan-surface", child: surface});
      });
    }
    const json = JSON.stringify(scope);
    if (json !== this.scopeJson) { this.scopeJson = json; setShared("rowan.sidebar.scope", scope); }
    const tabs = h_flex().w_full().h(this.metrics.rowHeight + 6).flex_none().px(14).gap(3).items_center().justify_center().text_size(this.metrics.fontSize).text_color(t.muted);
    for (const item of this.state.herds) tabs.child(div().id(`herd-${item.id}`).px(5).py(3).cursor_pointer().when(item.id === h.id, e => e.bg(t.selected).text_color(t.foreground)).hover(e => e.bg(t.hover)).on_click((_e,cx) => { this.switchHerd(item.id); cx.notify(); }).child(String(item.id)));
    tabs.child(div().id("herd-add").px(5).cursor_pointer().hover(e => e.bg(t.hover)).on_click((_e,cx) => { this.addHerd(); cx.notify(); }).child("+"));
    const ratioControl = (id, label, hint, action) => div().id(id).px(3).cursor_pointer()
      .text_color(t.muted).hover(e => e.text_color(t.foreground).bg(t.hover))
      .tooltip(hint).on_click(action).child(label);
    const layoutName = window()?.layout_name;
    const bindings = keys().filter(k => k.section === "global" || k.section === "terminal" ||
      (layoutName && k.section === `layout:${layoutName}`));
    const priority = s => s === "terminal" ? 2 : s.startsWith("layout:") ? 1 : 0;
    const legacyHelp = bindings.some(k => k.action === "mod.open:rowan-help");
    const help = bindings.find(k => k.action === (legacyHelp ? "mod.open:rowan-help" : "app.help") &&
      !bindings.some(other => other.keys === k.keys && priority(other.section) > priority(k.section)));
    const helpHint = help ? `Keybinds (${help.keys})` : "Keybinds";
    return v_flex().size_full().min_h(0).pt(12).bg(t.chrome).text_size(this.metrics.fontSize).child(tabs)
      .track_focus(this.handle).on_key_down((event, cx) => this.keyboard(event, cx))
      .on_mouse_up("left", (_e, cx) => this.cancelDrag(cx))
      .on_hover((on, cx) => { if (!on) this.cancelDrag(cx); })
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().mode("always")
        .when(h.members.length === 0, e => e.child(div().id("empty-herd").px(12).py(8).text_color(t.dim).child("Empty herd — move a machine here from its heading menu.")))
        .children(this.grouped(t, compact, rows, inventory)))
      .child(h_flex().id("sidebar-help").h(this.metrics.rowHeight + 4).flex_none().items_center().justify_center()
        .child(ratioControl("sidebar-help-button", compact ? "?" : "Keys", helpHint, () => legacyHelp ? run("mod.open", {name: "rowan-help"}) : run("app.help"))))
      .when(!compact, e => e.child(h_flex().id("sidebar-font-controls").px(14)
        .h(this.metrics.rowHeight + 4).flex_none().gap(3).items_center().justify_center()
        .child(ratioControl("sidebar-font-smaller", "−", "Smaller sidebar text", () => this.command("font-smaller")))
        .child(ratioControl("sidebar-font-reset", `${Math.round(this.metrics.ratio * 100)}%`, "Sidebar text / terminal text. Click to reset to 80%.", () => this.command("font-reset")))
        .child(ratioControl("sidebar-font-larger", "+", "Larger sidebar text", () => this.command("font-larger")))));
  }
}
