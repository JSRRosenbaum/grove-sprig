#!/usr/bin/env python3
"""Install or update the Rowan layout without replacing personal configuration."""
import argparse
import importlib.util
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import tempfile
import tomllib
import sys


ROOT = Path(__file__).resolve().parent
_compiler_spec = importlib.util.spec_from_file_location('legacy_keys', ROOT / 'legacy_keys.py')
legacy_keys = importlib.util.module_from_spec(_compiler_spec)
_compiler_spec.loader.exec_module(legacy_keys)
MODS = (
    'rowan-spaces', 'rowan-agents', 'rowan-empty', 'rowan-picker',
    'rowan-navigate', 'rowan-goto', 'rowan-help',
    'square-dracula-tabs', 'square-dracula-pane', 'square-dracula-files',
    'square-dracula-changes', 'square-dracula-menu', 'square-dracula-new-menu',
    'square-dracula-worktree',
)
REQUIRED_ASSETS = {
    'square-dracula-pane': ('close.svg', 'split-down.svg', 'split-right.svg', 'unzoom.svg', 'zoom.svg'),
    'square-dracula-files': ('chevron-down.svg', 'chevron-right.svg', 'file.svg', 'folder.svg'),
    'square-dracula-changes': ('changes.svg',),
}
MANIFEST = '.rowan-install-manifest.json'


def json_object(data, description):
    try:
        value = json.loads(data)
    except (ValueError, UnicodeDecodeError) as error:
        raise ValueError(f'Invalid {description}: {error}') from error
    if not isinstance(value, dict):
        raise ValueError(f'{description} must be an object')
    return value


def payload(root):
    """Read and validate the whole payload before touching either destination."""
    files = {}
    for name in MODS:
        directory = root / 'mods' / name
        for required in ('main.js', 'mod.json', *REQUIRED_ASSETS.get(name, ())):
            if not (directory / required).is_file():
                raise FileNotFoundError(f'Missing source: {directory / required}')
        for source in sorted(directory.rglob('*')):
            if not source.is_file() or any(part in ('tests', '__tests__', '__snapshots__') for part in source.relative_to(directory).parts):
                continue
            if (source.name == 'jsconfig.json' or source.name.endswith('.d.ts')
                    or '.test.' in source.name or '.spec.' in source.name
                    or source.suffix not in ('.js', '.mjs', '.json', '.svg', '.png')):
                continue
            data = source.read_bytes()
            if source.suffix == '.json':
                json_object(data, str(source))
            files[('app', source.relative_to(root).as_posix())] = data
    for relative in ('layouts/rowan-terminal.json', 'themes/rowan-terminal.json'):
        data = (root / relative).read_bytes()
        json_object(data, relative)
        files[('app', relative)] = data
    extension = root / 'extensions' / 'rowan-omp-display.ts'
    files[('agent', 'extensions/rowan-omp-display.ts')] = extension.read_bytes()
    for helper in ('legacy_plugins.py', 'legacy_worktrees.py', 'legacy_scifi_panel.py', 'legacy_review.py'):
        files[('app', helper)] = (root / helper).read_bytes()
    runtime = root / 'plugin_runtimes/workthreads'
    for required in ('LICENSE', 'herdr_workthreads_cli.py', 'herdr_workthreads/__main__.py', 'herdr_workthreads/__init__.py'):
        if not (runtime / required).is_file():
            raise FileNotFoundError(f'Missing source: {runtime / required}')
    for source in sorted(runtime.rglob('*')):
        if source.is_file() and (source.suffix == '.py' or source.name == 'LICENSE'
                                 or source.relative_to(runtime).as_posix() == 'skills/herdr-workthreads/SKILL.md'):
            files[('app', source.relative_to(root).as_posix())] = source.read_bytes()
    defaults = json_object((root / 'rowan-keys.json').read_bytes(), 'legacy key defaults')
    return files, defaults


def stage_file(destination, data, prefix, mode=None):
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=prefix, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(data)
        if mode is not None:
            temporary.chmod(mode)
        return temporary
    except Exception:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
        raise


def destination_path(root, relative):
    destination = root / relative
    current = root
    for part in destination.relative_to(root).parts:
        current /= part
        if current.is_symlink():
            raise ValueError(f'Refusing symlink below installation root: {current}')
    if not destination.resolve().is_relative_to(root):
        raise ValueError(f'Destination escapes installation root: {destination}')
    return destination


def owned_path(kind, relative):
    if not isinstance(relative, str):
        raise ValueError('Invalid ownership manifest path')
    path = Path(relative)
    if path.is_absolute() or '..' in path.parts or path.as_posix() != relative:
        raise ValueError('Invalid ownership manifest path')
    if kind == 'app':
        allowed = (len(path.parts) >= 3 and path.parts[0] == 'mods' and path.parts[1] in MODS
                   or relative in ('layouts/rowan-terminal.json', 'themes/rowan-terminal.json',
                                   'legacy_plugins.py', 'legacy_worktrees.py', 'legacy_scifi_panel.py', 'legacy_review.py')
                   or len(path.parts) >= 3 and path.parts[:2] == ('plugin_runtimes', 'workthreads')
                   and (path.suffix == '.py' or path.name == 'LICENSE'
                        or relative == 'plugin_runtimes/workthreads/skills/herdr-workthreads/SKILL.md'))
    else:
        allowed = kind == 'agent' and relative == 'extensions/rowan-omp-display.ts'
    if not allowed:
        raise ValueError('Invalid ownership manifest path')
    return path


def install(app_home, agent_home, backup_home, legacy_config=None, legacy_machine_configs=(), legacy_key_source='local'):
    app_home, agent_home, backup_home = (
        Path(p).expanduser().resolve() for p in (app_home, agent_home, backup_home)
    )
    files, defaults = payload(ROOT)
    config_path = legacy_keys.discover_config(legacy_config)
    overlay, metadata = legacy_keys.compile_profile(defaults, config_path)
    if legacy_key_source not in ('local', 'server'):
        raise ValueError('legacy key source must be local or server')
    remote_bindings, remote_default = legacy_keys.compile_profile(
        defaults, config_path, commands_override=[])
    remote_default['bindings'] = remote_bindings
    metadata['remote_default'] = remote_default
    metadata['key_source'] = legacy_key_source
    metadata['bindings'] = overlay
    metadata['machines'] = {}
    for item in legacy_machine_configs:
        name, separator, source = item.partition('=')
        if not separator or not name.strip() or name != name.strip() or not source or name.lower() == 'local':
            raise ValueError('Expected --legacy-machine-config NAME=PATH (NAME must not be local)')
        if name in metadata['machines']:
            raise ValueError(f'Duplicate legacy machine profile: {name}')
        path = legacy_keys.discover_config(source)
        if legacy_key_source == 'local':
            with path.open('rb') as stream:
                endpoint = tomllib.load(stream)
            endpoint_keys = endpoint.get('keys', {})
            if not isinstance(endpoint_keys, dict):
                raise ValueError(f'Legacy keys for {name} must be a TOML table')
            bindings, machine = legacy_keys.compile_profile(
                defaults, config_path, validate_local_dependencies=False,
                commands_override=endpoint_keys.get('command', []))
        else:
            bindings, machine = legacy_keys.compile_profile(defaults, path, validate_local_dependencies=False)
        machine['bindings'] = bindings
        metadata['machines'][name] = machine
    metadata['machines'] = dict(sorted(metadata['machines'].items()))
    manifest_path = destination_path(app_home, MANIFEST)
    previous, previous_bindings = set(), {}
    if manifest_path.exists():
        manifest = json_object(manifest_path.read_bytes(), 'ownership manifest')
        if manifest.get('version') != 1 or not isinstance(manifest.get('files'), list) or not isinstance(manifest.get('agent_home'), str):
            raise ValueError('Invalid ownership manifest')
        previous_bindings = manifest.get('bindings', {})
        if not isinstance(previous_bindings, dict) or not all(
                isinstance(k, str) and isinstance(v, str) for k, v in previous_bindings.items()):
            raise ValueError('Invalid ownership manifest bindings')
        for entry in manifest['files']:
            if not isinstance(entry, dict) or set(entry) != {'root', 'path'}:
                raise ValueError('Invalid ownership manifest entry')
            kind, relative = entry['root'], entry['path']
            owned_path(kind, relative)
            if kind != 'agent' or manifest['agent_home'] == str(agent_home):
                previous.add((kind, relative))
    keys_path = destination_path(app_home, 'keys.json')
    if keys_path.exists():
        keys = json_object(keys_path.read_bytes(), 'existing keys.json')
    else:
        defaults = 'keys.macos.json' if sys.platform == 'darwin' else 'keys.json'
        keys = json_object((ROOT.parent / 'defaults' / defaults).read_bytes(), 'platform key defaults')
    # The legacy profile owns these scopes. Keeping newer global or terminal
    # shortcuts would intercept keys the old terminal passed to its program.
    # The transaction backs up the complete original keys.json.
    keys['global'] = {}
    keys['terminal'] = {}
    keys.update(overlay)
    current_bindings = overlay['layout:rowan-terminal']
    roots = {'app': app_home, 'agent': agent_home}
    for kind, relative in files:
        owned_path(kind, relative)
    stale = previous - files.keys()
    contents = {
        destination_path(roots[kind], relative): data
        for (kind, relative), data in files.items()
    }
    contents[keys_path] = (json.dumps(keys, indent=2, ensure_ascii=False) + '\n').encode()
    contents[destination_path(app_home, 'legacy-keys.json')] = (
        json.dumps(metadata, indent=2, ensure_ascii=False) + '\n').encode()
    new_manifest = {
        'version': 1, 'agent_home': str(agent_home), 'bindings': current_bindings,
        'files': [{'root': kind, 'path': relative} for kind, relative in sorted(files)],
    }
    contents[manifest_path] = (json.dumps(new_manifest, indent=2) + '\n').encode()
    deletions = {destination_path(roots[kind], relative) for kind, relative in stale}
    destinations = list(contents) + sorted(deletions)
    originals = {
        destination: destination.read_bytes() if destination.exists() else None
        for destination in destinations
    }
    original_modes = {destination: destination.stat().st_mode & 0o777
                      for destination, data in originals.items() if data is not None}
    backup_home.mkdir(mode=0o700, parents=True, exist_ok=False)
    backup_manifest = []
    for index, (destination, data) in enumerate(originals.items()):
        backup = str(index) if data is not None else None
        if backup is not None:
            (backup_home / backup).write_bytes(data)
            (backup_home / backup).chmod(original_modes[destination])
        backup_manifest.append({'path': str(destination), 'backup': str(backup_home / backup) if backup else None})
    (backup_home / 'manifest.json').write_text(json.dumps(backup_manifest, indent=2) + '\n')
    staged, restores, changed, failed_restores = {}, {}, [], set()
    try:
        # Allocate every new file and rollback copy before replacing live data.
        # Rollback itself needs only rename/unlink, including after ENOSPC.
        for destination, data in originals.items():
            if data is not None:
                restores[destination] = stage_file(destination, data, '.sprig-restore-', original_modes[destination])
        for destination, data in contents.items():
            wrapper = destination == destination_path(app_home, 'plugin_runtimes/workthreads/herdr_workthreads_cli.py')
            mode = 0o755 if wrapper else original_modes.get(destination)
            staged[destination] = stage_file(destination, data, '.sprig-new-', mode)
        for destination, temporary in staged.items():
            os.replace(temporary, destination)
            changed.append(destination)
        for destination in sorted(deletions):
            if destination.exists():
                destination.unlink()
                changed.append(destination)
    except Exception as error:
        restore_errors = []
        for destination in reversed(changed):
            try:
                if originals[destination] is None:
                    destination.unlink(missing_ok=True)
                else:
                    os.replace(restores[destination], destination)
            except OSError as restore_error:
                failed_restores.add(restores.get(destination))
                restore_errors.append(f'{destination}: {restore_error}')
        if restore_errors:
            raise RuntimeError(
                f'Installation failed ({error}); restore from {backup_home}: '
                + '; '.join(restore_errors)
            ) from error
        raise
    finally:
        for temporary in (*staged.values(), *restores.values()):
            if temporary not in failed_restores:
                temporary.unlink(missing_ok=True)
    print(json.dumps({'app_home': str(app_home), 'agent_home': str(agent_home),
                      'backup': str(backup_home), 'installed_files': len(files),
                      'settings_preserved': True}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-home', type=Path, default=Path(os.environ.get('HERDR_APP_HOME', Path.home() / '.config/herdr-app')))
    parser.add_argument('--agent-home', type=Path, default=Path(os.environ.get('PI_CODING_AGENT_DIR', Path.home() / '.omp/agent')))
    parser.add_argument('--backup-home', type=Path)
    parser.add_argument('--legacy-config', type=Path, help='Original Herdr config.toml (otherwise discover an unambiguous local config)')
    parser.add_argument('--legacy-machine-config', action='append', default=[], metavar='NAME=PATH',
                        help='Original config.toml for a named source machine; repeat for each machine')
    parser.add_argument('--legacy-key-source', choices=('local', 'server'), default='local',
                        help='Use local normal keys plus source commands (default), or full source-machine keys')
    args = parser.parse_args()
    backup = args.backup_home or Path.home() / '.local/state/herdr-app' / ('rowan-sidebar-backup-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    install(args.app_home, args.agent_home, backup, args.legacy_config, args.legacy_machine_config, args.legacy_key_source)
