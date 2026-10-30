# Square Dracula

A square, gapless Dracula layout for [Herdr](https://herdr.dev).

![Square Dracula](preview.png)

## Requirements

- Herdr and herdr-core installed and working. Built from Herdr 0.1.7's shipped layouts
  and mods.
- Git, used by the Files, Changes, Spaces, and worktree panels.
- Fira Code for the intended terminal and interface typography. It is not bundled; Herdr uses
  its available fallback fonts when it is missing.

The layout carries its own Dracula colors, fonts, and terminal padding. Installing it does
not require replacing your global settings or keybindings.

## Install

Launch Herdr at least once so it creates its shipped assets, and keep it running for the
layout-switch command below.

Clone this repository outside your Herdr configuration folder:

```sh
git clone https://github.com/kyle-avrett/herdr-square-dracula.git
cd herdr-square-dracula
```

Run the following from the cloned repository. It stops without copying anything if the
layout or any of its mod folders already exists. For an existing installation, use the
update instructions instead.

```sh
(
  set -e
  home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"

  test ! -e "$home/layouts/square-dracula.json"
  for mod in mods/square-dracula-*; do
    test ! -e "$home/mods/${mod##*/}"
  done

  mkdir -p "$home/layouts" "$home/mods"
  cp layouts/square-dracula.json "$home/layouts/"
  cp -R mods/square-dracula-* "$home/mods/"

  for mod in "$home"/mods/square-dracula-*; do
    herdr-app check "$mod"
  done

  herdr-app do layout.switch --name square-dracula
)
```

The default configuration path is `~/.config/herdr-app`. Set `HERDR_APP_HOME` before running
these commands if your Herdr window uses a different configuration folder.

All custom mods use the `square-dracula-` prefix. Herdr's shipped layouts and mods are not
replaced. The in-app preview travels inside `mods/square-dracula-workspace-chrome/`; the
repository's root `preview.png` and `RECIPE.md` are for the gallery.

## Optional picker shortcuts

The sidebar search button opens the square-styled picker without any key changes.

To bind the picker only in this layout, merge the following section into your existing
`keys.json`. Preserve its other sections and bindings:

```json
{
  "layout:square-dracula": {
    "ctrl-shift-k": "square-dracula-workspace-chrome.picker",
    "ctrl-x l": "square-dracula-workspace-chrome.picker"
  }
}
```

The repository's `keys.json` and `settings.json` are the author's personal configuration
snapshots, not required installation files. Do not overwrite your own with them unless you
want all of those preferences and shortcuts.

## Controls

- Select a space or tab by clicking it; right-click for its context menu.
- The `+` after the last tab opens terminal, agent, space, and worktree actions.
- Files and Changes buttons open, switch, or close the right panel. The choice is remembered
  per space. Files previews and Changes diffs are read-only; there is no commit-entry row.
- Hover a terminal header to reveal split-right, split-down, zoom, and close buttons.
- The sidebar search button opens the picker; Escape dismisses it.
- Pane context menus have one square frame, including on Herdr 0.1.7.

Settings, the command palette, confirmation dialogs, notifications, and terminal programs'
internal interfaces remain Herdr's or the program's own UI.

## Update or remove

Before updating, back up the installed `layouts/square-dracula.json` and the twelve
`mods/square-dracula-*` folders. Pull this repository with `git pull --ff-only`, replace only
those namespaced files and folders, rerun the mod checks from the installation section, and
switch to `square-dracula` again.

To remove it, first switch to another layout, such as:

```sh
herdr-app do layout.switch --name main
```

Then delete only `layouts/square-dracula.json` and the twelve `mods/square-dracula-*` folders
from your Herdr configuration. If you added the optional keyboard section, remove it too.
Your terminals and workspaces belong to herdr-core, not to this layout.

## What the mods access

These are modified versions of Herdr's shipped mods and run with your user permissions.
They inspect live spaces, tabs, agents, folders, and git repositories. The machine dialog
reads `~/.ssh/config`; adding a machine can connect over SSH through `hc`. Worktree actions
create or remove checkouts only when explicitly invoked. There are no `fetch()` calls or
custom HTTP polling loops in these mods.

## Gallery and recipe

[RECIPE.md](RECIPE.md) describes the interface, implementation, limitations, and acceptance
checks. This single-layout repository keeps the recipe, screenshot, `layouts/`, and `mods/`
together at its root and uses the GitHub topic `herdr-layout` for gallery discovery.

[herdr.dev/layouts](https://herdr.dev/layouts/) handles indexing and screenshot moderation;
a published repository may not appear immediately.

## Attribution

The layout and mods are modified from [Herdr 0.1.7](https://github.com/herdrdev/herdr-app),
under the [Apache-2.0 license](LICENSE). [NOTICE](NOTICE) records the changes and the Lucide
and Feather icon licenses. Program icons and the Herdr brand image are supplied by your
Herdr installation, not copied into this repository.
