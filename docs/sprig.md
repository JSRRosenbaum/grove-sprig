# Sprig provenance and upstream status

Canonical source: https://github.com/JSRRosenbaum/grove-sprig (`main`).

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
| Herdr app | 0.1.9 plus native patches | [0.1.12](https://github.com/herdrdev/herdr-app/releases/tag/v0.1.12) | No |
| herdr-core | 0.1.15 | [0.1.17 release manifest](https://releases.herdr.dev/core/latest.json) | No |
| Square Dracula | `e7640bf1` plus Rowan patches | `e7640bf1` | Already at upstream base |

Sources: [app release manifest](https://releases.herdr.dev/app/latest.json),
[app base-to-master comparison](https://github.com/herdrdev/herdr-app/compare/8180cbe6c947519e8015dd7c35801a93e08a7d66...72d5729718c9ff9c6e413c38f335e8b9f61257b4),
[layout upstream](https://github.com/kyle-avrett/herdr-square-dracula).
Stable app tag points to `4aa3460749947e7771aa39a8a2cec58d46649926`;
master was `72d5729718c9ff9c6e413c38f335e8b9f61257b4` when fetched.
There are 64 commits from our base to stable and 23 more on master.
App 0.1.12 declares minimum core 0.1.11; this is not proof that all our patches
are compatible without qualification. The observed core 0.1.17 notes concern
macOS core lifetime (issue 294); no core restart is needed for consolidation.

### Worth qualifying next

Already in stable 0.1.12:

- [`9af0ecc1`](https://github.com/herdrdev/herdr-app/commit/9af0ecc1): avoid multi-second window freezes during mod work.
- [`865d2fa1`](https://github.com/herdrdev/herdr-app/commit/865d2fa1): bound Linux folder watches and skip ignored trees.
- [`9087b0cc`](https://github.com/herdrdev/herdr-app/commit/9087b0cc): resync terminal display facts on theme changes.
- [`a5aa17bd`](https://github.com/herdrdev/herdr-app/commit/a5aa17bd), [`b600cdba`](https://github.com/herdrdev/herdr-app/commit/b600cdba), [`3979b90c`](https://github.com/herdrdev/herdr-app/commit/3979b90c): terminal font/icon, grapheme and braille rendering improvements.
- [`d6617bfc`](https://github.com/herdrdev/herdr-app/commit/d6617bfc): remote agent shell profiles.
- [`a4786fc8`](https://github.com/herdrdev/herdr-app/commit/a4786fc8): reject malformed target IDs before closing work.
- [`bf8f4721`](https://github.com/herdrdev/herdr-app/commit/bf8f4721): pane navigation into column splits.

Master-only, not part of the observed stable release:

- [`6a741257`](https://github.com/herdrdev/herdr-app/commit/6a741257): keep Wayland input on the first seat; relevant to our earlier CUA virtual-seat issue.
- [`64316dcb`](https://github.com/herdrdev/herdr-app/commit/64316dcb), [`b03019e0`](https://github.com/herdrdev/herdr-app/commit/b03019e0), [`414a06db`](https://github.com/herdrdev/herdr-app/commit/414a06db): control-chord and shortcut-help fixes; inspect against our prefix/key patches.
- [`c720514d`](https://github.com/herdrdev/herdr-app/commit/c720514d), [`2ceb2744`](https://github.com/herdrdev/herdr-app/commit/2ceb2744): workspace-order reconciliation/navigation; qualify with sidebar drag and herd-scoped navigation.

Do not mistake the earlier Kitty file-transport addition for a current fix:
[`e66ce975`](https://github.com/herdrdev/herdr-app/commit/e66ce975) reverted it pending safe reads.

## Upgrade and verification boundary

Do not merge 87 upstream commits as part of renaming repositories. The upstream
range changes `src/window.rs` heavily and overlaps our `src/model.rs`, `src/keys.rs`
and `defaults/AGENTS.md` patches. A subsequent Ash build must requalify concurrent
windows with independent selection/zoom, prefix cancellation/help, terminal image
rendering, remote connections, and sidebar ordering before deployment.

Consolidation changes installer, documentation and automation, not native app,
Cargo inputs or renderer code. Test customizations with `just test-sprig`, or run
the Python and Node commands in `justfile` directly if `just` is unavailable.
Build native changes on Ash. Always use a private app home/core/display for UI
smokes; never restart production agents or cores for verification.

The installer validates inputs and ownership, rejects symlinked descendants,
retains fresh platform shortcuts, prunes only unchanged obsolete overlay bindings,
and allocates rollback copies before replacement. Caught I/O failures roll back
file bytes without new allocation. Power-loss durability, concurrent installation
and adversarial directory-swap races are not promised; use an exclusive trusted
configuration directory. Backups are retained even when an install fails.

GitHub Actions are disabled on the new repository until deliberately enabled.
The inherited official release publisher was removed: Sprig has no authority or
secrets to publish official Herdr binaries. Existing CI recipes remain available.

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
