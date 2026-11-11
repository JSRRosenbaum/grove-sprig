"""Launch the pinned Plannotator review UI on the source terminal's machine."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time


# The same program runs on the owning machine for preflight and in the split.
# Inlining it avoids requiring the Sprig Python package on a remote core.
_RUNNER = r'''
import json, os, pathlib, subprocess, sys
mode, action, terminal, original, host, cwd, core, session = sys.argv[1:]
original = json.loads(original)
base = pathlib.Path(os.environ.get('LOCALAPPDATA', pathlib.Path.home() / '.local/share')) if os.name == 'nt' else pathlib.Path(os.environ.get('XDG_DATA_HOME', pathlib.Path.home() / '.local/share'))
binary = pathlib.Path(os.environ.get('SPRIG_REVIEW_BIN', base / 'sprig' / 'bin' / ('plannotator-tui.exe' if os.name == 'nt' else 'plannotator-tui')))
if not binary.is_file():
    raise SystemExit('Sprig review runtime not installed on the source machine: ' + str(binary))
result = subprocess.run([core, 'get', '--json', terminal], capture_output=True, text=True)
if result.returncode:
    raise SystemExit(result.stderr.strip() or 'Cannot read source terminal')
try:
    current = json.loads(result.stdout)
except ValueError:
    raise SystemExit('Invalid core terminal response')
for key in ('created_ms', 'state', 'foreground'):
    if current.get(key) != original.get(key):
        raise SystemExit('Source terminal or foreground process changed; review was not opened')
if current.get('state') != 'live' or not current.get('foreground'):
    raise SystemExit('Source terminal is no longer live')
if session:
    try:
        metadata = json.loads((current.get('labels') or {}).get('rowan.omp', 'null'))
    except ValueError:
        metadata = None
    if not isinstance(metadata, dict) or metadata.get('session') != session or metadata.get('pid') != current['foreground']['pid']:
        raise SystemExit('Source agent session changed; review was not opened')
if not os.path.isdir(cwd):
    raise SystemExit('Source folder is unavailable: ' + cwd)
if mode == 'check':
    config = subprocess.run([str(binary), 'sprig-config'], capture_output=True, text=True)
    if config.returncode:
        raise SystemExit(config.stderr.strip() or 'Cannot read review placement configuration')
    print(config.stdout, end='')
    sys.exit(0)
os.chdir(cwd)
os.environ.update(SPRIG_REVIEW_CORE=core, SPRIG_REVIEW_TERMINAL=terminal,
                  SPRIG_REVIEW_IDENTITY=json.dumps(current), SPRIG_REVIEW_HOST=host)
args = [str(binary), cwd] if action == 'annotate.open' else [str(binary), 'last', '--host', host, '--pid', str(current['foreground']['pid'])]
if action == 'annotate.last' and session:
    args += ['--session-id', session]
try:
    sys.exit(subprocess.call(args))
except OSError as error:
    raise SystemExit('Cannot start Sprig review runtime: ' + str(error))
'''


def _get(core, terminal):
    result = subprocess.run([core, 'get', '--json', terminal], text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or 'Cannot read source terminal')
    try:
        return json.loads(result.stdout)
    except ValueError as error:
        raise RuntimeError('Invalid core terminal response') from error


def _host(record):
    foreground = record.get('foreground') or {}
    candidates = [(record.get('status') or {}).get('app', ''), (record.get('report') or {}).get('app', ''), foreground.get('name', '')]
    candidates.extend(foreground.get('argv') or [])
    known = {'claude', 'codex', 'pi', 'omp', 'copilot', 'droid', 'hermes', 'opencode'}
    for candidate in candidates:
        if not isinstance(candidate, str):
            continue
        name = candidate.replace('\\', '/').rsplit('/', 1)[-1].lower()
        if name.endswith('.exe'):
            name = name[:-4]
        if name in known:
            return name
    raise RuntimeError('Cannot identify the source agent; review feedback would not have a safe target')


def _session(record):
    try:
        metadata = json.loads((record.get('labels') or {}).get('rowan.omp', 'null'))
        now = time.time() * 1000
        if (isinstance(metadata, dict) and metadata.get('v') == 1
                and metadata.get('pid') == record['foreground']['pid']
                and isinstance(metadata.get('session'), str) and metadata['session']
                and isinstance(metadata.get('at'), (int, float))
                and record.get('created_ms', 0) <= metadata['at'] <= now + 30000):
            return metadata['session']
    except (KeyError, TypeError, ValueError):
        pass
    return ''


def dispatch(request):
    action = request.get('action')
    if action not in ('annotate.open', 'annotate.last'):
        raise RuntimeError('Unknown review action')
    pane, terminal, core = (request.get(k) for k in ('pane', 'terminal', 'core'))
    if not all(isinstance(v, str) and v for v in (pane, terminal, core)):
        raise RuntimeError('Review needs a source pane, terminal, and core executable')
    if not isinstance(request.get('local'), bool):
        raise RuntimeError('Missing source machine ownership')
    record = _get(core, terminal)
    foreground = record.get('foreground') or {}
    if record.get('state') != 'live' or not isinstance(foreground.get('pid'), int) or foreground['pid'] <= 0:
        raise RuntimeError('Source terminal has no live foreground process')
    host = _host(record)
    cwd = foreground.get('cwd') or request.get('cwd')
    if not isinstance(cwd, str) or not cwd:
        raise RuntimeError('Source terminal has no working directory')
    machine = request.get('machine')
    if not request['local'] and (not isinstance(machine, str) or not machine):
        raise RuntimeError('Remote review needs the source machine')
    owner_terminal = terminal.split('/', 1)[-1] if not request['local'] else terminal
    owner_core = 'hc' if not request['local'] else core
    args = [action, owner_terminal, json.dumps(record, ensure_ascii=False), host, cwd, owner_core, _session(record)]
    python = sys.executable if request['local'] else 'python3'
    check = [python, '-c', _RUNNER, 'check', *args]
    if not request['local']:
        check = [core, 'exec', '--on', machine, *check]
    result = subprocess.run(check, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or 'Review runtime preflight failed')
    try:
        placement = json.loads(result.stdout)
    except ValueError as error:
        raise RuntimeError('Invalid review placement configuration') from error
    if not isinstance(placement, dict) or placement.get('placement') not in ('overlay', 'split', 'popup') or placement.get('direction') not in ('right', 'down'):
        raise RuntimeError('Invalid review placement configuration')
    return {'ok': True, 'launch': {'pane': pane, **placement,
                                    'argv': [python, '-c', _RUNNER, 'run', *args]}}
