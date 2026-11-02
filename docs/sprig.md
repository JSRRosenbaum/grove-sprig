# Sprig provenance and upstream status

Canonical source: https://github.com/JSRRosenbaum/grove-sprig (`main`).

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
retains fresh platform shortcuts, prunes only unchanged obsolete overlay bindings,
and allocates rollback copies before replacement. Caught I/O failures roll back
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
