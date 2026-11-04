# Herdr changelog

## Unreleased

### Fixed
- New worktree immediately creates an automatically named branch and workspace,
  without a title prompt or confirmation keystroke.
  (#1, thanks @JSRRosenbaum)

## [sprig-preview-2026.11.03.2] - 2026-11-03

### New
- Remember workspace repository/worktree groups in each source core so other
  Sprig frontends and reopened windows can restore the hierarchy without
  rediscovering every checkout. No herdr-core upgrade is required.
  (#1, thanks @JSRRosenbaum)
- Share hierarchy updates with version-checked merges; closing a workspace
  removes its record without orphaning surviving worktrees. Disconnected
  machines keep their metadata. (#1, thanks @JSRRosenbaum)

### Fixed
- Measure a visible pane before its initial terminal attachment, preventing an
  old-size snapshot from being decoded at the new viewport width and then
  corrected by another resize/repaint. Hidden tabs remain attached.
  (#1, thanks @JSRRosenbaum)

Requires the matching Sprig frontend and customization bundle; the core,
ConPTY and native annotation/review runtimes are unchanged.

## [sprig-preview-2026.11.03.1] - 2026-11-03

### Fixed
- Discover repository/worktree groups with bounded lightweight Git queries
  instead of serial status scans, then publish each discovery batch together
  so the sidebar does not reshuffle one completed lookup at a time.
  (#1, thanks @JSRRosenbaum)
- Handle Windows line endings in repository paths without requiring a separate
  Unix `realpath` command. (#1, thanks @JSRRosenbaum)

Customization-only update; native app/core binaries are unchanged.

## [sprig-preview-2026.11.03] - 2026-11-03

### Fixed
- Paste frontend clipboard text into remote terminals instead of sending a
  Ctrl+V keystroke to a program that cannot read that clipboard. Remote image
  transfer and local Unix Ctrl+V behavior remain unchanged.
  (#1, thanks @JSRRosenbaum)
- Restore Ctrl+Shift+V terminal paste in the legacy layout without overriding
  an explicitly assigned legacy shortcut. (#1, thanks @JSRRosenbaum)

Unsigned development snapshot; Windows runtime/desktop checks and repository
CI qualification remain pending.

## [sprig-preview-2026.11.02] - 2026-11-02

### New
- Publish paired Linux x86-64 and Windows x64 app/core/customization development
  bundles, with native annotation/review tools, checksums and install/rollback
  instructions. Thanks @JSRRosenbaum.
- Restore legacy prefix/help, navigation, copy/search, pane controls and
  host-specific shortcuts. (#1, thanks @JSRRosenbaum)

### Fixed
- Creating a workspace in the background no longer steals the current view.
  (#1, thanks @JSRRosenbaum)
- Restore copy-on-release feedback and Windows Ctrl-click URL handling.
  Windows binaries no longer need a separate VC++ Redistributable.
  (#1, thanks @JSRRosenbaum)

Development snapshot, not a stable/upstream release. Windows desktop validation
and the disabled repository CI gate remain outstanding. Linux binaries require
glibc 2.44; no macOS or ARM binaries are included.

## Sprig background workspace focus fix — 2026-11-02

- Background workspace creation no longer switches the addressed window away
  from its current workspace, tab or pane. Keys/clicks and intentional worktree
  launches still select the newly created workspace.

## Sprig legacy interaction parity — 2026-11-02

- Restore original prefix ownership, modal navigation, terminal Go To, keyboard
  copy/search, pane cycling/resize, rename and field-local kill/yank controls.
- Compile the original host-specific key profiles and custom commands; newer
  bindings no longer intercept keys owned by terminal programs.
- Port annotation/review, Worktrunk, Workthreads and sci-fi grid actions to
  herdr-core without restarting agents or reinstalling the legacy server.
- Restore copy-on-release feedback and use Windows' registered URL handler for
  Ctrl-click links. Build Windows executables with the C runtime linked statically.
- Clear authoritative terminal history without sending input, preserving the
  wrapped cursor line and leaving alternate-screen programs unchanged.

## Sprig upstream integration — 2026-11-02

- Integrated all upstream app changes through `71d3e8f`, including released
  0.1.10–0.1.12 improvements and reviewed master fixes, while retaining concurrent
  independent windows, native prefix/help and the compact herd interface.
- Adopted core `421c5ab` (0.1.17 plus dead-display, CRLF-template and current-folder
  fixes), built on Ash. Source pins are in `sprig/upstreams.json`.
- Ported shared pins and legacy migration, focusable Spaces/Agents, picker scrolling,
  rebuilt-machine repair, cached agent menus and Files fixes into the active mods.
- Removed every branch suffix from sidebar workspace rows without changing names,
  tree/status gutters or persistent display tags.
- Added acknowledged machine `space_order` metadata so sidebar drag intent survives
  optimistic updates and late core write conflicts without forcing per-window herd
  ordering into shared state.
- Included upstream opt-in `font_ligatures`; existing preferences remain unchanged.

## Sprig consolidation — 2026-11-02

- Consolidated the custom native app and Square Dracula/Rowan mods in
  `JSRRosenbaum/grove-sprig`, preserving both complete histories and attribution.
- Added one canonical installer, `python3 sprig/install.py`, including all eleven
  mod dependencies, the theme/layout and the OMP companion.
- Preserved personal settings and unrelated shortcuts; fresh installs retain
  platform defaults. Updates remove only owned stale files and unchanged obsolete
  overlay shortcuts.
- Refused symlink escapes and pre-staged rollback data before changing live files.
- Integrated installer and consumer behavior checks into the root test workflow.
- Retained the qualified native app/core baseline during consolidation; the
  subsequent upstream app integration is recorded below.

## [0.1.12] - 2026-11-02
<!-- spotlight macos -->

### New
- **On macOS, your agents now run fully apart from the app.** Close Herdr, quit it, update it: your agents keep running. Agents already running pick this up the next time they start.
- On macOS, the system may ask once if **herdr-core** can access a folder like Documents. That's Herdr; click Allow.
- On macOS, Settings > Keyboard chooses what Option does: Alt, typing characters like á and €, or left or right Option as Alt.
- A machine that was rebuilt or replaced shows "rebuilt · Connect" in the sidebar: one click connects to the new one.
- Seen and pinned agents are shared between Herdr windows and the phone app.
- Mods can take the keyboard, so moving focus can land on them. (#283, thanks @Osc100)
- PiG agents have their own icon. (#299, thanks @balcsida)
- Add machine takes a port, like `can@server:2222`.

### Fixed
- On Linux, color emoji show in color instead of blank (Fedora's emoji font).
- Emoji like ✍️ and ❤️ take two cells and draw in color. (#287, thanks @occultsound)
- On macOS, programs in Herdr terminals can ask for the microphone, camera and to control other apps. (#137, thanks @shivanandasai-altir; #252)
- Agents on another machine find the commands their shell setup puts on PATH. (#262, thanks @tajchert)
- New spaces open on the machine you're looking at.
- Horizontal scrolling reaches programs like vim and less.
- Clicks work in Textual apps.
- btop's braille graphs draw without gaps.
- Nerd Font icons use your terminal font.
- Rounded corners and dashed lines in boxes draw like Ghostty. (#255, thanks @occultsound)
- Herdr uses less CPU with many busy agents.
- A big project no longer makes the folder watcher burn a CPU core. (#263, #257)
- Mod pictures and icons update when their file is saved.
- Moving focus back into a split returns to the pane you came from. (#304, thanks @sundarshahi)
- Unnamed tabs show what their agent is doing in the agents list. (#281, thanks @sundarshahi)
- A new tab with no space open starts a space. (#303, thanks @sundarshahi)
- Files marks the files inside a new folder, and opens folder symlinks. (#309, thanks @Nagell; #301, thanks @azaeldrm)
- Lists in mods follow the zoom. (#296, thanks @Calonca)
- The + menu shows your agents right away. (#251, thanks @shellscape)
- Grok shows its own icon. (#293, thanks @Zynoo71)
- A malformed command can't close the tab you're on. (#297, thanks @chanyang721)
- On Linux, Ctrl+Insert and Shift+Insert copy and paste in new installs; add them to your keys.json to get them on an existing one. (#258, thanks @dr-moreira)
- In full screen on macOS, the sidebar header lines up. (#261, thanks @runkids)
- On Windows, file names in Korean, Chinese and other languages show and open in Files. (#236, thanks @loonslo)
- On Windows, Esc then Ctrl+C reach the program as two keys. (#162, thanks @JJLiebig)
- In Git Bash on Windows, the installer points to the PowerShell one. (#238, thanks @sundarshahi)

## [0.1.11] - 2026-10-31

### Fixed
- The window no longer freezes or spikes the CPU for seconds at a time while mods run.
- Programs get the new colors right away when you change the theme or switch light and dark. (#122, thanks @geoqiao)
- On macOS, Vietnamese input methods like OpenKey, DauKey and Gõ Nhanh type in terminals. (#230, thanks @emizuki)
- Links a program breaks across lines open with Cmd+click. (thanks @pdeveltere)
- Editing the theme you're using repaints the window. (thanks @shawnyeager)
- Mod tooltips show in embedded windows. (thanks @ruilopesm)
- Opening the palette or a popup again closes it instead of stacking another. (#151, thanks @ruttybob)
- The status bar shows your real palette key. (#150, thanks @ruttybob)
- The Go-to popup keeps the selected row in view. (#152, thanks @ruttybob)
- No empty strip under the agents list in a wide sidebar. (thanks @kaofelix)
- A failed update check no longer says "Up to date". (#186, thanks @weichieh0204)

## [0.1.10] - 2026-10-30

### Fixed
- Images that Claude Code, yazi and other programs draw with kitty placeholders show up instead of rows of boxes. (#110)
- Images are the right size and sharp on Retina and other HiDPI screens. (#70, thanks @wpdmitry)
- Hover effects work in Claude Code and other programs that track the mouse.
- A drag that starts in another pane no longer reaches nvim or tmux, and a drag inside one keeps working when you let go outside it.
- Dragging a selection past the top or bottom of a terminal scrolls it.
- Closing a tab or space no longer brings its terminals back as unnamed tabs for a moment. (#108)
- The + menu starts agents with 1 to 9 while it's open, and shows your own shortcuts. (#102, #133, thanks @notHuman9504)
- Add a machine lists every host in your SSH config and shows the install prompt on top. (#95)
- Your own alert sounds play, and sound changes apply without a restart.
- A layout block that shows the focused agent stays in your layout when that agent ends.
- The Files panel keeps your open folders and preview when you switch spaces. (#86, thanks @ruilopesm)
- Dragging a space in the sidebar shows where it will land. (#114, thanks @takahashi-seiryu)
- Long agent titles cut off before the pin and the time. (#127, thanks @rashim2104)
- The + above Spaces lines up with the sidebar button. (#121, thanks @weskor)
- On macOS, a slow mouse wheel scrolls terminals. (#80, thanks @juanibiapina)
- On macOS, Cmd+V pastes copied files and screenshots into agents. (#105, thanks @WesleyBLDC)
- On macOS, Cmd+Shift+[ and ] switch tabs, and other Shift+punctuation shortcuts work.
- On macOS, Option types [ ] { } on ABC-QWERTZ and ABC-AZERTY.
- On macOS, Vietnamese Telex and other input methods compose. (#93)
- On macOS, keys typed with Fn held, like Fn+Esc for a backtick, reach terminals.
- On macOS, agents started from the + menu load your login setup, like Homebrew's PATH.
- On Windows, Ctrl+V pastes text, like Windows Terminal.
- On Windows, the Files panel opens folders with spaces or parentheses in their path. (#130)
- On Windows, the window buttons line up and stay crisp at every display scale.
- On Linux, Chinese typed through fcitx or ibus on X11 comes out right. (#97)
- On Linux, accent keys no longer type a stray character first. (#87, thanks @ruilopesm)
- On Linux, right-clicking a tab no longer opens the window manager's menu too. (#79, thanks @dev-gvs)
- `terminal.open` with a command starts in the folder you give it.
- `herdr-app check` no longer crashes on mods with scrolling lists or layout animations.

## [0.1.9] - 2026-10-30

### Unofficial Rowan fork additions - 2026-10-31
- Ordinary launches open concurrent windows on the same configuration and core.
- Each window keeps separately locked, persistent view/mod state; shared configuration
  and core terminals are not duplicated.
- `herdr-app windows` lists live windows; `--window <id>` explicitly targets CLI
  inspection and commands. Ambiguous requests fail instead of guessing a window.
- Automatic completion/blocked sounds have one owner across windows.
- Pending native chords show a bottom PREFIX bar after the sidebar, following
  its resized/hidden edge with left-aligned cancellation/help hints. App chords
  with an effective Escape continuation stay armed until completion or cancellation.
- The key guide filters to the active layout and terminal binding precedence,
  uses readable action labels, and searches both shortcuts and actions.

### Fixed
- On macOS, updates keep Herdr's Apple signature again, so macOS stops forgetting the permissions you gave Herdr.
- Herdr no longer uses CPU in the background when the Changes or Files panel is open in a git repo.
- Mods use less CPU while they wait for work.

## [0.1.8] - 2026-10-30

### New
- **Option works as Alt on macOS.** Claude Code's Option shortcuts work, automatically on US keyboards. Change it with `option_as_alt` in settings.json.
- **Programs can copy to your clipboard,** also from other machines. Pi's or Claude Code's own mouse selection lands on your clipboard.
- **Your own commands in the + menu.** Entries in programs.json show up, shell functions included.

### Fixed
- Accent keys work on macOS and with ibus on Linux, and Caps Lock types capitals on macOS.
- @, [ and friends type on Slovenian, German and other Mac layouts in every program.
- Terminal colors show exactly as programs set them, so powerline prompts look right.
- Double-click selects a word, triple-click a line.
- Agents start from the + menu under fish, and one that fails at launch says why.
- On macOS, the window buttons stay clear of a narrow sidebar and the tabs.
- You can type a commit message in the Changes panel.
- Spaces named with emoji or accents work everywhere.
- The font list in Settings scrolls on its own.
- A downloaded update installs at the next start, even after a crash.

## [0.1.7] - 2026-10-29

### Fixed
- Herdr no longer freezes when a terminal shows an older Nerd Font icon it has no picture for, like some powerlevel10k battery icons. It draws them as text instead.

## [0.1.6] - 2026-10-29

### New
- **Coming from herdr?** The welcome says what carries over and gives you one line for your agent to bring your keybinds and settings across. Open it again with Show the welcome again in the command palette.
- **Updates at a glance.** Settings → Updates shows the app and the core on one row each, with What's new a click away.
- **herdr-core updates with Herdr.** After Herdr updates, its core moves to the latest version too. Your terminals keep running.
- **Screenshots in feedback.** Drop images straight onto the feedback form.

### Fixed
- Paste and copy in a peek go to the terminal you're peeking at, not the agent behind it.
- Scroll back through thousands of lines instead of a few hundred.
- Mod data, like topics and colors, can't get lost if Herdr closes in the middle of saving.
- Commands with an argument they don't know say so instead of acting on the current terminal.
- On Windows, file links at the end of a sentence open the right file.

## [0.1.5] - 2026-10-27
<!-- spotlight -->

### New
- **Drag panes where you want them.** Hover the top of a pane and grab the dots. Drop it on another pane to swap them, or near an edge to put it beside. A highlight shows where it lands.
  ![Dragging a pane beside another](https://media.herdr.dev/0.1.5/pane-drag.webp)
- **Ctrl-click a terminal to peek at it.** When an agent mentions another terminal, like t2, Ctrl-click (Cmd on macOS) its address to see it over your tab. Go to jumps there.
  ![Peeking at a terminal an agent mentioned](https://media.herdr.dev/0.1.5/peek.webp)
- **Agents can see the window.** `herdr-app shot` saves a picture of Herdr as it looks right now, so an agent building a mod can check its work. `herdr-app --skill` and `hc --skill` teach an agent the rest.
- **What changed, after every update.** Release notes like these, in Settings → Updates, including versions you skipped.

### Fixed
- nvim and other full-screen programs redraw right after you resize their pane.
- On Windows, AltGr and accent keys type the right characters, and Shift+Enter adds a new line in Claude Code.
- On Windows, new terminals start in PowerShell 7 when you have it, and Herdr follows their folder.
- On macOS, Herdr keeps the permissions you gave it across updates.
- Short menus open next to the pointer instead of near the top of the window.
- Removing a worktree asks once, then removes it.
- Mods can fetch from the web, know their size, and clean up when they close.

## [0.1.4] - 2026-10-23
<!-- spotlight -->

### New
- **See the agents that need you first.** Pick Priority beside the Agents title: agents waiting on you, then the ones that just finished, then the ones still working. Grouped by space is still there.
- **Pin the ones you're watching.** Hover an agent and click the pin. Pinned agents stay on top in both views until they end.
- **Fold what you don't need.** Click a space or section header to fold it; the header still shows how many agents are inside.

### Fixed
- Temporary agent sandboxes stay out of your spaces and machine lists.
- The agents list keeps its place when you scroll.
- An agent you're in moves to its new section right away.
- A pane closes when its terminal finishes instead of showing “has finished”.
- On macOS, the red close button hides Herdr instead of leaving it without a window.
- Mods reload cleanly when you save them, and tell you when a save didn't load.
