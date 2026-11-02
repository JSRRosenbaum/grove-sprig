import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('legacy_plugins', Path(__file__).parents[1] / 'legacy_plugins.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class AnnotationBridgeTests(unittest.TestCase):
    def test_binary_uses_data_directory_and_explicit_override(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            default = root / 'sprig' / 'bin' / ('herdr-annotate.exe' if os.name == 'nt' else 'herdr-annotate')
            default.parent.mkdir(parents=True)
            default.touch()
            override = root / 'custom-annotate'
            override.touch()
            with patch.dict(os.environ, {'XDG_DATA_HOME': tmp, 'LOCALAPPDATA': tmp}, clear=True):
                self.assertEqual(bridge.binary(), default)
                with patch.dict(os.environ, {'SPRIG_ANNOTATE_BIN': str(override)}):
                    self.assertEqual(bridge.binary(), override)
                with patch.dict(os.environ, {'SPRIG_ANNOTATE_BIN': str(root / 'missing')}):
                    with self.assertRaisesRegex(RuntimeError, 'Sprig annotation runtime not installed'):
                        bridge.binary()

    def test_markdown_preserves_long_fences_and_sources(self):
        record = {'selectedText': 'code ``` block', 'comment': 'fix this',
                  'context': {'workspace_label': 'repo', 'tab_label': 'agent'}}
        self.assertEqual(bridge.format_annotations([record]),
                         '# Annotated context\n\n## Annotation 1\n\nSource: repo / agent\n\nSelected text:\n\n````\ncode ``` block\n````\n\nComment:\n\nfix this\n')

    def test_capture_uses_clipboard_if_selection_blank(self):
        with patch.object(bridge, 'binary', return_value=Path('/native/annotate')):
            result = bridge.dispatch({'local': True, 'action': 'annotate.capture', 'pane': 'p1',
                                      'selection': '  ', 'clipboard': 'copied'})
        self.assertEqual(json.loads(result['launch']['argv'][-1])['selected_text'], 'copied')
        self.assertEqual((result['launch']['placement'], result['launch']['width'],
                          result['launch']['height']), ('popup', 88, 24))

    def test_read_store_newest_first_and_busy_lock(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {'XDG_STATE_HOME': tmp}):
            directory = bridge.state_dir()
            directory.mkdir(parents=True)
            records = [{'selectedText': text, 'capturedAt': 'now', 'context': {},
                        'id': text, 'comment': 'comment', 'createdAt': 'now'} for text in ('first', 'second')]
            (directory / 'annotations.jsonl').write_text(''.join(json.dumps(x) + '\n' for x in records))
            self.assertEqual(bridge.read_annotations(), records[::-1])
            (directory / '.annotations.lock').mkdir()
            with self.assertRaisesRegex(RuntimeError, 'busy'):
                bridge.read_annotations()

    def test_remote_rejected_without_touching_store(self):
        with self.assertRaisesRegex(RuntimeError, 'machine and core'):
            bridge.dispatch({'local': False, 'machine': 'remote', 'action': 'annotate.copy-context'})

    def test_remote_copy_uses_selected_machine(self):
        result = unittest.mock.Mock(returncode=0, stdout='{"ok":true,"clipboard":"remote"}', stderr='')
        with patch.object(bridge.subprocess, 'run', return_value=result) as run:
            response = bridge.dispatch({'local': False, 'machine': 'nix', 'core': 'hc',
                                        'action': 'annotate.copy-context'})
        self.assertEqual(response['clipboard'], 'remote')
        self.assertEqual(run.call_args.args[0][:4], ['hc', 'exec', '--on', 'nix'])

    def test_inconsistent_ownership_fails(self):
        with self.assertRaisesRegex(RuntimeError, 'inconsistent'):
            bridge.dispatch({'local': True, 'machine': 'nix', 'action': 'annotate.copy-context'})

    def test_grid_preserves_original_tree_and_modes(self):
        result = bridge.dispatch({'local': True, 'pane': 'p1', 'action': 'scifi-grid'})
        plan = result['split_plan']
        self.assertEqual(plan['pane'], 'p1')
        self.assertEqual([(s['id'], s['from'], s['direction'], s['argv'][-1]) for s in plan['steps']], [
            ('right', 'root', 'right', 'radar'), ('lower_left', 'root', 'down', 'tunnel'),
            ('lower_right', 'right', 'down', 'scan'), ('upper_middle', 'root', 'right', 'spectrum'),
            ('lower_middle', 'lower_left', 'right', 'packet'), ('upper_far_right', 'right', 'right', 'orbit'),
            ('lower_far_right', 'lower_right', 'right', 'cpu'), ('left_mid', 'root', 'down', 'matrix'),
            ('mid_mid', 'upper_middle', 'down', 'wave'), ('right_mid', 'right', 'down', 'pulse')])

    def test_custom_shell_runs_on_source_cwd(self):
        with tempfile.TemporaryDirectory() as cwd, patch.object(bridge.subprocess, 'Popen') as popen:
            result = bridge.dispatch({'local': True, 'action': 'shell', 'type': 'shell',
                                      'command': 'echo hi', 'cwd': cwd})
        self.assertTrue(result['ok'])
        self.assertEqual(popen.call_args.kwargs['cwd'], cwd)
        self.assertTrue(popen.call_args.kwargs['start_new_session'])

    def test_popup_and_pane_preserve_placement(self):
        base = {'local': True, 'action': 'shell', 'command': 'echo hi', 'pane': 'p1', 'cwd': '/tmp'}
        popup = bridge.dispatch({**base, 'type': 'popup', 'width': '80%', 'height': 24})['launch']
        pane = bridge.dispatch({**base, 'type': 'pane'})['launch']
        self.assertEqual((popup['placement'], popup['width'], popup['height']), ('popup', '80%', 24))
        self.assertEqual((pane['placement'], pane['zoom']), ('pane', True))

    def test_missing_absolute_custom_command_is_visible(self):
        with tempfile.TemporaryDirectory() as cwd:
            with self.assertRaisesRegex(RuntimeError, 'does not exist'):
                bridge.dispatch({'local': True, 'action': 'shell', 'type': 'shell',
                                 'command': str(Path(cwd) / 'missing'), 'cwd': cwd})

    def test_unknown_action_never_reports_success(self):
        with self.assertRaisesRegex(RuntimeError, 'was not run'):
            bridge.dispatch({'local': True, 'action': 'unknown.action'})
