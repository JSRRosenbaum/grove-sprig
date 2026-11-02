import importlib.util
import errno
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('sprig_install', SOURCE / 'install.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


def snapshot(root):
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob('*') if p.is_file()} if root.exists() else {}


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        shutil.copytree(SOURCE / 'mods', self.source / 'mods')
        shutil.copytree(SOURCE / 'layouts', self.source / 'layouts')
        shutil.copytree(SOURCE / 'themes', self.source / 'themes')
        shutil.copytree(SOURCE / 'extensions', self.source / 'extensions')
        shutil.copy2(SOURCE / 'rowan-keys.json', self.source / 'rowan-keys.json')
        shutil.copy2(SOURCE / 'legacy_plugins.py', self.source / 'legacy_plugins.py')
        shutil.copy2(SOURCE / 'legacy_worktrees.py', self.source / 'legacy_worktrees.py')
        shutil.copy2(SOURCE / 'legacy_scifi_panel.py', self.source / 'legacy_scifi_panel.py')
        shutil.copy2(SOURCE / 'legacy_review.py', self.source / 'legacy_review.py')
        shutil.copytree(SOURCE / 'plugin_runtimes', self.source / 'plugin_runtimes')
        self.config = self.root / 'legacy.toml'
        self.config.write_text('[keys]\nprefix = "ctrl+space"\n')
        shutil.copytree(SOURCE.parent / 'defaults', self.root / 'defaults')
        self.app = self.root / 'alternate-app'
        self.agent = self.root / 'alternate-agent'
        self.patcher = patch.object(installer, 'ROOT', self.source)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        self.counter = 0

    def install(self):
        self.counter += 1
        installer.install(self.app, self.agent, self.root / f'backup-{self.counter}', self.config)

    def put(self, path, content):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

    def test_preserves_configuration_and_unowned_files(self):
        original = {'global': {'ctrl-x': 'personal'}, 'layout:rowan-terminal': {'custom': 'mine'}}
        self.put(self.app / 'keys.json', json.dumps(original).encode())
        preserved = ['settings.json', 'shared.json', 'data/foo', 'window.json', 'profiles/a.json', 'mods/rowan-spaces/personal.js', 'mods/other/main.js']
        for name in preserved:
            self.put(self.app / name, b'personal bytes')
        self.put(self.agent / 'extensions/personal.ts', b'personal extension')
        self.install()
        keys = json.loads((self.app / 'keys.json').read_bytes())
        self.assertEqual(keys['global'], {})
        self.assertNotIn('custom', keys['layout:rowan-terminal'])
        self.assertEqual(keys['layout:rowan-terminal']['ctrl-space escape'], 'legacy.prefix_cancel')
        self.assertEqual(keys['terminal'], {})
        backups = json.loads((self.root / 'backup-1/manifest.json').read_text())
        key_backup = next(entry['backup'] for entry in backups if entry['path'] == str(self.app / 'keys.json'))
        self.assertEqual(json.loads(Path(key_backup).read_text()), original)
        for name in preserved:
            self.assertEqual((self.app / name).read_bytes(), b'personal bytes')
        self.assertEqual((self.agent / 'extensions/personal.ts').read_bytes(), b'personal extension')
        self.assertTrue((self.agent / 'extensions/rowan-omp-display.ts').is_file())
        self.assertTrue((self.app / 'legacy_worktrees.py').is_file())
        self.assertTrue((self.app / 'legacy_scifi_panel.py').is_file())
        self.assertTrue((self.app / 'legacy_review.py').is_file())
        self.assertTrue((self.app / 'plugin_runtimes/workthreads/LICENSE').is_file())
        self.assertTrue((self.app / 'plugin_runtimes/workthreads/herdr_workthreads/__main__.py').is_file())
        self.assertTrue(os.access(self.app / 'plugin_runtimes/workthreads/herdr_workthreads_cli.py', os.X_OK))
        self.assertFalse((self.app / 'mods/square-dracula-agents').exists())
        self.assertFalse((self.app / 'mods/rowan-agents/consumer.test.cjs').exists())

    def test_invalid_inputs_do_not_mutate_destinations(self):
        self.put(self.app / 'settings.json', b'unchanged')
        self.put(self.agent / 'extensions/mine.ts', b'unchanged')
        mod = self.source / 'mods/rowan-agents/mod.json'
        saved = mod.read_bytes()
        overlay = self.source / 'rowan-keys.json'
        original_overlay = overlay.read_bytes()
        for target, invalid in ((mod, b'{'), (overlay, b'{'), (overlay, b'{"global": {}}'), (self.app / 'keys.json', b'[]')):
            with self.subTest(target=target, invalid=invalid):
                self.put(target, invalid)
                before = snapshot(self.app), snapshot(self.agent)
                with self.assertRaises((ValueError, OSError)):
                    self.install()
                self.assertEqual((snapshot(self.app), snapshot(self.agent)), before)
                mod.write_bytes(saved)
                overlay.write_bytes(original_overlay)
                (self.app / 'keys.json').unlink(missing_ok=True)
        (self.source / 'mods/rowan-picker/main.js').unlink()
        before = snapshot(self.app), snapshot(self.agent)
        with self.assertRaises(FileNotFoundError):
            self.install()
        self.assertEqual((snapshot(self.app), snapshot(self.agent)), before)

    def test_machine_profiles_compose_local_keys_or_use_server_keys(self):
        self.config.write_text('[keys]\nprefix = "ctrl+space"\nremote_image_paste = "alt+v"\n')
        rowan = self.root / 'rowan.toml'
        rowan.write_text('[keys]\nremote_image_paste = "ctrl+v"\n[[keys.command]]\nkey = "prefix+a"\ntype = "plugin_action"\ncommand = "annotate.capture"\n')
        ash = self.root / 'ash.toml'
        ash.write_text('[keys]\nfocus_pane_left = "ctrl+alt+left"\n')
        profiles = [f'Rowan={rowan}', f'Ash={ash}']
        installer.install(self.app, self.agent, self.root / 'machine-backup-1', self.config, profiles)
        metadata = json.loads((self.app / 'legacy-keys.json').read_text())
        rowan_keys = metadata['machines']['Rowan']['bindings']['layout:rowan-terminal']
        ash_keys = metadata['machines']['Ash']['bindings']['layout:rowan-terminal']
        fallback = metadata['remote_default']['bindings']['layout:rowan-terminal']
        self.assertEqual(rowan_keys['alt-v'], 'terminal.paste_image')
        self.assertNotIn('ctrl-v', rowan_keys)
        self.assertEqual(rowan_keys['ctrl-space a'], 'legacy.plugin:annotate.capture')
        self.assertNotIn('ctrl-space a', ash_keys)
        self.assertNotIn('ctrl-space a', fallback)
        installer.install(self.app, self.agent, self.root / 'machine-backup-2', self.config, profiles, 'server')
        metadata = json.loads((self.app / 'legacy-keys.json').read_text())
        ash_keys = metadata['machines']['Ash']['bindings']['layout:rowan-terminal']
        self.assertEqual(ash_keys['ctrl-alt-left'], 'rowan-spaces.active:pane.go:left')
        self.assertEqual(metadata['machines']['Ash']['prefix'], ['ctrl-b'])

    def test_invalid_legacy_config_leaves_existing_install_unchanged(self):
        self.install()
        before = snapshot(self.app), snapshot(self.agent)
        self.config.write_text('[keys]\nnew_tab = "not-a-key"\n')
        with self.assertRaises(ValueError):
            self.install()
        self.assertEqual((snapshot(self.app), snapshot(self.agent)), before)

    def test_failure_restores_bytes_without_further_allocation(self):
        self.install()
        before = snapshot(self.app), snapshot(self.agent)
        (self.source / 'mods/rowan-spaces/main.js').write_bytes(b'updated')
        real_replace = os.replace
        real_temporary = tempfile.NamedTemporaryFile
        replacements = 0
        exhausted = False

        def replace(source, destination):
            nonlocal replacements, exhausted
            if Path(source).name.startswith('.sprig-new-'):
                replacements += 1
                if replacements == 4:
                    exhausted = True
                    raise OSError(errno.ENOSPC, 'disk full')
            return real_replace(source, destination)

        def allocate(*args, **kwargs):
            if exhausted:
                raise OSError(errno.ENOSPC, 'disk remains full')
            return real_temporary(*args, **kwargs)

        with patch.object(os, 'replace', side_effect=replace), patch.object(tempfile, 'NamedTemporaryFile', side_effect=allocate):
            with self.assertRaises(OSError):
                self.install()
        self.assertEqual((snapshot(self.app), snapshot(self.agent)), before)

    def test_fresh_install_replaces_platform_shortcuts(self):
        self.install()
        installed = json.loads((self.app / 'keys.json').read_text())
        self.assertEqual(installed['global'], {})
        self.assertEqual(installed['terminal'], {})
        self.assertNotIn('ctrl-1', installed['layout:rowan-terminal'])

    def test_symlink_ancestor_cannot_overwrite_external_files(self):
        outside = self.root / 'outside'
        self.put(outside / 'main.js', b'outside data')
        (self.app / 'mods').mkdir(parents=True)
        (self.app / 'mods/rowan-spaces').symlink_to(outside, target_is_directory=True)
        before = snapshot(self.app), snapshot(self.agent), snapshot(outside)
        with self.assertRaises(ValueError):
            self.install()
        self.assertEqual((snapshot(self.app), snapshot(self.agent), snapshot(outside)), before)

    def test_symlink_ancestor_cannot_delete_stale_external_files(self):
        asset = self.source / 'mods/rowan-spaces/old.svg'
        asset.write_bytes(b'owned')
        self.install()
        outside = self.root / 'outside'
        shutil.move(self.app / 'mods/rowan-spaces', outside)
        (self.app / 'mods/rowan-spaces').symlink_to(outside, target_is_directory=True)
        asset.unlink()
        before = snapshot(self.app), snapshot(self.agent), snapshot(outside)
        with self.assertRaises(ValueError):
            self.install()
        self.assertEqual((snapshot(self.app), snapshot(self.agent), snapshot(outside)), before)

    def test_update_replaces_legacy_section_without_retaining_modern_keys(self):
        self.install()
        keys_path = self.app / 'keys.json'
        keys = json.loads(keys_path.read_text())
        keys['layout:rowan-terminal']['ctrl-1'] = 'tab.select:1'
        keys_path.write_text(json.dumps(keys))
        self.install()
        installed = json.loads(keys_path.read_text())['layout:rowan-terminal']
        self.assertNotIn('ctrl-1', installed)

    def test_update_removes_only_manifest_owned_stale_files(self):
        asset = self.source / 'mods/rowan-spaces/old.svg'
        asset.write_bytes(b'old asset')
        self.install()
        self.put(self.app / 'mods/rowan-spaces/user.svg', b'user asset')
        self.put(self.app / 'mods/square-dracula-tabs/main.js', b'outdated')
        asset.unlink()
        self.install()
        self.assertFalse((self.app / 'mods/rowan-spaces/old.svg').exists())
        self.assertEqual((self.app / 'mods/rowan-spaces/user.svg').read_bytes(), b'user asset')
        self.assertEqual((self.app / 'mods/square-dracula-tabs/main.js').read_bytes(), (self.source / 'mods/square-dracula-tabs/main.js').read_bytes())
        self.install()
        self.assertEqual((self.app / 'mods/rowan-spaces/user.svg').read_bytes(), b'user asset')

    def test_cli_explicit_roots_and_environment_defaults(self):
        app, agent = self.root / 'cli-app', self.root / 'cli-agent'
        env = dict(os.environ, HERDR_APP_HOME=str(self.root / 'env-app'), PI_CODING_AGENT_DIR=str(self.root / 'env-agent'))
        subprocess.run([sys.executable, str(SOURCE / 'install.py'), '--legacy-config', str(self.config), '--app-home', str(app), '--agent-home', str(agent), '--backup-home', str(self.root / 'cli-backup')], env=env, check=True, capture_output=True)
        self.assertEqual(json.loads((app / 'keys.json').read_text())['global'], {})
        self.assertFalse((self.root / 'env-app').exists())
        subprocess.run([sys.executable, str(SOURCE / 'install.py'), '--legacy-config', str(self.config), '--backup-home', str(self.root / 'env-backup')], env=env, check=True, capture_output=True)
        self.assertEqual(json.loads((self.root / 'env-app/keys.json').read_text())['global'], {})


if __name__ == '__main__':
    unittest.main()
