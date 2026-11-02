import importlib.util
import json
from pathlib import Path
import subprocess
import threading
import unittest
from unittest.mock import Mock, patch

SCRIPT = Path(__file__).resolve().parents[1] / 'legacy_worktrees.py'
spec = importlib.util.spec_from_file_location('legacy_worktrees', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class WorktreeTests(unittest.TestCase):
    def request(self, action):
        return {'action': action, 'local': True, 'pane': 'p1', 'space': 's1',
                'cwd': '/repo', 'app': '/app', 'window': 2}

    def test_popup_keeps_action_and_source_pane(self):
        response = module.dispatch(self.request('workthreads.menu'))
        request = json.loads(response['popup']['argv'][-1])
        self.assertEqual(request['pane'], 'p1')
        self.assertEqual(request['action'], 'workthreads.menu')

    def test_remote_requires_machine(self):
        request = self.request('worktrunk.open')
        request['local'] = False
        with self.assertRaisesRegex(RuntimeError, 'no source machine'):
            module.dispatch(request)

    def test_remote_picker_retains_source_machine(self):
        request = self.request('worktrunk.open')
        request.update(local=False, machine='remote')
        with patch.object(module, 'worktrunk_config', return_value={}), patch.object(module, 'start_picker_bridge', return_value=['sh', '-c', 'remote-helper']) as bridge:
            launch = module.dispatch(request)['launch']
        self.assertEqual(launch['direction'], 'down')
        self.assertEqual(launch['argv'], ['sh', '-c', 'remote-helper'])
        bridge.assert_called_once_with(request)

    def test_worktrunk_popup_placement_and_size(self):
        with patch.object(module, 'worktrunk_config', return_value={'picker_placement': 'popup', 'popup_width': '90%', 'popup_height': 24}):
            popup = module.dispatch(self.request('worktrunk.open'))['popup']
        self.assertEqual((popup['width'], popup['height']), ('90%', 24))

    def test_source_environment_clears_frontend_session_and_socket(self):
        default = module.source_environment(None)
        self.assertEqual(default, 'env -u HC_SESSION -u HC_SOCKET -u HC_TERMINAL_ID')
        named = module.source_environment('special session')
        self.assertTrue(named.startswith(default + ' '))
        self.assertIn("'HC_SESSION=special session'", named)

    def test_remote_board_requires_core_and_carries_machine(self):
        request = self.request('workthreads.menu')
        request.update(local=False, machine='rowan', core='/hc')
        popup = module.dispatch(request)['popup']
        self.assertEqual(json.loads(popup['argv'][-1])['machine'], 'rowan')

    def test_rpc_is_limited_to_workspace_operations(self):
        self.assertTrue(module.valid_rpc(['workspace', 'create', '--cwd', '/repo', '--label', 'thread', '--no-focus']))
        self.assertTrue(module.valid_rpc(['worktree', 'open', '--cwd', '/repo', '--path', '/tree', '--label', 't', '--focus']))
        self.assertFalse(module.valid_rpc(['workspace', 'create', '--cwd', '/repo', '--argv', 'rm', '--focus']))
        self.assertFalse(module.valid_rpc(['shell', 'exec', 'anything']))

    def test_default_and_current_base_are_distinct(self):
        for action, expected in [('worktrunk.open', False), ('worktrunk.open-current', True)]:
            calls = []
            def fake_run(args, cwd=None, check=True):
                calls.append(args)
                if '--version' in args:
                    return subprocess.CompletedProcess(args, 0, 'worktrunk 0.79', '')
                if 'for-each-ref' in args:
                    return subprocess.CompletedProcess(args, 0, '', '')
                if 'list' in args:
                    return subprocess.CompletedProcess(args, 0, '[]', '')
                if 'show-ref' in args:
                    return subprocess.CompletedProcess(args, 1, '', '')
                if 'switch' in args:
                    return subprocess.CompletedProcess(args, 0, '{"path":"/new", "branch":"new"}', '')
                raise AssertionError(args)
            with self.subTest(action=action), patch.object(module.shutil, 'which', side_effect=lambda name: '/wt' if name == 'wt' else None), patch.object(module, 'run', side_effect=fake_run), patch('builtins.input', return_value='new'), patch.object(module, 'app', side_effect=[{'spaces': []}, {}]):
                module.worktrunk(self.request(action))
            switch = next(call for call in calls if 'switch' in call)
            self.assertIn('--create', switch)
            self.assertEqual('--base' in switch, expected)
            if expected:
                self.assertEqual(switch[switch.index('--base') + 1], '@')

    def test_tab_mode_sends_switch_to_new_source_terminal(self):
        calls = []
        def fake_run(args, cwd=None, check=True):
            calls.append(args)
            if '--version' in args:
                return subprocess.CompletedProcess(args, 0, 'wt v0.79.0', '')
            if 'for-each-ref' in args:
                return subprocess.CompletedProcess(args, 0, '', '')
            if 'list' in args:
                return subprocess.CompletedProcess(args, 0, '[]', '')
            if 'show-ref' in args:
                return subprocess.CompletedProcess(args, 1, '', '')
            if 'get' in args:
                return subprocess.CompletedProcess(args, 0, '{"argv":["/bin/bash"]}', '')
            if 'send' in args:
                return subprocess.CompletedProcess(args, 0, '', '')
            raise AssertionError(args)
        replies = [{'spaces': [{'id': 's1', 'machine': None}]},
                   {'space': 's1', 'tab': 'tb1', 'terminal': 't1'}]
        with patch.object(module.Path, 'exists', return_value=True), patch.object(module.Path, 'read_text', return_value='open_mode = "tab"'), patch.object(module.shutil, 'which', side_effect=lambda name: '/wt' if name == 'wt' else None), patch.object(module, 'run', side_effect=fake_run), patch('builtins.input', return_value='feature/foo'), patch.object(module, 'app', side_effect=replies) as app:
            module.worktrunk(self.request('worktrunk.open-current'))
        self.assertEqual(app.call_args_list[1].args[1:], ('tab.new', {'name': 'feature/foo', 'space': 's1', 'folder': '/repo'}))
        self.assertIn(['hc', 'send', 't1', 'wt switch --create feature/foo --base @'], calls)
        self.assertFalse(any('switch' in call for call in calls))

    def test_interrupted_picker_terminates_child(self):
        child = Mock()
        child.communicate.side_effect = RuntimeError('bridge disconnected')
        child.poll.return_value = None
        with patch.object(module.subprocess, 'Popen', return_value=child):
            with self.assertRaisesRegex(RuntimeError, 'bridge disconnected'):
                module.run_process(['fzf'], input='branch')
        child.terminate.assert_called_once()
        child.wait.assert_called_once()

    def test_disconnect_while_picker_waits_never_switches(self):
        calls = []
        def fake_run(args, cwd=None, check=True):
            calls.append(args)
            if '--version' in args:
                return subprocess.CompletedProcess(args, 0, 'wt v0.79.0', '')
            if 'for-each-ref' in args:
                return subprocess.CompletedProcess(args, 0, '', '')
            if 'list' in args:
                return subprocess.CompletedProcess(args, 0, '[]', '')
            raise AssertionError(args)
        with patch.object(module, '_picker_lost', threading.Event()), patch.object(module, '_picker_waiting', threading.Event()), patch.object(module, 'worktrunk_config', return_value={}), patch.object(module.shutil, 'which', side_effect=lambda name: '/wt' if name == 'wt' else '/fzf'), patch.object(module, 'run', side_effect=fake_run), patch.object(module, 'run_process', side_effect=RuntimeError('Worktrunk window bridge disconnected')), patch.object(module, 'app') as app:
            with self.assertRaisesRegex(RuntimeError, 'bridge disconnected'):
                module.worktrunk(self.request('worktrunk.open-current'))
        self.assertFalse(any('switch' in call for call in calls))
        app.assert_not_called()

    def test_disconnected_bridge_blocks_switch_after_selection(self):
        calls = []
        def fake_run(args, cwd=None, check=True):
            calls.append(args)
            if '--version' in args:
                return subprocess.CompletedProcess(args, 0, 'wt v0.79.0', '')
            if 'for-each-ref' in args:
                return subprocess.CompletedProcess(args, 0, '', '')
            if 'list' in args:
                return subprocess.CompletedProcess(args, 0, '[]', '')
            if 'show-ref' in args:
                return subprocess.CompletedProcess(args, 1, '', '')
            raise AssertionError(args)
        with patch.dict(module.os.environ, {'SPRIG_PICKER_RPC': 'http://127.0.0.1:1/call'}), patch.object(module, '_picker_lost', threading.Event()), patch.object(module, 'worktrunk_config', return_value={}), patch.object(module.shutil, 'which', side_effect=lambda name: '/wt' if name == 'wt' else None), patch.object(module, 'run', side_effect=fake_run), patch.object(module, 'picker_rpc', side_effect=OSError('lost')), patch('builtins.input', return_value='new'), patch.object(module, 'app') as app:
            with self.assertRaisesRegex(RuntimeError, 'bridge disconnected'):
                module.worktrunk(self.request('worktrunk.open-current'))
        self.assertFalse(any('switch' in call for call in calls))
        app.assert_not_called()

    def test_rejects_windows_terminal_alias(self):
        with patch.object(module.shutil, 'which', return_value='wt.exe'), patch.object(module, 'run', return_value=subprocess.CompletedProcess([], 0, 'Windows Terminal', '')):
            with self.assertRaisesRegex(RuntimeError, 'not the Worktrunk'):
                module.worktrunk(self.request('worktrunk.open'))
