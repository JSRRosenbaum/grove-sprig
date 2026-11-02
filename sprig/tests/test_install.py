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
        shutil.copytree(SOURCE.parent / 'defaults', self.root / 'defaults')
        self.app = self.root / 'alternate-app'
        self.agent = self.root / 'alternate-agent'
        self.patcher = patch.object(installer, 'ROOT', self.source)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        self.counter = 0

    def install(self):
        self.counter += 1
        installer.install(self.app, self.agent, self.root / f'backup-{self.counter}')

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
        self.assertEqual(keys['global'], original['global'])
        self.assertEqual(keys['layout:rowan-terminal']['custom'], 'mine')
        self.assertEqual(keys['layout:rowan-terminal']['ctrl-space'], 'rowan-spaces.prefix-cancel')
        for name in preserved:
            self.assertEqual((self.app / name).read_bytes(), b'personal bytes')
        self.assertEqual((self.agent / 'extensions/personal.ts').read_bytes(), b'personal extension')
        self.assertTrue((self.agent / 'extensions/rowan-omp-display.ts').is_file())
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

    def test_fresh_install_retains_platform_shortcuts(self):
        self.install()
        default_name = 'keys.macos.json' if sys.platform == 'darwin' else 'keys.json'
        defaults = json.loads((self.root / 'defaults' / default_name).read_text())
        installed = json.loads((self.app / 'keys.json').read_text())
        for scope, bindings in defaults.items():
            self.assertEqual(installed[scope], bindings)

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

    def test_removed_overlay_bindings_preserve_personal_edits(self):
        overlay = self.source / 'rowan-keys.json'
        bindings = json.loads(overlay.read_text())
        bindings['layout:rowan-terminal'].update({'obsolete': 'old-action', 'personal': 'old-action'})
        overlay.write_text(json.dumps(bindings))
        self.install()
        keys_path = self.app / 'keys.json'
        keys = json.loads(keys_path.read_text())
        keys['layout:rowan-terminal']['personal'] = 'my-action'
        keys_path.write_text(json.dumps(keys))
        del bindings['layout:rowan-terminal']['obsolete']
        del bindings['layout:rowan-terminal']['personal']
        overlay.write_text(json.dumps(bindings))
        self.install()
        installed = json.loads(keys_path.read_text())['layout:rowan-terminal']
        self.assertNotIn('obsolete', installed)
        self.assertEqual(installed['personal'], 'my-action')

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
        subprocess.run([sys.executable, str(SOURCE / 'install.py'), '--app-home', str(app), '--agent-home', str(agent), '--backup-home', str(self.root / 'cli-backup')], env=env, check=True, capture_output=True)
        defaults_name = 'keys.macos.json' if sys.platform == 'darwin' else 'keys.json'
        defaults = json.loads((SOURCE.parent / 'defaults' / defaults_name).read_text())
        self.assertEqual(json.loads((app / 'keys.json').read_text())['global'], defaults['global'])
        self.assertFalse((self.root / 'env-app').exists())
        subprocess.run([sys.executable, str(SOURCE / 'install.py'), '--backup-home', str(self.root / 'env-backup')], env=env, check=True, capture_output=True)
        self.assertEqual(json.loads((self.root / 'env-app/keys.json').read_text())['global'], defaults['global'])


if __name__ == '__main__':
    unittest.main()
