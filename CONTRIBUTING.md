# Contributing

Sprig is Grove's unofficial Herdr interface fork. Use
[JSRRosenbaum/grove-sprig](https://github.com/JSRRosenbaum/grove-sprig) for issues
and pull requests against `main`; the retired app/layout forks are history only.

The front-end is the app's own defaults: mods in `defaults/mods`, layouts in
`defaults/layouts` (registered in `LAYOUTS`, `src/window.rs`), themes in
`defaults/themes` (registered in `THEMES`, `src/settings.rs`). All three are
embedded at build time and written into the app home on launch, so a release is
one artifact. The app rewrites the defaults it owns on every start, so a
customization is an edit to the shipped file, never a clone under a new name.
`sprig/` keeps what the app cannot ship: the legacy key profile, the helper
modules and the plugin runtimes that `sprig/install.py` installs.
Preserve runtime IDs and existing user configuration unless an explicit
migration is included.
Use machine/group, workspace name, and the visible `w…` sidebar tag when
describing live work to users; hidden core IDs are implementation details.

## Code contributions

Discuss bigger changes in an issue first. Keep PRs small and focused.

See [build from source](README.md#build-from-source) for setup. Build on Ash.
Run `just test-sprig` for installer and mod behavior, and `just build` /
`just check` for native changes. On Linux, test UI changes with an isolated app
home, core and display (`scripts/sandbox` requires Weston). Never test against
someone else's running app or core.

Keep OS-specific code only where the OS really differs. Keep small quirks near their use; put larger differences behind one small module per concern. Test Windows and macOS changes on those systems.

When dependencies or bundled assets change, update their licenses and run `just notices`. See [licenses](licenses/README.md).
