# Sprig provenance and upstream status

Canonical source: https://github.com/JSRRosenbaum/grove-sprig (`main`).

## Downloadable development snapshot — 2026-11-02

Packages: https://github.com/JSRRosenbaum/grove-sprig/releases/tag/sprig-preview-2026.11.02

This unsigned, unofficial development snapshot distributes the existing
Ash-built code `6c182c1`; subsequent source commits update documentation only.
Linux x86-64 and Windows x64 bundles include the paired core, native review and
annotation runtimes, customizations, licenses, SHA-256 manifests and installation
instructions. No personal key profiles, machine records or credentials ship.
The binaries retain their upstream executable names/version metadata.

The Linux app requires glibc 2.44; this is not a portable older-distribution or
standalone NixOS package. Windows bundles retain the pinned ConPTY directory
layout and static CRT linkage. Set `prompt_new_tab_name=false` in the user's
authored legacy profile when compiling customizations; preserve host-specific
keys rather than importing another machine's profile.

This is **not release-qualified**: the latest Windows artifact has not executed
on Windows, physical Windows desktop checks remain pending, and GitHub Actions
is disabled for this repository. Do not treat older Windows test passes or an
empty check list as qualification. Integration into `main` is tracked in
https://github.com/JSRRosenbaum/grove-sprig/pull/1; do not bypass its CI gate.
There are no macOS or ARM builds in this snapshot. Official Herdr installers and
auto-update channels do not select Sprig's development assets.

## Three-host deployment — 2026-11-02

The owner authorized deployment of code commit `6c182c1` to Nix, Rowan and Ash,
and explicitly approved reopening the Rowan frontend. App, paired core, native
annotation/review runtimes and effective host key profiles are installed on all
three. Runtime names and state identities remain `herdr-app`/`herdr-core`.

| Host | Frontend state after deployment | Existing live terminal PIDs preserved |
|---|---|---:|
| Nix | Installed; no production GUI launched | 51 |
| Rowan | Updated window 2 reopened and verified | 24 |
| Ash | Installed; no production GUI launched | 15 |

Only planned `hc update --from` handovers changed production core server PIDs.
All existing terminal addresses and process identities survived. Rowan also
retained all 24 observed TTYs; its workspace, tab, pane, zoom, 49 existing sidebar
aliases and both herds were preserved. Older holders remain intentionally alive.
Nix's existing bundled loader/runtime is retained for its NixOS environment;
the four deployed ELF files have the same qualified hashes on every host.
Nix's registered `rowan` logical core ID matches the authoritative Rowan ID.
Its `auri` connection is target `ash`, core session `auri`, not an SSH host
called Auri.

Installed runtimes reported versions, native mod checks passed, and actual
isolated `terminal.clear` RPC checks on all hosts removed an old marker while
retaining the cursor line. Owned smoke cores/displays were cleaned up.
The live Rowan GUI rendered without reported configuration/mod errors.
Nix/Ash desktop interaction was not exercised.

After the owner reported the tab-name prompt, Rowan's authored profile was set
to `[ui] prompt_new_tab_name = false` and reloaded without changing bindings.
Cua-delivered prefix+c in an isolated matching profile created numbered tab 2
with no prompt. Keep this preference on future Rowan installs by passing
`--legacy-config ~/.config/herdr-app/legacy-profile.toml`; do not reimport the
retired snapshot/defaults over the owner's newer choice. Ash already disables
the prompt; Nix retains its own imported local preference.

Rollback/evidence:
`~/.local/state/herdr-app/sprig-deploy-6c182c1/` on Rowan;
`~/.local/state/herdr-app/sprig-deploy-6c182c1-01a19f1e/` on Nix/Ash.
The central private payload/receipt directory is
`/mnt/tank/AppCaches/rowan-dev/sprig-deploy-20261102-6c182c1/`.
Rollback launchers/configuration only as needed; never overwrite progressed
conversation, core or view state with old snapshots.


## Background workspace focus repair — 2026-11-02

CLI `space.new` now creates structure without selecting it in the addressed
window. Its current workspace, tab, pane and explicit machine selection remain
unchanged; other windows retain their own view too. Keys and clicks still show
the new workspace. Scripts intentionally switching views use `space.select` on
the returned `space` ID. Worktrunk and Workthreads were migrated accordingly;
Workthreads `--no-focus` no longer briefly selects and restores another view.
Benchmark and recording/test setup callers now select their intended target.

The root causes were unconditional model selection on creation, shared-document
fallback replacing an intentional empty view, and premature clearing of the
old pane before focus synchronization. The latter left a hidden terminal's
keyboard focus live, allowing render to select its old workspace again.

Observed in an actual isolated two-window Linux release run: background local
and remote creation, shared rename propagation, empty-machine/no-selection
preservation, Workthreads focus/no-focus, Cua-delivered legacy new-workspace
keys, and intentional Worktrunk creation/selection all passed. The second
window remained on its own terminal. Final suites: 304 app unit tests plus
COLRv1/GPU/contract checks, 47 Python, 50 Node and 27 Bun. The permanent model
regression checks workspace/tab/pane/zoom preservation and foreground selection.

All builds ran on Ash. Linux app SHA-256:
`ea4cd0cd731806a1910565b71d1c614074c95246085c2790ca640ee102de02ce`.
The corrected unsigned Windows package has 307 verified manifest entries on
Rowan and no dynamic MSVC CRT import. Its SHA-256:
`cfe770c31eee7093c2bab502ae48911cb27f0c491f0504db1965f60d5f36bee8`.
The latest Windows artifact was **not executed on Lappy**: its configured
Windows SSH route went offline. Earlier superseded test results do not qualify it.
Physical Windows GUI qualification remains outstanding.

Evidence and staged artifacts:
`/mnt/tank/AppCaches/rowan-dev/sprig-workspace-focus-20261102/`.
Production frontends, cores and OMP sessions were not stopped or replaced.


## Current adopted upgrade — 2026-11-02

Joseph subsequently authorized **all reviewed upstream improvements**, not just
repository consolidation. Sprig now includes the complete app history through
`71d3e8f71663120b09ae82666bd37c9ff582c8da` and core through
`421c5ab41857f8b4a5f155c42f763008f455b33d` (0.1.17 plus reviewed master fixes).
The original import pins below are historical provenance, not the current baseline.

The active custom mods also adopt shared pin/seen integration, keyboard-focusable
Spaces/Agents, picker scrolling, explicit rebuilt-machine repair, cached agent
menus, Unicode/OneDrive/symlink Files behavior and new-folder change marks.
All branch suffixes are removed from workspace rows; names, status/tree gutters,
stable `w…` tags and independent per-window selections/herds/zoom remain.
Programming ligatures are available through `font_ligatures: true`, not forced
on existing configurations.

Native machine snapshots expose `space_order`: the last core-acknowledged document
order, separate from optimistic `spaces()`. Explicit sidebar drag intent retires
only after acknowledgment, surviving delayed CAS conflicts. It does not impose a
window's machine-section order on other windows.

Legacy local pins migrate when the matching live terminal is known. Sprig pin/unpin
writes include `herdr.pin-migrated=1` with the pin label; stale Sprig copies do not
re-pin after that shared decision. A pre-marker/non-Sprig unpin racing an old
migration cannot be fully ordered by this marker alone.

## Consolidation decision — 2026-11-02

Keep native Herdr app source at the repository root and import the customization
fork under `sprig/` using a non-squashed Git subtree. Both original histories
remain reachable; there is one active repository, installer and review workflow.
This preserves Cargo/build paths and the pinned Ghostty submodule. The previous
forks are historical records, not ongoing development targets.

| Component | Imported revision | Upstream base |
|---|---|---|
| Native app | `7d5db1f9a32507ee70457d345098bc8463417a08` | `8180cbe6c947519e8015dd7c35801a93e08a7d66` |
| Layout/mods | `28e57d8072f3c756586094d5e8f8e288d3e3c256` | `e7640bf166257abaecca27c0fcf8a3190b315cfc` |
| Ghostty renderer | `291fd050b9e9c293c8adb6a140742649b7e42d3a` | unchanged submodule |

Machine-readable pins: [`sprig/upstreams.json`](../sprig/upstreams.json).
Original fork history: [native app](https://github.com/JSRRosenbaum/herdr-app)
and [customizations](https://github.com/JSRRosenbaum/herdr-square-dracula).
The app's Apache-2.0 license and third-party notices remain at the root;
`sprig/LICENSE` and `sprig/NOTICE` retain Square Dracula, Rowan and icon attribution.
No credentials, machine connection documents, user config or session state are imported.

Native behavior retained: independently selected workspace/tab/pane per window,
per-window persisted view/zoom, explicit window CLI targeting, single alert owner,
bottom prefix bar aligned after the sidebar, and effective searchable key help.
Customization behavior retained: compact herds, machine sections, guarded navigation,
workspace/section reordering, readable status colors, adjustable sidebar typography,
collapsible Agents and the OMP metadata companion.
Runtime names are intentionally unchanged; repository consolidation is not a state migration.

## Upstream check — 2026-11-02

| Component | Qualified local baseline | Latest observed | Adopted here? |
|---|---|---|---|
| Herdr app | 0.1.12 plus Sprig patches and master fixes | [0.1.12](https://github.com/herdrdev/herdr-app/releases/tag/v0.1.12) | Yes, through `71d3e8f` |
| herdr-core | 0.1.17 plus master fixes | [0.1.17 release manifest](https://releases.herdr.dev/core/latest.json) | Yes, through `421c5ab` |
| Square Dracula | `e7640bf1` plus Rowan patches | `e7640bf1` | Already at upstream base |

Sources: [app release manifest](https://releases.herdr.dev/app/latest.json),
[app base-to-master comparison](https://github.com/herdrdev/herdr-app/compare/8180cbe6c947519e8015dd7c35801a93e08a7d66...71d3e8f71663120b09ae82666bd37c9ff582c8da),
[layout upstream](https://github.com/kyle-avrett/herdr-square-dracula).
Stable app tag points to `4aa3460749947e7771aa39a8a2cec58d46649926`;
Adopted app master is `71d3e8f71663120b09ae82666bd37c9ff582c8da`.
There are 64 commits from our original base to stable and 25 more adopted from master.
App 0.1.12 declares minimum core 0.1.11. Core's full tagged changelog includes
Linux/remote freeze, prompt-read, image-stream and slow-template fixes in addition
to macOS lifetime changes; the brief release manifest is not a complete changelog.

### Included upstream changes

Already in stable 0.1.12:

- [`9af0ecc1`](https://github.com/herdrdev/herdr-app/commit/9af0ecc1): avoid multi-second window freezes during mod work.
- [`865d2fa1`](https://github.com/herdrdev/herdr-app/commit/865d2fa1): bound Linux folder watches and skip ignored trees.
- [`9087b0cc`](https://github.com/herdrdev/herdr-app/commit/9087b0cc): resync terminal display facts on theme changes.
- [`a5aa17bd`](https://github.com/herdrdev/herdr-app/commit/a5aa17bd), [`b600cdba`](https://github.com/herdrdev/herdr-app/commit/b600cdba), [`3979b90c`](https://github.com/herdrdev/herdr-app/commit/3979b90c): terminal font/icon, grapheme and braille rendering improvements.
- [`d6617bfc`](https://github.com/herdrdev/herdr-app/commit/d6617bfc): remote agent shell profiles.
- [`a4786fc8`](https://github.com/herdrdev/herdr-app/commit/a4786fc8): reject malformed target IDs before closing work.
- [`bf8f4721`](https://github.com/herdrdev/herdr-app/commit/bf8f4721): pane navigation into column splits.

Included from app master beyond stable:

- [`6a741257`](https://github.com/herdrdev/herdr-app/commit/6a741257): keep Wayland input on the first seat; relevant to our earlier CUA virtual-seat issue.
- [`64316dcb`](https://github.com/herdrdev/herdr-app/commit/64316dcb), [`b03019e0`](https://github.com/herdrdev/herdr-app/commit/b03019e0), [`414a06db`](https://github.com/herdrdev/herdr-app/commit/414a06db): control-chord and shortcut-help fixes; inspect against our prefix/key patches.
- [`c720514d`](https://github.com/herdrdev/herdr-app/commit/c720514d), [`2ceb2744`](https://github.com/herdrdev/herdr-app/commit/2ceb2744): workspace-order reconciliation/navigation; qualify with sidebar drag and herd-scoped navigation.
- [`70e7e99a`](https://github.com/herdrdev/herdr-app/commit/70e7e99a): Windows Files panel handles OneDrive paths and curly quotes.
- [`71d3e8f7`](https://github.com/herdrdev/herdr-app/commit/71d3e8f7): opt-in terminal programming ligatures.

Core includes all 0.1.16/0.1.17 changes and the three subsequent fixes for dead
display-server environments, CRLF templates and current-folder CLI output.
See the [core changelog](https://github.com/herdrdev/herdr-core/blob/v0.1.17/CHANGELOG.md)
and [post-release range](https://github.com/herdrdev/herdr-core/compare/v0.1.17...421c5ab).

Do not mistake the earlier Kitty file-transport addition for a current fix:
[`e66ce975`](https://github.com/herdrdev/herdr-app/commit/e66ce975) reverted it pending safe reads.

## Upgrade and verification boundary

The consolidation initially retained the native baseline. The later owner-authorized
upgrade merges the full reviewed upstream range and ports stock-mod behavior into
the active custom mods instead of merely updating unused defaults.
Native builds and tests run on Ash, never Rowan. Test concurrent windows with
independent selection/zoom, prefix cancellation/help, graphics, shared agent state,
remote connections and sidebar ordering before any future deployment.

Use `just test-sprig` for custom installer/consumer behavior; root `just test`
also runs upstream consumer and native suites. Standard debug-profile Rust tests
are required: release-mode GPUI dependencies intentionally omit debug selectors,
so the popup geometry test cannot use `debug_bounds` there. The release executable
is separately built and exercised in a private actual display.
Always isolate app home, core session, runtime/config/state paths and display;
never use a production core stop/restart as a test.

The installer validates inputs and ownership, rejects symlinked descendants,
and replaces newer global/terminal captures with an explicit legacy key profile.
Per-machine profiles preserve source-specific plugin availability; normal keys
and UI preferences remain frontend-local unless server-keymap mode is explicit.
It allocates rollback copies before replacement. Caught I/O failures roll back
file bytes without new allocation. Power-loss durability, concurrent installation
and adversarial directory-swap races are not promised; use an exclusive trusted
configuration directory. Backups are retained even when an install fails.

GitHub Actions are disabled on the new repository until deliberately enabled.
The inherited official release publisher was removed: Sprig has no authority or
secrets to publish official Herdr binaries. Existing CI recipes remain available.

## Upgrade qualification and deployment — 2026-11-02

- Ash release builds passed for both app and core. Final executable SHA-256:
  app `49f3ebb5cf863b16466080bda583bc36d028e75a111af9ec127a9e879efe5986`;
  core `61dc92e3139caa9bff9b6586fa7020b5694d6f28d20b5a0a47231387f8bf4ad7`.
- App standard-profile suite passed: 279 unit tests, 26 COLRv1 tests, command,
  notice and skill checks, plus both real GPU pixel-readback runs. Core's full
  Rust suite passed. Custom consumer suite: 40 passed; installer: 9 passed;
  upstream/custom Files and stock consumer suites: 27 passed.
- All eleven installed mods passed native checks. Actual private app/core UAT
  exercised independent workspace/tab/pane selection and zoom in two windows,
  shared pin/unpin labels, help toggling, keyboard focus, Cua-delivered prefix
  activation/Escape cancellation, inline Kitty graphics and branch-free rows
  for an actual feature branch and detached worktree.
- A private mod probe observed native `machines().space_order` changing only
  after core document writes. The regression separately covers optimistic match,
  timer tick, delayed conflict, retry and authoritative acknowledgment.
- Independent review found the optimistic-acknowledgment bug; it was fixed before
  deployment. No other must-fix finding was established. Physical drag gestures
  were not requalified; drag state/ordering behavior is covered by consumer tests.
- Private old-core → new-core → rollback UAT preserved shell PIDs, terminal IDs,
  TTYs, screens, labels and layout documents. Real CRLF-template launch and
  current-folder CLI display also passed. Downgrades still carry the tool's
  saved-state-forward compatibility warning.
- Production app/core binaries and customizations were deployed on Rowan and
  Ash; Ash default and `auri` cores were handed over using `hc update`, never
  `server stop`. All 40 baseline live terminal IDs and shell PIDs survived.
  Existing old holders intentionally remain draining with their original PTYs.
  No OMP process or conversation was restarted.
- The still-open Rowan window 2 was reopened on the new app with exact workspace,
  tab, pane and zoom preserved. Window 3 had already closed before cutover and was
  not resurrected. All 48 sidebar aliases and both saved herds remained identical.
  Personal settings were unchanged; new Help/Insert shortcuts are scoped to the
  Rowan layout rather than overwriting global key preferences.
- Evidence and private rollback copies:
  `/mnt/tank/AppCaches/rowan-dev/sprig-upgrade-20261102/` on Rowan;
  `~/.local/state/herdr-app/sprig-upgrade-20261102/` on Ash. The private core UAT
  receipt is `~/.cache/sprig-core-uat-01a19d6f/receipt.md` on Ash.
  Do not restore saved state over progressed live conversations. Windows/macOS
  changes are integrated as source but were not runtime-qualified in this Linux run.

## Windows preview build — 2026-11-02

The updated app and core now also have **unsigned Windows x86-64 MSVC preview
builds**, compiled entirely on Ash from Sprig
`9c5f65d4f477acebc16d735aa648d89f5a4ead39` and core
`421c5ab41857f8b4a5f155c42f763008f455b33d`.

- App executable SHA-256:
  `6d68d36c26e0be4e2961539e847b63e5a6975a84038bdd62ff42a11640718961`.
  Core executable:
  `b8cfaa7486a3f754adeb132714800dc7efcbfa4515930209ac330ac5040ee9c9`.
- Complete ZIP: `sprig-windows-x86_64-9c5f65d.zip`, SHA-256
  `33b0f06f62681a5e75e9ce74c89f86e8fea0019f6ca5343a2a268ce2082d3e87`.
  It contains both executables, pinned ConPTY, redistribution notices, public
  customizations, isolated-preview instructions, `BUILD_INFO.json` and
  per-file `SHA256SUMS`. SDK/FXC build tools and personal configuration/auth
  are not distributed. The app requires Microsoft's x64 VC++ Redistributable.
- Rowan copy: `/mnt/tank/AppCaches/rowan-dev/sprig-windows-20261102/`.
  Ash build/provenance cache: `~/.cache/sprig-windows-20261102/`.
  Lappy delivery: `C:\Users\joseph.rosenbaum\Downloads\sprig-windows-x86_64-9c5f65d.zip`,
  with the matching extracted folder beside it. All 131 manifest-listed files
  matched after Windows extraction.
- Cross-build used Rust 1.95.0, cargo-xwin 0.23.1, Zig 0.16.0, LLVM 23 and
  existing SDK/CRT caches. Build-only Ghostty overlays supply SDK includes to
  Wuffs translation. Actual FXC under Wine generated the original GPUI release
  shader entrypoints/profiles; an external resource object supplies the app icon.
  Original tracked source checkouts were not edited to bypass those build steps.
  Detailed commands, inputs and adaptation hashes are in the build manifest.
- **Passed on Lappy:** app/core version and help, customization installer
  (35 files in private roots), isolated core startup, actual ConPTY program
  output, keyboard input (`abc`) and screen readback, clean private-core stop.
  Existing installed app/core processes survived; no installed binary, real
  profile, persistent PATH or shortcut was replaced.
- **Not GUI-qualified:** native mod checking attempted over SSH failed with
  `cannot open windows while headless` in SSH session 0. A Cua background
  launch of the hidden-check helper also returned `background_unavailable`;
  foreground control was not authorized or attempted. Interactive rendering,
  graphics and physical keyboard behavior remain unverified. This is a separate preview, not
  permission to replace the installed desktop app or a claim of full Windows
  qualification. Use the included isolated-profile instructions from a desktop
  PowerShell before deployment. macOS qualification is unchanged.

## Consolidation verification — 2026-11-02

- Python installer suite: **9 passed**, including symlink write/delete escapes,
  preserving personal configuration, fresh platform keys, stale ownership/binding
  cleanup, explicit/env-selected roots and rollback under persistent ENOSPC.
- Node consumer suite: **30 passed**, covering herd-scoped navigation, stale
  targets, selection restoration, agents, typography and workspace/section ordering.
- Existing Bun file-listing utility check: **1 passed** on Ash.
- `herdr-app check`: **all 11 installed mods passed**, using a fresh isolated payload.
- Actual Ash Xvfb app smoke: two windows rendered `rowan-terminal`, accepted terminal
  input, selected different workspaces/tabs/panes, retained independent zoom, showed
  key help without runtime errors, and kept window 2 alive when window 1 closed.
  Screenshots and receipt: Rowan
  `/mnt/tank/AppCaches/rowan-dev/sprig-verification-20261102/`.
  All owned app, display and core processes were stopped after testing.
- Native/Cargo/defaults/renderer inputs are byte-identical to imported app commit
  `7d5db1f9`; no fresh native compilation or Rust-suite run was needed or claimed.
  Smoke used the already qualified Ash-built executable, SHA-256
  `f9b5f37a77a9eeb9a2884d8807836c6548bd6c208cbeb83bc787517cda69781f`,
  which also matches Rowan's installed executable.

The initial smoke harness issued asynchronous mutations without waiting for
document propagation, and assumed the wrong help overlay ID. The accepted smoke
waits for observed state transitions and uses fresh private core state; actuator
acknowledgement alone is not acceptance evidence. Physical drag gestures were not
requalified in this consolidation; their existing consumer behavior tests passed.
Rowan's `just`/Bun shims lacked selected installed versions, so Python/Node ran
directly and the Bun check used Ash's installed runtime. No global tool configuration
was changed to conceal that limitation.

## Legacy interaction contract — 2026-11-02

The owner requested exact legacy keybinding parity, with newer conflicting
bindings displaced rather than retained as aliases. The behavior oracle is
Herdr 0.9.5 at `5ea51c013a3fc6bc783b80caacf0f3a39575e70a`, together with each
frontend's actual legacy configuration.

Normal bindings, prefix and UI preferences remain frontend-local by default.
The selected endpoint supplies its custom commands, not its entire keymap.
`--legacy-key-source server` explicitly selects the full endpoint profile;
`--legacy-machine-config NAME=PATH` supplies each named endpoint's configuration.
An unknown endpoint has no inherited local plugin commands. Profiles are selected
independently in each window.

This ports the real prefix dispatcher, Navigate and per-terminal Go To modes,
copy/search mode, field kill/yank controls, pane sizing, scrollback editing,
worktree launchers, annotation editor/manager and configured plugin actions.
The prefix stays active until consumed or cancelled; unknown suffixes do not leak
into the shell. The legacy help panel shows the effective map. New global and
terminal captures are replaced by the installer, with rollback backups.

### Reproducing the paired core

The app's clear-scrollback action requires Sprig's paired core, not an unpatched
upstream binary. Its source is retained as checksum-pinned patches in this same
repository, including the separate Ghostty submodule delta:

```sh
python3 scripts/prepare-sprig-core.py /new/path/sprig-core
cargo build --locked --release --manifest-path /new/path/sprig-core/Cargo.toml -p herdr-core
```

The preparation command refuses an existing destination, verifies patch hashes,
fetches the exact upstream core and renderer revisions, and checks each patch
before applying it. It does not install anything or touch a running core.
Use the core's documented Zig/toolchain prerequisites. Build on Ash.

`terminal.clear` clears authoritative primary-screen history while retaining
the complete visible wrapped cursor line, parser/mode state, hyperlinks and
palette overrides. Alternate-screen clearing returns false. Clear intent and
actual pending DEC mode transitions survive slow-viewer loss/resynchronization;
no shell input is injected to simulate the operation.

### Qualification boundary

The Linux app passed 303 unit tests, 26 COLRv1 tests, command/notice/skill checks
and both actual GPU pixel-readback checks. Final adapter suites passed 47 Python,
50 Node and 27 Bun tests. The standalone annotation runtime passed 70 Rust tests;
the retained review runtime passed 188.
The final core suite passed serially with `HC_TEST_WATCHDOG_S=180`; its default
30-second per-binary watchdog is too short for the serialized integration suite.
The renderer wrapper passed 15 tests, including dirty-prompt clear, hyperlinks
and explicit palette overrides.

Private Xvfb/Cua runs exercised two independent windows, effective key help,
held/repeated/cancelled prefix input, pane split/cycle/resize, Navigate, Go To,
new-tab prompts, clipboard paste followed by Ctrl+C field clearing, empty remote
machine selection and keyboard-origin source-owned remote launch. The standalone
annotation editor saved a real record in the private store, and copy-context
export was read back from the clipboard. The Worktrunk picker created branch
`wt` and its actual checkout in the owned fixture. All 35 installed mods passed
native checking. Tests never used the user's display or stopped production
app/core/OMP sessions. Private Xvfb mouse-drag qualification was blocked by Cua's
unavailable uinput slave device; no synthetic desktop bypass was substituted.

Windows binaries use static MSVC CRT linkage: a separate VC++ Redistributable is
not required by these executables. Final native execution on Lappy passed
58 key/field/copy/link tests plus 3 core clear and 11 wire tests. An isolated
ConPTY shell accepted `abc`, displayed `SPRIG_INPUT_abc`, then cleared the
pre-clear marker from authoritative readback. All 306 manifest-listed package
files matched on Rowan and Lappy.
SSH session 0 is not an interactive desktop. Physical Windows Ctrl-click,
mouse-drag selection, rendering and desktop clipboard feedback remain unverified;
native tests and ConPTY checks do not substitute for those gestures.

Final Linux release source was rebuilt from the canonical core patches and
byte-compared against the fully qualified source. SHA-256:
app `5ca53d411a5582ff4145f870719e5ec138fcd104ff1092a0c346c0e94c1c25e6`;
core `7759757b1a803bd9c7dd8348341e51f757c93675152de068501f1d9b337d3d21`.
The Windows package SHA-256 is
`b16b9a45f2bbe7bee1303ab02bac48af0c8aefcb65e5a21f8b40738f18c34233`.
This parity update is staged separately, not installed over live sessions.


