# Sprig

Grove's terminal-first Herdr interface: compact herd/workspace navigation,
independent windows, readable terminal styling, and native prefix/help feedback.

**Canonical source: [JSRRosenbaum/grove-sprig](https://github.com/JSRRosenbaum/grove-sprig), branch `main`.**
This unofficial project consolidates our app and layout forks, retaining both
histories. The app lives at the root; its customization bundle lives in
[`sprig/`](sprig/README.md). No second customization checkout is needed.

Based on [Herdr app](https://github.com/herdrdev/herdr-app) and
[Kyle Avrett's Square Dracula](https://github.com/kyle-avrett/herdr-square-dracula).
This is not an official Herdr release. Existing executable/configuration names
(`herdr-app`, `rowan-terminal`, `rowan-*`) remain stable to preserve installed state.
See [provenance and upstream status](docs/sprig.md) for exact imported revisions,
license attribution, upgrade boundaries, and verification.

## Multiple windows

Launch `herdr-app` again to open another independent window. All windows use the
same configuration, layouts, mods and running herdr-core terminals. Opening a
window does not start another copy of an agent. Closing a window leaves those
terminals running.

Each window independently selects its workspace, tab and terminal pane, and keeps
its own live terminal scroll position. They are not mirrors of one viewport.
Each has a locked numeric slot and its own zoom, sidebar/mod state,
layout clicks, floating panels and saved placement. Slot 1 preserves the
existing state paths; later slots persist under `views/<id>/` and reuse their
own state when reopened. New slots initially copy the first window's saved
JSON view state, not its configuration. Configuration edits are shared and
hot-reload in all windows. Spaces, tabs and splits remain shared core structure.
One window owns automatic alert sounds at a time.

Zoom shortcuts save `window.zoom` in that slot's `shared.json`; they do not
overwrite `settings.json`. The latter's `zoom` remains the initial default for
a window without an override.

```sh
herdr-app windows
herdr-app --window 2 status
herdr-app --window 2 ls
herdr-app --window 2 do space.select --id <space-id>
herdr-app --window 2 shot /tmp/herdr-window-2.png
```

Without `--window`, CLI requests use the only live window or the uniquely active
one. If several windows are open and none is uniquely active, the request fails
and asks for a target; it never guesses which window to change. An unavailable
explicit target fails without falling back to another window.

## Install or update Sprig customizations

Use the Sprig app build for independent windows and the native prefix/help patches.
An official Herdr installer does **not** install those patches. Sprig does not
publish release binaries or enable automatic upstream releases.

```sh
git clone --recurse-submodules https://github.com/JSRRosenbaum/grove-sprig.git
cd grove-sprig
python3 sprig/install.py
herdr-app do layout.switch --name rowan-terminal
```

The installer installs the complete mod dependency set, layout, theme, OMP display
companion and layout-scoped keybindings. It preserves settings, machine connections,
terminal overrides and unrelated extensions/shortcuts. On a fresh configuration,
it retains the platform's built-in global and terminal keybindings.
Updates use the same command after `git pull --ff-only`. Owned stale files and
unmodified obsolete overlay bindings are removed; personal additions are retained.

Existing files are backed up under
`~/.local/state/herdr-app/rowan-sidebar-backup-*`. Installation validates all
assets before replacing files, refuses symlinks below installation roots, and
pre-stages rollback copies before changing live data. This is rollback for caught
I/O errors, not a crash/power-loss transaction; do not edit the same files concurrently.
The installer does not switch layouts, restart apps/cores, migrate sessions, or
copy credentials. Target an explicit window when more than one is open.

```sh
python3 sprig/install.py --app-home /path/to/app-config \
  --agent-home /path/to/omp-agent --backup-home /path/to/new-backup-directory
```

`HERDR_APP_HOME` and `PI_CODING_AGENT_DIR` select alternate default roots.
The detailed [customization guide](sprig/README.md) describes navigation and keys.

## Find your work

A **space** holds work on one machine, usually in one repo. Each space has **tabs**. Split a tab into **panes** to put terminals or mod panels beside each other.

An unnamed space follows its first terminal's folder. Name a space or tab when you want a label that stays.
New tabs start in the focused terminal's folder.

The agents sidebar brings agents from your spaces into one list, including workers started by another agent.
Agents that report status show as:

- **Working:** still busy.
- **Blocked:** waiting for you.
- **Done:** finished while you were looking elsewhere.
- **Idle:** not working, or a finished agent you have looked at.

Click an agent to see it. A worker without a pane opens in **peek**, over your tab. Keep it as a tab if you want it beside your other work.
Ctrl-click a live terminal address in terminal text to peek at it; use Cmd-click on macOS.
An address such as `t7` means a terminal on the same machine as the terminal showing it. `vps/t7` names one on another machine.

The window arranges terminals. The core runs them.
Closing the window leaves them running; closing a pane or tab ends its terminals.
After a reboot or core crash, kept panes get fresh shells in their last folders, not their old programs.

## Work on another machine

Add an SSH machine from Settings → Machines or the sidebar's Add machine action.
Pick a host from your SSH config or type how SSH reaches it.
Spaces on that machine run their terminals there, not on your computer.

Each machine keeps its spaces, tabs and splits in its core. Connected screens share that structure and the live terminals, but keep their own focus and zoom.
Remote work keeps running when your local window closes or your laptop sleeps, as long as the remote machine and core stay up.

## Make it yours

Open the command palette to find an action by name, or open Settings to change fonts, colors, sounds and other preferences.
The built-in layouts include Herdr, Terminals and Herdr 98.
A **layout** arranges the window. **Mods** are small JavaScript programs that draw its panels, menus and dialogs.

Duplicate a shipped layout or mod before changing its structure or code. Your copies stay yours; Herdr updates the shipped ones on start.
Save a personal layout, mod or key file and the window reloads it.
A broken edit keeps the last good version and reports the error.

Ctrl+Shift+P shows every command and its key (Cmd+Shift+P on macOS). Change any key in `keys.json`; see [the keys section](defaults/AGENTS.md#keys-keysjson) of the mod guide for the format.
Sprig shows a window-local **PREFIX** bar along the bottom of the main
content, left-aligned after the visible sidebar and tracking its measured edge
when resized. It never covers the sidebar. Cancellation/help hints come from
GPUI's actual pending keymap.
App chords with an applicable Escape continuation stay armed until the next key
or cancellation; ordinary chords keep their normal timeout. The searchable key
guide shows active-layout/terminal precedence and readable action names.

[Layouts and mods](docs/mods.md) · [Commands](docs/commands.md)

## Updates and privacy

Installed releases check for updates in the background and download a new app beside the running one. It takes over when you quit and reopen, or choose the update action. Your terminals keep running in the core.
Settings → Updates shows what is available. What's New opens after an update; you can open it again from the command palette.
Builds from source do not update themselves.

Usage telemetry is on by default in releases. Turn it off in Settings → Privacy.
Mods are trusted code, not sandboxed extensions. Read [security and privacy](docs/security.md) before installing someone else's mod.

## For agents

```sh
herdr-app --skill
```

This prints the agent guide for driving the window. The herdr-core skill points agents here.
Use herdr-core for running and coordinating programs; use the app to change what you see.

```sh
herdr-app ls
herdr-app status
herdr-app commands
```

The first two inspect the open window. The command list also works without one.
See the [command reference](docs/commands.md) for arguments.

## Build from source

For bugs, mod API requests and code contributions, see [Contributing](CONTRIBUTING.md).

Clone this repo with its submodules. Use Rust 1.95.0 and Zig 0.16.0, the versions used in [CI](.github/workflows/ci.yml).
Linux needs the development packages listed in that workflow.

```sh
git clone --recurse-submodules https://github.com/JSRRosenbaum/grove-sprig.git
cd grove-sprig
just build
just test
just install
```

Install [just](https://github.com/casey/just) to use these recipes.
The platform installer builds a release and adds the app to your desktop.
On Linux it links to this checkout, so keep the checkout in place.
Quit and reopen Herdr to use the new build.

Build on **Ash**, not the live Rowan workstation. For deployment, transfer the
verified executable deliberately; do not restart another person's window or core.
`just test-sprig` runs the Python installer and Node consumer behavior suites;
`just test` includes them plus the existing Bun and Rust suites. Python 3.9+
and a current Node.js are required for customization checks.

Documentation checks also need [Bun](https://bun.sh): `just docs-check` checks generated pages and CLI examples; `just docs-generate` refreshes the reference pages.

To compare drawing changes on Windows, Linux or macOS, run the same fixed workloads against each build:

```sh
python scripts/bench.py --bin <app executable> --set spinners --seconds 20
```

The runner requires `hc` on PATH and uses the Python executable running the script. It prints a unique artifact folder with the run settings, counters and results, then stops its private app, terminals and core. Both sets use Python fixture programs; the default set’s TUI workload replaces historical `btop` measurements. `--only spinners` measures just the quiet native spinner scenario. Keep the window visible and the display awake, and compare the same window activity and display settings; inactive windows may draw at a lower rate. Windows records visibility, foreground activity and display Hz at each measurement boundary; other platforms mark these observations unavailable. Visibility does not establish occlusion. Draws are window render calls. Render-to-paint elapsed time stops before scene finalization, backend drawing, uploads and presentation; it is separate from OS process CPU time. Neither measures physical presentation or the FPS HUD’s derived MAX FPS.

`python scripts/bench_compare.py ghostty --root <artifact folder>` reuses a run’s fake agent for the macOS comparison. Benchmark checks: `python -m unittest discover -s scripts -p test_bench.py`.
