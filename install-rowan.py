#!/usr/bin/env python3
"""Install the Rowan sidebar without replacing personal settings or shipped mods."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import os
import shutil
import tempfile


def atomic_copy(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(source.read_bytes())
    os.replace(temporary, destination)


def install(app_home, agent_home, backup_home):
    root = Path(__file__).resolve().parent
    for name in ('rowan-spaces', 'rowan-agents', 'rowan-empty', 'rowan-picker'):
        for file in ('main.js', 'mod.json'):
            if not (root / 'mods' / name / file).is_file():
                raise RuntimeError(f'Missing source: mods/{name}/{file}')
    overlay = json.loads((root / 'rowan-keys.json').read_text())
    keys_path = app_home / 'keys.json'
    keys = json.loads(keys_path.read_text()) if keys_path.exists() else {}
    if not isinstance(keys, dict):
        raise RuntimeError('Existing keys.json is not an object; preserving it unchanged')
    for section, bindings in overlay.items():
        if not isinstance(keys.get(section, {}), dict):
            raise RuntimeError(f'Existing key section is not an object: {section}')
        keys.setdefault(section, {}).update(bindings)
    copies = []
    for directory in sorted((root / 'mods').iterdir()):
        if not directory.is_dir():
            continue
        if directory.name.startswith('rowan-') or not (app_home / 'mods' / directory.name).exists():
            copies.extend((file, app_home / file.relative_to(root)) for file in directory.rglob('*')
                          if file.is_file() and not file.name.endswith(('.test.js', '.test.mjs'))
                          and file.suffix in ('.js', '.mjs', '.json', '.svg', '.png'))
    for relative in ('layouts/rowan-terminal.json', 'themes/rowan-terminal.json'):
        source = root / relative
        json.loads(source.read_text())
        copies.append((source, app_home / relative))
    extension_root = root / 'extensions'
    if not extension_root.is_dir() or not any(extension_root.glob('*.ts')):
        raise RuntimeError('OMP companion source is missing; no files installed')
    for source in extension_root.iterdir():
        if source.is_file() and source.suffix in ('.ts', '.js', '.mjs') and '.test.' not in source.name:
            copies.append((source, agent_home / 'extensions' / source.name))
    backup_home.mkdir(parents=True, exist_ok=False)
    manifest = []
    for index, destination in enumerate([keys_path] + [destination for _, destination in copies]):
        old = backup_home / str(index)
        existed = destination.exists()
        if existed:
            shutil.copy2(destination, old)
        manifest.append({'path': str(destination), 'backup': str(old) if existed else None})
    (backup_home / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    for source, destination in copies:
        atomic_copy(source, destination)
    with tempfile.NamedTemporaryFile(mode='w', dir=app_home, delete=False) as handle:
        temporary = Path(handle.name)
        json.dump(keys, handle, indent=2)
        handle.write('\n')
    os.replace(temporary, keys_path)
    print(json.dumps({'app_home': str(app_home), 'agent_home': str(agent_home),
                      'backup': str(backup_home), 'installed_files': len(copies),
                      'settings_preserved': True}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-home', type=Path, default=Path(os.environ.get('HERDR_APP_HOME', Path.home() / '.config/herdr-app')))
    parser.add_argument('--agent-home', type=Path, default=Path.home() / '.omp/agent')
    parser.add_argument('--backup-home', type=Path)
    args = parser.parse_args()
    backup = args.backup_home or Path.home() / '.local/state/herdr-app' / ('rowan-sidebar-backup-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    install(args.app_home, args.agent_home, backup)
