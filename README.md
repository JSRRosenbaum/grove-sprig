# Herdr

Herdr is a desktop app for terminals and coding agents. Keep work in spaces, see which agents need you, and leave terminals running when you close the window.

## Install

### Linux and macOS

```sh
curl -fsSL https://releases.herdr.dev/app/install.sh | sh
```

Linux needs a desktop session and a working Vulkan driver. macOS builds are available for Apple Silicon; Intel Mac users can [build from source](#build-from-source). Linux builds are x86-64 and ARM64.

The installer adds Herdr to your apps and puts the command in `~/.local/bin`.
Add that folder to your PATH if the installer asks.
On macOS the app lives in `~/Applications/Herdr.app`.
For drag-and-drop installation on Apple Silicon, download [Herdr.dmg](https://releases.herdr.dev/app/Herdr.dmg) and drag Herdr to Applications.

On macOS (Apple Silicon), you can also install with [Homebrew](https://brew.sh/):

```sh
brew install --cask herdr-app
```

### Windows

Run in PowerShell on x64 Windows with curl and tar installed (Windows 10 1803 or newer):

```powershell
irm https://releases.herdr.dev/app/install.ps1 | iex
```

Herdr appears in the Start menu. The installer adds `%LOCALAPPDATA%\Programs\herdr-app` to your user PATH. Open a new terminal to pick it up.

The shell and PowerShell installers download and run code. Read the [shell installer](distribution/install.sh) or [PowerShell installer](distribution/install.ps1) first if you prefer.
They also install [herdr-core](https://github.com/herdrdev/herdr-core) if it is missing.
The app can help install or update a core it cannot use.

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

A **layout** arranges the native window. **Mods** are trusted JavaScript programs
that draw panels, menus and dialogs. Save personal layout, mod or key files to
reload them; a broken edit retains the last good version and reports an error.
Duplicate shipped layouts/mods before changing their structure.

The app's executable and installed state still use `herdr-app`, `rowan-terminal`
and `rowan-*` names for compatibility. The project name is Sprig; those stable
runtime IDs are not a second installation.

Ctrl+Shift+P shows every command and its key (Cmd+Shift+P on macOS). Change any key in `keys.json`; see [the keys section](defaults/AGENTS.md#keys-keysjson) of the mod guide for the format, including JSON objects for named, typed command arguments.

[Layouts and mods](docs/mods.md) · [Commands](docs/commands.md)

## Updates and privacy

Installed releases check for updates in the background and download a new app beside the running one. It takes over when you quit and reopen, or choose the update action. Your terminals keep running in the core.
Settings → Updates shows what is available. What's New opens after an update; you can open it again from the command palette.
Builds from source do not update themselves.

Usage telemetry is on by default in releases. Turn it off in Settings → Privacy.
Mods are trusted code, not sandboxed extensions. Read [security and privacy](docs/security.md) before installing someone else's mod.

## For agents

Use herdr-core to run and coordinate programs; use the frontend to change what
the person sees. Inspect before changing a live view:

```sh
herdr-app --skill
herdr-app windows
herdr-app --window 1 status
herdr-app --window 1 ls
herdr-app commands
```

An ambiguous or unavailable window target fails rather than guessing.
[Command reference](docs/commands.md) · [Layouts and mods](docs/mods.md)

## Build from source

The native Rust app is at the repository root; `sprig/` contains its supported
customization bundle and legacy integration. Build instructions and system
prerequisites are in [Contributing](CONTRIBUTING.md) and the
[CI workflow](.github/workflows/ci.yml).

```sh
git clone --recurse-submodules https://github.com/herdrdev/herdr-app.git
cd herdr-app
just build
just test
just install
```

`just test-sprig` runs customization checks. `just docs-check` checks generated
references and CLI examples. For maintainers, build on Ash rather than the live
Rowan workstation; deploy deliberately without restarting someone else's
frontend, core or agents. Source builds do not update themselves.

Documentation checks also need [Bun](https://bun.sh): `just docs-check` checks generated pages and CLI examples; `just docs-generate` refreshes the reference pages.

[License](LICENSE) · [Third-party notices](THIRD-PARTY-NOTICES) ·
[Imported revisions and upgrade boundaries](docs/sprig.md)
