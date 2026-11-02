"""Compile the original Herdr key configuration into Sprig bindings.

Resolution follows Herdr 5ea51c01: user fields precede custom commands,
which precede defaults; within each group the original registration order wins.
"""
import base64
import json
import os
from pathlib import Path
import shlex
import tomllib


ACTIONS = {
    'help': 'mod.open:rowan-help', 'settings': 'app.settings',
    'new_workspace': 'rowan-spaces.active:space.new',
    'new_worktree': 'rowan-spaces.worktree-new',
    'open_worktree': 'rowan-spaces.worktree-open',
    'remove_worktree': 'rowan-spaces.worktree-remove',
    'rename_workspace': 'rowan-spaces.active:space.rename',
    'close_workspace': 'rowan-spaces.active:space.close',
    'workspace_picker': 'mod.open:rowan-navigate', 'goto': 'mod.open:rowan-goto',
    'detach': 'window.close', 'reload_config': 'app.reload',
    'open_notification_target': 'notification.open_target',
    'previous_herd': 'rowan-spaces.herd-prev', 'next_herd': 'rowan-spaces.herd-next',
    'previous_workspace': 'rowan-spaces.workspace-prev', 'next_workspace': 'rowan-spaces.workspace-next',
    'previous_agent': 'rowan-agents.agent-prev', 'next_agent': 'rowan-agents.agent-next', 'focus_agent': 'agent.select',
    'remote_image_paste': 'terminal.paste_image',
    'new_tab': 'rowan-spaces.active:tab.new', 'rename_tab': 'rowan-spaces.active:tab.rename',
    'previous_tab': 'rowan-spaces.active:tab.prev', 'next_tab': 'rowan-spaces.active:tab.next',
    'move_tab_previous': 'rowan-spaces.active:tab.move:left', 'move_tab_next': 'rowan-spaces.active:tab.move:right',
    'switch_tab': 'rowan-spaces.active:tab.select', 'switch_workspace': 'space.select',
    'close_tab': 'rowan-spaces.active:tab.close', 'rename_pane': 'pane.rename',
    'edit_scrollback': 'terminal.edit_scrollback', 'clear_pane': 'terminal.clear', 'copy_mode': 'terminal.copy_mode',
    'cycle_pane_next': 'pane.cycle:next', 'cycle_pane_previous': 'pane.cycle:prev', 'last_pane': 'pane.last',
    'split_vertical': 'rowan-spaces.active:pane.split:right', 'split_horizontal': 'rowan-spaces.active:pane.split:down',
    'close_pane': 'rowan-spaces.active:pane.close', 'zoom': 'rowan-spaces.active:pane.zoom',
    'resize_mode': 'pane.resize_mode', 'toggle_sidebar': 'layout.toggle:sidebar',
}
for _direction in ('left', 'down', 'up', 'right'):
    ACTIONS['focus_pane_' + _direction] = 'rowan-spaces.active:pane.go:' + _direction
    ACTIONS['swap_pane_' + _direction] = 'rowan-spaces.active:pane.swap:' + _direction
    ACTIONS['resize_pane_' + _direction] = 'pane.resize:' + _direction
NAV = {f'navigate_{name}': 'rowan-navigate.' + name.replace('_', '-') for name in (
    'workspace_up', 'workspace_down', 'pane_left', 'pane_down', 'pane_up', 'pane_right')}
INDEXED = {'focus_agent': 'agents', 'switch_tab': 'tabs', 'switch_workspace': 'workspaces'}
# This order is the source registry order, not TOML or JSON object order.
ORDER = ('help settings new_workspace new_worktree open_worktree remove_worktree rename_workspace '
         'close_workspace workspace_picker goto detach reload_config open_notification_target previous_herd '
         'next_herd previous_workspace next_workspace previous_agent next_agent focus_agent remote_image_paste '
         'new_tab rename_tab previous_tab next_tab move_tab_previous move_tab_next switch_tab switch_workspace '
         'close_tab rename_pane edit_scrollback clear_pane copy_mode focus_pane_left focus_pane_down '
         'focus_pane_up focus_pane_right swap_pane_left swap_pane_down swap_pane_up swap_pane_right '
         'last_pane cycle_pane_next cycle_pane_previous split_vertical split_horizontal close_pane zoom '
         'resize_mode resize_pane_left resize_pane_down resize_pane_up resize_pane_right toggle_sidebar').split()
MODIFIERS = {'ctrl': 'ctrl', 'control': 'ctrl', 'shift': 'shift', 'alt': 'alt', 'option': 'alt',
             'meta': 'alt', 'cmd': 'cmd', 'command': 'cmd', 'super': 'cmd'}
KEYS = {'space': 'space', 'enter': 'enter', 'return': 'enter', 'esc': 'escape', 'escape': 'escape',
        'tab': 'tab', 'backspace': 'backspace', 'bs': 'backspace', 'left': 'left', 'right': 'right',
        'up': 'up', 'down': 'down', 'minus': '-', 'comma': ',', 'period': '.', 'slash': '/',
        'backslash': '\\', 'quote': "'", 'double_quote': '"', 'double-quote': '"',
        'semicolon': ';', 'colon': ':', 'percent': '%', 'ampersand': '&', 'backtick': '`', 'plus': '+'}
SUPPORTED_PLUGINS = {'annotate.capture', 'annotate.copy-context', 'annotate.manage', 'annotate.open',
                     'annotate.last', 'workthreads.menu', 'worktrunk.open', 'worktrunk.open-current'}


def values(value, field):
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list) and all(isinstance(v, str) for v in value):
        return [v for v in value if v.strip()]
    raise ValueError(f'{field} must be a string or array of strings')


def chord(raw):
    raw = raw.strip()
    if raw == '+':
        parts = ['+']
    elif raw.endswith('++'):
        parts = raw[:-2].split('+') + ['+']
    else:
        parts = raw.split('+')
    mods, key = set(), None
    for part in parts:
        token = part.strip()
        lower = token.lower()
        if lower in MODIFIERS:
            mods.add(MODIFIERS[lower])
        elif key is None and token:
            if len(token) == 1:
                if token.isascii() and token.isupper():
                    mods.add('shift')
                    token = token.lower()
                key = token
            elif lower in KEYS:
                key = KEYS[lower]
            elif lower.startswith('f') and lower[1:].isdigit() and 1 <= int(lower[1:]) <= 24:
                key = lower
            else:
                raise ValueError(f'Unsupported key {raw!r}')
        else:
            raise ValueError(f'Invalid key {raw!r}')
    if key is None:
        raise ValueError(f'Missing key in {raw!r}')
    return '-'.join([*(m for m in ('ctrl', 'alt', 'shift', 'cmd') if m in mods), key])


def expand(raw, indexed=False):
    prefixed = raw.strip().startswith('prefix+')
    body = raw.strip()[7:] if prefixed else raw.strip()
    if '1..9' in body:
        if not indexed:
            raise ValueError(f'Range only allowed for indexed action: {raw!r}')
        parts = body.split('+')
        if parts.count('1..9') != 1:
            raise ValueError(f'Invalid range: {raw!r}')
        return [(prefixed, chord('+'.join(str(i) if p == '1..9' else p for p in parts)), i) for i in range(1, 10)]
    key = chord(body)
    digit = key.rsplit('-', 1)[-1]
    index = int(digit) if indexed and len(digit) == 1 and digit in '123456789' else None
    if indexed and index is None:
        raise ValueError(f'Indexed action requires a digit: {raw!r}')
    return [(prefixed, key, index)]


def discover_config(explicit=None):
    if explicit is not None:
        path = Path(explicit).expanduser()
        if not path.is_file():
            raise FileNotFoundError(f'Legacy config not found: {path}')
        return path
    candidates = [Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'herdr/config.toml']
    if os.environ.get('APPDATA'):
        candidates.append(Path(os.environ['APPDATA']) / 'herdr/config.toml')
    found = list(dict.fromkeys(p.resolve() for p in candidates if p.is_file()))
    if len(found) > 1:
        raise ValueError('Ambiguous legacy config; specify --legacy-config: ' + ', '.join(map(str, found)))
    return found[0] if found else None


def compile_profile(defaults, config_path=None, validate_local_dependencies=True, commands_override=None):
    if set(defaults) != {'prefix', *ACTIONS, *NAV}:
        raise ValueError('Invalid legacy defaults table')
    config = {}
    if config_path:
        with Path(config_path).open('rb') as stream:
            config = tomllib.load(stream)
    ui = config.get('ui', {})
    if not isinstance(ui, dict):
        raise ValueError('Legacy ui must be a TOML table')
    options = {'confirm_close': True, 'prompt_new_tab_name': True, 'prompt_new_workspace_name': False}
    for name in options:
        if name in ui:
            if not isinstance(ui[name], bool):
                raise ValueError(f'ui.{name} must be a boolean')
            options[name] = ui[name]
    user = config.get('keys', {})
    if not isinstance(user, dict):
        raise ValueError('Legacy keys must be a TOML table')
    unknown = set(user) - set(defaults) - {'indexed', 'command'}
    if unknown:
        raise ValueError('Unsupported legacy key fields: ' + ', '.join(sorted(unknown)))
    prefixes = list(dict.fromkeys(chord(v) for v in values(user.get('prefix', defaults['prefix']), 'keys.prefix')))
    if not prefixes:
        raise ValueError('keys.prefix must contain at least one valid key')
    indexed = user.get('indexed', {})
    if not isinstance(indexed, dict) or set(indexed) - set(INDEXED.values()):
        raise ValueError('Invalid keys.indexed table')
    commands = user.get('command', []) if commands_override is None else commands_override
    if not isinstance(commands, list):
        raise ValueError('keys.command must be an array of tables')
    layout, navigation = {}, {}
    occupied = {(False, p) for p in prefixes}
    nav_occupied = set(prefixes) | {'escape', 'enter', 'tab', 'shift-tab', 'left', 'right'} | set('123456789')

    def register(field, value, action, nav=False, is_indexed=False):
        for raw in values(value, 'keys.' + field):
            for prefixed, key, index in expand(raw, is_indexed):
                if nav:
                    if prefixed or key in nav_occupied:
                        continue
                    nav_occupied.add(key)
                    navigation[key] = action
                    continue
                if (prefixed, key) in occupied or (prefixed and key in prefixes):
                    continue
                # The original rejects direct printable keys to protect terminal input.
                if not prefixed and len(key) == 1 and key.isprintable():
                    continue
                occupied.add((prefixed, key))
                resolved = action + ':' + str(index) if index is not None else action
                for binding in ([p + ' ' + key for p in prefixes] if prefixed else [key]):
                    layout[binding] = resolved

    for source in ('user', 'default'):
        for field, action in NAV.items():
            if (field in user) == (source == 'user'):
                register(field, user.get(field, defaults[field]), action, nav=True)
        for field in ORDER:
            if (field in user) != (source == 'user'):
                continue
            if source == 'default' and field in INDEXED and indexed.get(INDEXED[field], ''):
                continue
            register(field, user.get(field, defaults[field]), ACTIONS[field], is_indexed=field in INDEXED)
        if source == 'user':
            for field, legacy in INDEXED.items():
                modifier = indexed.get(legacy, '')
                if not isinstance(modifier, str):
                    raise ValueError(f'keys.indexed.{legacy} must be a string')
                if modifier.strip():
                    register('indexed.' + legacy, modifier + '+1..9', ACTIONS[field], is_indexed=True)
            for number, command in enumerate(commands):
                if not isinstance(command, dict) or not isinstance(command.get('command'), str) or not command['command'].strip():
                    raise ValueError(f'Invalid keys.command[{number}]')
                typ = command.get('type', 'shell')
                text = command['command']
                if typ == 'plugin_action':
                    if text not in SUPPORTED_PLUGINS:
                        raise ValueError(f'Unsupported legacy plugin action: {text}')
                    action = 'legacy.plugin:' + text
                elif typ in ('shell', 'pane', 'popup'):
                    words = shlex.split(text, posix=os.name != 'nt')
                    if typ == 'shell' and len(words) == 1 and Path(words[0]).name == 'herdr-scifi-grid':
                        action = 'legacy.plugin:scifi-grid'
                    else:
                        if not words or (validate_local_dependencies and os.path.isabs(words[0]) and (not Path(words[0]).is_file() or not os.access(words[0], os.X_OK))):
                            raise FileNotFoundError(f'Missing legacy command dependency: {words[0] if words else text}')
                        request = {'action': 'shell', 'command': text, 'type': typ}
                        if typ == 'popup':
                            request.update({name: command[name] for name in ('width', 'height') if name in command})
                        encoded = base64.urlsafe_b64encode(json.dumps(request, separators=(',', ':')).encode()).decode().rstrip('=')
                        action = 'legacy.plugin:custom:' + encoded
                else:
                    raise ValueError(f'Unsupported legacy custom command type: {typ}')
                register(f'command[{number}].key', command.get('key', ''), action)
    for prefix in prefixes:
        layout[prefix + ' escape'] = 'legacy.prefix_cancel'
        for repeated in prefixes:
            layout[prefix + ' ' + repeated] = 'legacy.prefix_repeat'
    return {'layout:rowan-terminal': layout, 'mod:rowan-navigate': navigation}, {'prefix': prefixes, 'navigate': navigation, 'ui': options}
