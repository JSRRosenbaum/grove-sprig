# Sprig provenance and upstream status

Canonical source: https://github.com/JSRRosenbaum/grove-sprig (`main`).

## Front-end in the binary — 2026-11-06

The Sprig front-end stopped being a payload. The 19 mods that were under
`sprig/mods` (7 `rowan-*`, 12 `square-dracula-*`), `sprig/layouts/` and
`sprig/themes/` are folded into the app's own defaults and embedded in the
binary: mods in `defaults/mods`, the `rowan-terminal` layout in
`defaults/layouts` registered in `LAYOUTS` (`src/window.rs`), the appearance in
`defaults/themes` registered in `THEMES` (`src/settings.rs`). The app writes the
defaults it owns into the app home on every start, so a release is one artifact,
a new machine needs no front-end step, and a customization is an edit to the
shipped file instead of a clone under a new name.

Folding onto the mods Herdr ships — rather than carrying clones of the 0.1.7
ones — returns the upstream behavior the clones lacked: the Changes panel's
commit workflow, per-folder saved navigation in Files, the sidebar following
panel width, and worktree dialog timeouts. `src/window.rs` gained
`DEFAULT_LAYOUT`: a window whose core session has chosen no layout opens on
`rowan-terminal`, while `app.reset` and a layout whose mods are gone still open
`main`, the plain Herdr screen.

`sprig/install.py` no longer installs mods, layouts or themes. Its manifest
validation accepts the front-end shapes earlier installers owned and treats them
as removals (`owned_for_removal`), so an existing app home converges: retired
`mods/…`, `layouts/rowan-terminal.json` and `themes/rowan-terminal.json` are
deleted, while personal mods, personal layouts, settings and keys are left
alone. `sprig/RECIPE.md`, the upstream gallery recipe for the clone bundle,
goes with the clones; attribution stays in `NOTICE` and `upstreams.json`.

Validation on this tree: `cargo build --locked` clean; `cargo test --locked` 394
tests pass (364 app, 26 integration, 4 across three smaller targets), 2 ignored;
49 Python installer tests; 59 Node mod-consumer tests, with the worktree
consumer test restored beside the canonical mod; 41 Bun script tests over files,
picker, palette, agents, spaces and worktree. A fresh app home on a private
headless display converged from the binary alone — 27 mods, the 4 shipped
layouts and 3 themes written on launch, no payload step — opened on
`rowan-terminal`, and rendered the herd sidebar, numbered tabs, pane header and
the Changes panel with its commit box, with no reported errors.

The manifest alone was not enough: installers before it wrote part of the bundle
without recording it, so `install.py` retires the bundle's namespaces as well —
`mods/rowan-*`, `mods/square-dracula-*`, `layouts/rowan-terminal.*`,
`themes/rowan-terminal.*`. Rowan's app home cleared 19 mod directories and 77
files, each copied to the backup home first, while `layouts/square-dracula.json`
and `themes/omarchy.json` — personal names — stayed. Verified against a copy of
that converged app home on the release binary: 27 mods written on launch, the
window opened on `rowan-terminal`, the herd sidebar listed Local, ash and auri,
`mod.open` opened the keybinds overlay over the compiled profile's 68 bindings,
`rowan-spaces.worktree-new` and `rowan-spaces.herd-next` executed, and nothing
was reported in `errors`.

Deployed 2026-11-06 from Ash (`rustc 1.95.0`, `zig 0.16.0`): one ELF, sha256
`7b51e0be8cca0c0692c8d3d3d26d3058c98ef631499eda3689e31abdc3d49a6e`, installed as
`sprig-c9bcc24` on Rowan and Ash with the `~/.local/bin/herdr-app` symlink
repointed and the previous releases kept for rollback. Ash has no authored key
profile of its own, so its `keys.json` and `legacy-keys.json` were restored from
the installer's own backup and compared by sha256 (`472b0286…` before and after);
its app home retired 14 mod directories and 62 files. Retire the payload only
after the frontend reopens on the new binary: a running old build reloads
`layouts/rowan-terminal.json` and needs `themes/rowan-terminal.json`, so Rowan's
retired payload was restored for the live window and is retired again on the next
`install.py` run. Lappy is not updated — its WireGuard proxy peer `10.99.0.3`
answers to neither Rowan nor Ash — so the Windows artifact is staged on Ash at
`~/.cache/sprig-windows-20261106/app/dist/herdr-app-windows-x86_64.tar.gz`
(sha256 `641973b11655b219027d0f05913ed233639126faaa73fba900a8b79975bd33ef`,
`herdr-app.exe` `2947dc7b81b61db2f3949dc58533ed3b32e7dbdb394c3ec236c225bca2d8c222`,
no dynamic CRT import) and is one transfer and one `install.py` away.

## Upstream rebase — 2026-11-06

The app source now sits on the upstream head `herdrdev/herdr-app`
`cfcf836404f932817f10f88455c33e33c94fd1df` (0.1.13). `sprig/upstreams.json`
records every pinned revision. The Sprig layer on top of that base is 376
files: 330 added, 317 of them under `sprig/`, which is the
`herdr-square-dracula` layout at `e7640bf166257abaecca27c0fcf8a3190b315cfc`
imported untouched — 0 files of it modified, 0 deleted — plus our own mods,
layouts, themes, keys, installer and tests; and 46 upstream-owned files that
carry Sprig deltas.

Replaying only the post-merge commits dropped the deltas the merge commit
itself carried, which a cherry-pick cannot recover: the per-window instance
lease and its isolated state directory (`src/instances.rs`, 23 call sites),
the shipped layout, theme, key and mod bundle, the gpui patch that exposes
`clear_pending_keystrokes`, and the `layout.sync` state-home parameter. The
rebase therefore restores every customization file the rebased tree lacked
and re-applies the deltas to upstream-owned files through a 3-way merge whose
base is upstream at the merge and whose other side is the customization
branch tip (`7a6e344`).

The drift that merge exposed, fixed in the same commit: the terminal view has
one `key_down` that keeps upstream's find-field guards ahead of Sprig's
copy-mode and copy-shortcut handling; `Binding` serializes so legacy key
profiles can be re-scoped; three Sprig commands pass the app context
`focused_terminal` now requires. Later commits pin `sprig/upstreams.json` to
the new app base (`4eb39bb`), follow the rebased terminal, model and overlay
signatures in the test targets (`852db6f`), and give the Sprig Files mod the
remote Windows listing upstream added to the shipped one (`a4fb4ef`), which
the parameterized Files test asserts of both file mods.

The rebase changes no paired runtime: `herdr-core` stays at
`421c5ab41857f8b4a5f155c42f763008f455b33d` (0.1.17) with its two Sprig
legacy-clear patches, and the renderer at ghostty
`291fd050b9e9c293c8adb6a140742649b7e42d3a`. No core upgrade is required to
run this tree.

Validation on this tree: `cargo build --locked` clean; `cargo test --locked`
394 tests pass (364 app, 26 integration, 4 across three smaller targets), 2
ignored HC-session fixtures that need a running core; `just test`'s other gates
47 Python installer/consumer tests, 62 Node mod-consumer tests, 47 Bun script
tests; `just docs-check` 4 tests plus reference checks over 6 pages.
`python3 sprig/install.py` installs 70 files into a private root with personal
settings preserved. In an isolated native instance, `layout.switch` to the
shipped `rowan-terminal` layout loads the Sprig bundle — the 14 `rowan-*` and
`legacy.*` commands register, `terminal.copy_mode` and `terminal.scroll`
execute, and a background `space.new` creates a workspace from the repository
without stealing the window's view.

The slot-reuse test claimed the next window in the same instant it released a
lease. Under the full parallel suite the released lock was not yet visible to
that claim, which walked past the slot and took a fresh one: 3 failures in 10
full-suite runs on this tree, 0 in 10 on the pre-rebase tree, 0 in 5 serial
runs, 0 in 12 module-only runs and 0 in 33 runs that logged the claim. The test
now retries until the released slot answers, which keeps the assertion exact
and removes the window.

## Durable workspace grouping — 2026-11-03

Sprig now persists repository membership in a separate `sprig-sidebar` document
on each source core. No herdr-core source or protocol change is needed.
The frontend exposes asynchronous `readDocument` / `writeDocument` to trusted
mods over its current core connection; a reconnect replaces that connection.
This feature needs the paired rebuilt frontend, not a mods-only installation.

Document schema: `{schema: 1, spaces: {<source-local workspace ID>: {cwd, git}}}`,
where `git` is null for a verified non-repository, or
`{name, commonDir, linked}`. No frontend machine-name prefixes, selected pane,
zoom, fold or herd state is stored. Repository identity scopes a group; closing
its displayed parent does not delete the remaining worktrees.

On connection, the document loads before cold Git discovery. Only entries with
matching workspace/current cwd hydrate the sidebar; machine/core replacement
invalidates frontend state. Newly verified discovery updates are version-merged
into the source document, not copied wholesale from a stale frontend cache.
Connected frontends reconcile every 15 seconds and on relevant workspace/path
or discovery changes. A hierarchy snapshot must be read before the fresh source
layout used for cleanup, preventing a stale layout from erasing another
frontend's newly published workspace. Transient frontend omissions and offline
machines never authorize deletion. Unknown schemas remain untouched.

Validation: 53 Node consumer tests, 47 Python installer/consumer tests and 307
Linux app tests passed. Three document API tests also executed successfully on
Lappy's native Windows runtime. In an isolated native frontend/core session,
actual external linked worktrees and a symlinked/nested checkout were persisted.
Reopening a private frontend restored the hierarchy with identity Git queries
disabled and **zero such calls**, preserving all six existing terminal IDs/PIDs.
Closing the main workspace removed only its document entry, retaining both
linked worktrees. Actual native mod calls exercised remote CAS conflict results,
local/peer isolation and rejection of an invalid machine route.
This is not a Windows full-suite, physical-input or end-to-end latency claim.

The related garbled-first-paint report was reproduced in a private native session
with added attach-reply latency. An initial 120x40 snapshot arrived after the
local VT had already resized for the viewport, shifting/wrapping rows until the
program repainted. A generic next-frame callback was still too early because
the workspace mod can reveal its surface later. Initial attachment for a
potentially visible pane now waits for its actual canvas prepaint; hidden tabs
retain their subscriptions. The same fixture then attached at its measured
68x21 geometry with the correct device-pixel cell and no follow-up resize on
that stream; native screenshots showed correctly aligned rows from first paint.
This fixes the reproduced initial-size race, not every possible remote delay or
simultaneous resize by another viewer. No core change or arbitrary paint delay
was added. The latency/proxy fixture is temporary, not a production profiler.

Packages: https://github.com/JSRRosenbaum/grove-sprig/releases/tag/sprig-preview-2026.11.03.2.
Only the frontend/customizations change; paired core, ConPTY and native
annotation/review runtimes remain unchanged. Reopen frontends for activation,
not cores or OMP sessions. Prior development releases remain immutable below.

## Sidebar discovery and Lappy paste profile — 2026-11-03

The sidebar previously ran full `git status` scans serially, then separate
top-level/common-directory/realpath queries for every workspace. The removed
branch/ahead/behind values were no longer displayed. Partial discovery results
could change grouping on unrelated redraws, producing a slowly reshuffling list.

Discovery now uses one canonical `git rev-parse` query per folder, bounded to
four concurrent lookups. A complete batch publishes together; transient failures
retain retry semantics and machine/core identity changes invalidate old results.
Windows CRLF output is normalized; no external Unix `realpath` is required.
This changes presentation only: no repository or worktree is moved.

Read-only probes of 18 actual Nix working directories found 17 sharing Athena's
common Git directory; `athena-graph` is a distinct repository. Those local Git
probes took about 35 ms on Nix, not an end-to-end Windows UI measurement.
The isolated native sidebar rendered an external linked-worktree pair under a
symlinked/nested main checkout while leaving another repository and machine
namespace separate. Consumer tests cover delayed publication, bounded work,
machine replacement/retry, canonical paths and Windows line endings.

The owner explicitly changed Lappy's preference from Alt+V to Ctrl+V for
frontend image/text paste. Its authored source is now
`~/.config/herdr-app/legacy-profile.toml`; future installs must import that file,
not the unchanged legacy-server config. Other shortcuts, commands, numbered-tab
preferences and settings are preserved. Personal profiles are not shipped.

Lappy's running Windows window loaded the new module and Ctrl+V profile without
an app/core restart. Native screenshots and the live inspector confirmed rendering
and repository groups; the final status had no file/mod errors. During SSH
installation, inherited Owner Rights ACLs made Administrators-owned replacement
files unreadable to the unelevated desktop app. Ownership of installer-owned
files/directories and generated key metadata was restored to the existing
desktop account, without broadening ACL grants. Install from the desktop user's
context; an elevated SSH deployment must preserve that ownership.
The Windows headless `check` command could not open a window in the SSH session;
actual-window rendering, status and inspection were used instead. Physical
Ctrl+V image input on Lappy remains a user check; its clipboard was not replaced
and no synthetic input was sent to live agents. The same native paste action was
previously exercised with text and PNGs in the isolated Linux frontend.

Packages: https://github.com/JSRRosenbaum/grove-sprig/releases/tag/sprig-preview-2026.11.03.1.
This is a customization-only update using the existing app/core/native runtimes;
there is no native rebuild or core handover requirement. Older releases remain
immutable below.

## Remote terminal paste repair — 2026-11-03

The reported copy failure was actually paste: Auri and Ash selections reached
Rowan's regular clipboard (Ash also reached PRIMARY), but Ctrl+V sent only
byte `16` to remote terminal input. A remote program cannot read the frontend's
clipboard. The legacy key map also omitted Ctrl+Shift+V, previously supplied by
the outer terminal emulator.

The configured image-paste action now sends frontend text to remote terminals
using their active bracketed-paste mode. Image transfer remains intact; local
Unix Ctrl+V still goes to the program. Ctrl+Shift+V is a fallback in imported
legacy profiles, with explicit legacy assignments retaining precedence.

An owned isolated native frontend, Cua keyboard events and a raw remote input
recorder demonstrated the failure before repair and exact Unicode/multiline
input afterward, with bracketed paste both off and on. Local Ctrl+V/Ctrl+Shift+V
and actual remote PNG transfer were also exercised. This is not a Windows
runtime qualification claim.

Updated packages:
https://github.com/JSRRosenbaum/grove-sprig/releases/tag/sprig-preview-2026.11.03.
The prior snapshot below is retained unchanged.

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


