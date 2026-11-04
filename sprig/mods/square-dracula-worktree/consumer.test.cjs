const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const sources = [
  __dirname + '/main.js',
  path.resolve(__dirname, '../../../defaults/mods/worktree/main.js'),
];

for (const sourcePath of sources) {
  test(`${path.relative(process.cwd(), sourcePath)}: New worktree creates its branch and workspace without input`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sprig-worktree-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const repo = path.join(root, 'repo');
    fs.mkdirSync(repo);
    const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
    git('init', '-q');
    git('config', 'user.name', 'Sprig test');
    git('config', 'user.email', 'test@invalid');
    fs.writeFileSync(path.join(repo, 'content'), 'current checkout content\n');
    git('add', '.');
    git('commit', '-qm', 'fixture');
    const head = git('rev-parse', 'HEAD');
    const opened = [];
    let properties = { folder: repo, action: 'new' };
    const tasks = [];
    const cx = {
      notify() {},
      focus_handle: () => ({ focus() {} }),
      timer: { after() {} },
      spawn(fn) { tasks.push(fn(cx)); },
    };
    const source = fs.readFileSync(sourcePath, 'utf8').replace(/^import .*;\n/gm, '').replace('export default class Worktree', 'class Worktree');
    const Worktree = new Function('View', 'exec', 'run', 'props', 'home', 'spaces', 'panes', 'closeOverlay', 'InputState', `${source}; return Worktree;`)(
      class {},
      async (program, args, options) => {
        const r = spawnSync(program, args, { cwd: options.cwd, encoding: 'utf8' });
        return { code: r.status, stdout: r.stdout, stderr: r.stderr };
      },
      (command, args) => opened.push({ command, args }),
      () => properties, () => root, () => [], () => [], () => {},
      { new: ({ value }) => ({ value: () => value, on() {}, focus() {} }) },
    );
    async function start(props) {
      properties = { folder: repo, ...props };
      const view = new Worktree();
      view.init({}, cx);
      await Promise.all(tasks.splice(0));
      assert.equal(view.error, '');
      return view;
    }
    await start({ action: 'new' });
    await start({ action: 'new', branch: '   ' });
    assert.equal(opened.length, 2);
    const checkouts = opened.map(({ args }) => args.folder);
    assert.notEqual(checkouts[0], checkouts[1]);
    const branches = checkouts.map(folder => {
      assert.equal(fs.readFileSync(path.join(folder, 'content'), 'utf8'), 'current checkout content\n');
      assert.equal(execFileSync('git', ['-C', folder, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), head);
      return execFileSync('git', ['-C', folder, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
    });
    assert.notEqual(branches[0], branches[1]);
    // Explicit names retain their existing branch checkout semantics.
    git('branch', 'chosen-branch');
    await start({ action: 'new', branch: 'chosen-branch' });
    assert.equal(execFileSync('git', ['-C', opened[2].args.folder, 'branch', '--show-current'], { encoding: 'utf8' }).trim(), 'chosen-branch');
    // Opening/removing still waits for selection/confirmation; init must not mutate Git.
    const before = git('worktree', 'list', '--porcelain');
    await start({ action: 'open' });
    await start({ action: 'remove' });
    assert.equal(git('worktree', 'list', '--porcelain'), before);
    assert.equal(opened.length, 3);
  });
}
