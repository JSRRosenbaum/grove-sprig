# Contributing

Sprig is Grove's unofficial Herdr interface fork. Use
[JSRRosenbaum/grove-sprig](https://github.com/JSRRosenbaum/grove-sprig) for issues
and pull requests against `main`; the retired app/layout forks are history only.

Prefer changes in `sprig/mods` and `sprig/layouts` when the existing API can express
the behavior. Native app source remains at the root. Preserve runtime IDs and
existing user configuration unless an explicit migration is included.
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
