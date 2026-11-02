# Sprig

Canonical repository: https://github.com/JSRRosenbaum/grove-sprig, branch `main`.
Joseph maintains this unofficial interface fork. Native app source is at the
root; customizations and their installer/tests are under `sprig/`.
Upstream Herdr app is maintained by Can (`ogulcancelik`); its architecture rules
remain useful, but Sprig changes are approved by Joseph, not upstream.

If AGENTS.local.md exists, read it too: the maintainer's local rules.

## Compatibility

Preserve compatibility with released versions and installed user data.
Discuss breaking changes and removal of compatibility code with the maintainer
before changing documented behavior.

## Keep the app core small

The app's core (the model, machine layout documents, commands, and shared mod APIs)
stays small; everything else is mods. Before adding anything to it, answer
these three and discuss substantial changes with Joseph:

1. Does the app itself act on it (it changes what the app does, not only
   how something looks)?
2. Can only the app see it (e.g. a change that happens while no mod is
   watching)?
3. Can mods not do it correctly, even with care?

If all three are no, it belongs in mods (their shared storage, their own
code), even at the price of some repetition. Changes proposed for upstream
Herdr app or herdr-core still need discussion with their maintainers.

`herdr-app --skill` prints the window manual in `src/SKILL.md`.
Keep it current when changing agent-facing behavior.

## The guide users' agents read

`defaults/AGENTS.md` is written into every user's `~/.config/herdr-app` on
every start: it's how their agents learn what the app can do. A change to
what users or agents can do (a command, a setting, a layout or mod
feature, a file) updates it in the same commit. `cargo test` checks that it
names every command and settings.json key; the rest is on you. Keep it a
map with rules and short examples: the `.d.ts` files are generated and are
the full API.

## What ships in the box

`defaults/` is built into the app: mods, `layouts/*.json`, `keys.json`
(Linux, Windows) and `keys.macos.json` (Mac). Shipped layouts and mods are
replaced on start; edited versions are moved to personal copies. Layout
clicks are kept separately. `keys.json` is installed only when missing, so a
changed default key never reaches existing users by itself.

## Platform differences

Gate per OS only where the OS really behaves differently. A one-line
`cfg!(windows)` next to the quirk is fine, with a comment saying why; anything
bigger goes behind one small module per concern rather than `#[cfg]` spread
through shared code. Give the quirk a test on its platform and keep the other
platforms' behavior unchanged (and tested). Windows and macOS changes are
checked on those systems, not only by cross-compiling.

## Building and testing

`just build`, `just test` (what CI runs, on Linux), `just check` (the tests).
`just install` builds and installs the desktop app using the platform installer.
On Windows it updates `%LOCALAPPDATA%\Programs\herdr-app` and the Start menu;
quit and reopen Herdr to use the new build. Windows recipes use PowerShell by default;
`just --shell pwsh --shell-arg -Command <recipe>` uses pwsh.

Build on Ash, not Rowan. `just install-sprig` installs only the customizations;
`just test-sprig` runs their installer/consumer suites. Keep runtime IDs stable
unless an explicit state migration is part of the change. `sprig/upstreams.json`
records the imported source pins; update it when actually adopting upstream code.

Never run a bare `target/*/herdr-app` (no arguments) on a machine where you
also use the app without `HERDR_APP_HOME` pointing at a scratch home: it
opens a second window on your real setup. Subcommands and `--help` only
talk.

On Linux, test UI changes in the sandbox: `scripts/sandbox up`, then `do
<command> [json]`, `status`, `shot` (screenshot), `move|click|drag`
(pointer input, window px), `type`, `key <keysym> [Control_L ...]`, `hc
...`, `restart`, `down`. It has its own core, home and a headless display
(Weston + Xwayland) under `/var/tmp/herdr-app-sandbox`, so nothing pops up
on your screen. Never fake input on a real display. Run `scripts/sandbox
down` when done.

## Contributing

Work on a branch and open a pull request to Sprig's `main`. CI must pass.
Commit messages: lowercase conventional commits, single line, no AI co-author
lines. Do not enable upstream publishing workflows or publish official Herdr tags.

Never stop, signal, or restart someone else's app or core. Use an isolated
app home and core session for testing.
