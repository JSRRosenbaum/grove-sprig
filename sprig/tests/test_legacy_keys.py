import base64
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('legacy_keys_test', SOURCE / 'legacy_keys.py')
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)
DEFAULTS = json.loads((SOURCE / 'rowan-keys.json').read_text())


class LegacyKeysTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.config = self.root / 'config.toml'

    def compile(self, text):
        self.config.write_text(text)
        return legacy.compile_profile(DEFAULTS, self.config)

    def test_overrides_collisions_and_plugin_meaning(self):
        sections, metadata = self.compile('''[keys]
prefix = "ctrl+space"
close_workspace = "prefix+shift+k"
remote_image_paste = "alt+v"
[[keys.command]]
key = "prefix+o"
type = "plugin_action"
command = "annotate.open"
''')
        keys = sections['layout:rowan-terminal']
        self.assertEqual(metadata['ui'], {'confirm_close': True, 'prompt_new_tab_name': True, 'prompt_new_workspace_name': False})
        self.assertEqual(metadata['prefix'], ['ctrl-space'])
        self.assertEqual(keys['ctrl-space shift-k'], 'rowan-spaces.active:space.close')
        self.assertEqual(keys['ctrl-space o'], 'legacy.plugin:annotate.open')
        self.assertEqual(keys['alt-v'], 'terminal.paste_image')
        self.assertNotIn('ctrl-v', keys)
        self.assertNotIn('ctrl-1', keys)
        self.assertEqual(keys['ctrl-space ctrl-space'], 'legacy.prefix_repeat')
        self.assertEqual(keys['ctrl-space escape'], 'legacy.prefix_cancel')

    def test_prefix_arrays_ranges_and_indexed_legacy(self):
        sections, metadata = self.compile('''[keys]
prefix = ["ctrl+space", "ctrl+b"]
switch_tab = "prefix+alt+1..9"
[keys.indexed]
workspaces = "ctrl+alt"
''')
        keys = sections['layout:rowan-terminal']
        self.assertEqual(metadata['prefix'], ['ctrl-space', 'ctrl-b'])
        self.assertEqual(keys['ctrl-space alt-9'], 'rowan-spaces.active:tab.select:9')
        self.assertEqual(keys['ctrl-b alt-1'], 'rowan-spaces.active:tab.select:1')
        self.assertEqual(keys['ctrl-alt-9'], 'space.select:9')
        self.assertEqual(keys['ctrl-space ctrl-b'], 'legacy.prefix_repeat')
        self.assertEqual(sections['mod:rowan-navigate']['up'], 'rowan-navigate.workspace-up')

    def test_user_fields_before_commands_before_defaults(self):
        keys = self.compile('''[keys]
help = "prefix+o"
close_workspace = "prefix+shift+k"
[[keys.command]]
key = "prefix+o"
type = "plugin_action"
command = "annotate.open"
''')[0]['layout:rowan-terminal']
        self.assertEqual(keys['ctrl-b o'], 'mod.open:rowan-help')
        self.assertEqual(keys['ctrl-b shift-k'], 'rowan-spaces.active:space.close')
        self.assertNotIn('ctrl-b shift-k', [k for k, v in keys.items() if v == 'rowan-spaces.active:pane.swap:up'])
    def test_ash_tmux_style_overrides_and_ui(self):
        sections, metadata = self.compile('''[keys]
prefix = "ctrl+space"
focus_pane_left = "ctrl+alt+left"
previous_workspace = ["prefix+shift+p", "alt+up"]
resize_mode = ["prefix+ctrl+left", "prefix+ctrl+right"]
switch_tab = ["prefix+1..9", "alt+1..9"]
[ui]
confirm_close = false
prompt_new_tab_name = false
''')
        keys = sections['layout:rowan-terminal']
        self.assertEqual(keys['ctrl-alt-left'], 'rowan-spaces.active:pane.go:left')
        self.assertEqual(keys['alt-up'], 'rowan-spaces.workspace-prev')
        self.assertEqual(keys['ctrl-space ctrl-left'], 'pane.resize_mode')
        self.assertEqual(keys['ctrl-space 9'], 'rowan-spaces.active:tab.select:9')
        self.assertEqual(keys['alt-9'], 'rowan-spaces.active:tab.select:9')
        self.assertEqual(metadata['ui'], {'confirm_close': False, 'prompt_new_tab_name': False, 'prompt_new_workspace_name': False})


    def test_invalid_and_unsupported_inputs_are_errors(self):
        for text in ('[keys]\nprefix = "hyper+b"', '[keys]\nnew_tab = "invalid-key"',
                     '[keys]\nnew_tab = "prefix+1..9"', '[keys]\nunknown = "ctrl+x"',
                     '[[keys.command]]\nkey = "prefix+x"\ntype = "plugin_action"\ncommand = "missing.action"',
                     '[[keys.command]]\nkey = "prefix+x"\ntype = "unsupported"\ncommand = "test"'):
            with self.subTest(text=text), self.assertRaises(ValueError):
                self.compile(text)
        with self.assertRaises(FileNotFoundError):
            self.compile('[[keys.command]]\nkey = "prefix+x"\ntype = "shell"\ncommand = "/missing/legacy-command"')

    def test_custom_pane_popup_payload(self):
        for typ in ('pane', 'popup'):
            text = f'[[keys.command]]\nkey = "prefix+u"\ntype = "{typ}"\ncommand = "printf hello"\nwidth = "80%"\nheight = 12\n'
            action = self.compile(text)[0]['layout:rowan-terminal']['ctrl-b u']
            encoded = action.removeprefix('legacy.plugin:custom:')
            payload = json.loads(base64.urlsafe_b64decode(encoded + '=' * (-len(encoded) % 4)))
            expected = {'action': 'shell', 'type': typ, 'command': 'printf hello'}
            if typ == 'popup':
                expected.update(width='80%', height=12)
            self.assertEqual(payload, expected)

    def test_ported_scifi_grid_and_missing_other_commands(self):
        config = '[[keys.command]]\nkey = "prefix+u"\ntype = "shell"\ncommand = "{}"\n'
        keys = self.compile(config.format('/retired/herdr-scifi-grid'))[0]['layout:rowan-terminal']
        self.assertEqual(keys['ctrl-b u'], 'legacy.plugin:scifi-grid')
        with self.assertRaises(FileNotFoundError):
            self.compile(config.format('/retired/herdr-scifi-grid --other'))
        with self.assertRaises(FileNotFoundError):
            self.compile(config.format('/retired/not-herdr-scifi-grid'))

    def test_discovery_requires_unambiguous_config(self):
        xdg = self.root / 'xdg/herdr/config.toml'
        appdata = self.root / 'appdata/herdr/config.toml'
        for path in (xdg, appdata):
            path.parent.mkdir(parents=True)
            path.write_text('')
        with patch.dict(os.environ, {'XDG_CONFIG_HOME': str(xdg.parent.parent), 'APPDATA': str(appdata.parent.parent)}):
            with self.assertRaisesRegex(ValueError, 'Ambiguous'):
                legacy.discover_config()
            self.assertEqual(legacy.discover_config(xdg), xdg)


if __name__ == '__main__':
    unittest.main()
