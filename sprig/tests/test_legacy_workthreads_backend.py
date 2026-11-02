import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

RUNTIME = Path(__file__).resolve().parents[1] / 'plugin_runtimes/workthreads'
sys.path.insert(0, str(RUNTIME))
backend = importlib.import_module('herdr_workthreads.herdr')


class BackendTests(unittest.TestCase):
    @patch.dict(os.environ, {'SPRIG_APP': '/app', 'SPRIG_WINDOW': '3'})
    def test_focus_uses_selected_window(self):
        results = [subprocess.CompletedProcess([], 0, '{"spaces":[{"id":"s2","machine":null}]}', ''),
                   subprocess.CompletedProcess([], 0, '{}', '')]
        with patch.object(backend.subprocess, 'run', side_effect=results) as run:
            backend.focus_workspace('s2')
        command = run.call_args.args[0]
        self.assertEqual(command[:5], ['/app', '--window', '3', 'do', 'space.select'])
        self.assertEqual(json.loads(command[5]), {'id': 's2'})

    @patch.dict(os.environ, {'SPRIG_APP': '/app', 'SPRIG_WINDOW': '3'})
    def test_app_errors_are_not_hidden(self):
        result = subprocess.CompletedProcess([], 1, '{"error":"offline"}', '')
        with patch.object(backend.subprocess, 'run', return_value=result):
            with self.assertRaises(backend.HerdrError):
                backend.focus_workspace('s2')

    @patch.dict(os.environ, {'SPRIG_APP': '/app', 'SPRIG_WINDOW': '3'})
    def test_busy_panes_keep_identity(self):
        world = {'spaces': [{'id': 's', 'folder': '/repo', 'machine': None,
                            'tabs': [{'terminals': [{'pane': 'p', 'terminal': 't1', 'app': 'agent', 'status': 'working'}]}]}]}
        results = [subprocess.CompletedProcess([], 0, json.dumps(world), ''),
                   subprocess.CompletedProcess([], 0, json.dumps({'cwd': '/old', 'foreground': {'cwd': '/live'}}), '')]
        with patch.object(backend.subprocess, 'run', side_effect=results):
            pane = backend.busy_panes('s')[0]
        self.assertEqual((pane['pane_id'], pane['agent'], pane['cwd']), ('p', 'agent', '/live'))
