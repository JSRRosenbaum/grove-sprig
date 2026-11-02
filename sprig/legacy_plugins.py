#!/usr/bin/env python3
"""Bridge legacy annotation actions to Sprig without a legacy Herdr server.

The editor and manager are Sprig's native annotation runtime;
the JSONL store and Markdown export are compatible with annotate 0.6.0.
"""
import json
import os
import subprocess
import shlex
from pathlib import Path
import sys
import uuid


def state_dir():
    default = Path(os.environ['LOCALAPPDATA']) if os.name == 'nt' and os.environ.get('LOCALAPPDATA') else Path.home() / '.local/state'
    return Path(os.environ.get('XDG_STATE_HOME', default)) / 'herdr/plugins/annotate'


def binary():
    base = Path(os.environ.get('LOCALAPPDATA', Path.home() / '.local/share')) if os.name == 'nt' else Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local/share'))
    path = Path(os.environ.get('SPRIG_ANNOTATE_BIN', base / 'sprig' / 'bin' / ('herdr-annotate.exe' if os.name == 'nt' else 'herdr-annotate')))
    if not path.is_file():
        raise RuntimeError('Sprig annotation runtime not installed on the source machine: ' + str(path))
    return path


def read_annotations():
    directory = state_dir()
    if not directory.exists():
        return []
    lock = directory / '.annotations.lock'
    owner = f'{os.getpid()}:{uuid.uuid4()}'
    try:
        lock.mkdir(mode=0o700)
    except FileExistsError:
        raise RuntimeError('Annotations are busy; try again') from None
    owner_path = lock / 'owner'
    try:
        owner_path.write_text(owner + '\n', encoding='utf-8')
    except OSError:
        owner_path.unlink(missing_ok=True)
        lock.rmdir()
        raise
    try:
        path = directory / 'annotations.jsonl'
        if not path.exists():
            return []
        records = []
        for line in path.read_text(encoding='utf-8').splitlines():
            if not line.strip():
                continue
            item = json.loads(line)
            if not isinstance(item, dict) or not all(isinstance(item.get(k), str) for k in ('selectedText', 'capturedAt', 'id', 'comment', 'createdAt')) or not item['id'] or not any(not c.isspace() and c != '\ufeff' for c in item['comment']) or not item['createdAt']:
                raise RuntimeError('Invalid annotation record; store was not modified')
            records.append(item)
        return records[::-1]
    finally:
        try:
            if owner_path.read_text(encoding='utf-8').strip() == owner:
                owner_path.unlink()
                lock.rmdir()
        except FileNotFoundError:
            pass


def format_annotations(records):
    sections = []
    for number, item in enumerate(records, 1):
        context = item.get('context') if isinstance(item.get('context'), dict) else {}
        source = ' / '.join(context[k] for k in ('workspace_label', 'tab_label') if isinstance(context.get(k), str))
        selection = item['selectedText']
        longest = 0
        run = 0
        for char in selection:
            run = run + 1 if char == '`' else 0
            longest = max(longest, run)
        fence = '`' * max(3, longest + 1)
        metadata = f'\nSource: {source}\n' if source else ''
        lines = [f'## Annotation {number}', metadata, 'Selected text:', '', fence, selection, fence, '', 'Comment:', '', item['comment']]
        filtered = []
        for line in lines:
            if line == '' and filtered and filtered[-1] == '':
                continue
            filtered.append(line)
        sections.append('\n'.join(filtered))
    return '# Annotated context\n\n' + '\n\n'.join(sections) + '\n'



def remote_python(request, mode):
    machine = request.get('machine')
    core = request.get('core')
    if not isinstance(machine, str) or not machine or not isinstance(core, str) or not core:
        raise RuntimeError('Remote annotation requires a machine and core executable')
    source = Path(__file__).read_text(encoding='utf-8')
    result = subprocess.run([core, 'exec', '--on', machine, 'python3', '-c', source, mode],
                            text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or 'Remote annotation command failed')
    try:
        response = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError('Remote annotation command returned invalid JSON') from error
    if not response.get('ok'):
        raise RuntimeError(response.get('error', 'Remote annotation command failed'))
    return response


def grid(request):
    if not isinstance(request.get('pane'), str) or not request['pane']:
        raise RuntimeError('Sci-fi grid requires a source pane')
    panel = Path(__file__).with_name('legacy_scifi_panel.py').read_text(encoding='utf-8')
    python = sys.executable if request['local'] else 'python3'
    if not request['local']:
        core, machine = request.get('core'), request.get('machine')
        if not isinstance(core, str) or not core or not isinstance(machine, str) or not machine:
            raise RuntimeError('Remote grid requires a machine and core executable')
        check = subprocess.run([core, 'exec', '--on', machine, python, '--version'],
                               capture_output=True, text=True)
        if check.returncode:
            raise RuntimeError(check.stderr.strip() or 'Remote Python is unavailable')
    plan = [('right', 'root', 'right', 'radar'), ('lower_left', 'root', 'down', 'tunnel'),
            ('lower_right', 'right', 'down', 'scan'), ('upper_middle', 'root', 'right', 'spectrum'),
            ('lower_middle', 'lower_left', 'right', 'packet'), ('upper_far_right', 'right', 'right', 'orbit'),
            ('lower_far_right', 'lower_right', 'right', 'cpu'), ('left_mid', 'root', 'down', 'matrix'),
            ('mid_mid', 'upper_middle', 'down', 'wave'), ('right_mid', 'right', 'down', 'pulse')]
    steps = [{'id': name, 'from': parent, 'direction': direction, 'argv': [python, '-c', panel, mode]}
             for name, parent, direction, mode in plan]
    return {'ok': True, 'split_plan': {'pane': request['pane'], 'steps': steps}}


def custom_env(request):
    env = os.environ.copy()
    for key, field in (('HERDR_ACTIVE_WORKSPACE_ID', 'space'),
                       ('HERDR_ACTIVE_TAB_ID', 'tab'),
                       ('HERDR_ACTIVE_PANE_ID', 'pane'),
                       ('HERDR_ACTIVE_PANE_CWD', 'cwd')):
        if isinstance(request.get(field), str):
            env[key] = request[field]
    return env


def shell_argv(command):
    if os.name == 'nt':
        return [os.environ.get('ComSpec', 'cmd.exe'), '/d', '/c', command]
    return ['/bin/sh', '-lc', command]


def custom_shell_run(request):
    cwd, command = request.get('cwd'), request.get('command')
    if not isinstance(cwd, str) or not os.path.isdir(cwd):
        raise RuntimeError('Source pane folder is unavailable')
    if not isinstance(command, str) or not command.strip():
        raise RuntimeError('Custom command is empty')
    # An explicitly named absolute program should not silently disappear.
    try:
        words = shlex.split(command, posix=os.name != 'nt')
    except ValueError:
        words = []
    if words and os.path.isabs(words[0]) and not os.path.isfile(words[0]):
        raise RuntimeError(f'Custom command executable does not exist: {words[0]}')
    subprocess.Popen(shell_argv(command), cwd=cwd, env=custom_env(request),
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL, start_new_session=True)
    return {'ok': True}


def custom_command(request):
    command, kind, pane = request.get('command'), request.get('type'), request.get('pane')
    if not isinstance(command, str) or not command.strip():
        raise RuntimeError('Custom command is empty')
    if kind not in ('shell', 'pane', 'popup'):
        raise RuntimeError(f'Unknown custom command type: {kind!r}')
    fields = {key: request.get(key) for key in ('command', 'space', 'tab', 'pane', 'cwd')}
    if kind == 'shell':
        if request['local']:
            return custom_shell_run(fields)
        machine, core = request.get('machine'), request.get('core')
        if not isinstance(machine, str) or not machine or not isinstance(core, str) or not core:
            raise RuntimeError('Remote custom command requires a machine and core executable')
        source = Path(__file__).read_text(encoding='utf-8')
        result = subprocess.run([core, 'exec', '--on', machine, 'python3', '-c', source,
                                 '--custom-shell', json.dumps(fields, ensure_ascii=False)],
                                text=True, capture_output=True)
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or 'Remote custom command failed')
        try:
            response = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise RuntimeError('Remote custom command returned invalid JSON') from error
        if not response.get('ok'):
            raise RuntimeError(response.get('error', 'Remote custom command failed'))
        return response
    if not isinstance(pane, str) or not pane:
        raise RuntimeError('Custom command requires a source pane')
    source = Path(__file__).read_text(encoding='utf-8')
    python = sys.executable if request['local'] else 'python3'
    argv = [python, '-c', source, '--custom-ui', json.dumps(fields, ensure_ascii=False)]
    launch = {'pane': pane, 'placement': kind, 'argv': argv}
    if kind == 'pane':
        launch.update({'direction': 'right', 'zoom': True})
    else:
        for key in ('width', 'height'):
            if request.get(key) is not None:
                launch[key] = request[key]
    return {'ok': True, 'launch': launch}


def dispatch(request):
    action = request.get('action')
    if not isinstance(request.get('local'), bool):
        raise RuntimeError('Missing source machine ownership')
    if request['local'] != (request.get('machine') is None):
        raise RuntimeError('Source machine ownership is inconsistent')
    if action == 'shell':
        return custom_command(request)
    if action == 'scifi-grid':
        return grid(request)
    if action == 'annotate.copy-context':
        if not request['local']:
            return remote_python(request, '--remote-copy')
        records = read_annotations()
        if not records:
            raise RuntimeError('No annotations to copy')
        return {'ok': True, 'clipboard': format_annotations(records)}
    if action in ('annotate.capture', 'annotate.manage'):
        pane = request.get('pane')
        if not isinstance(pane, str) or not pane:
            raise RuntimeError('No source pane for annotation')
        selected = request.get('selection')
        if not isinstance(selected, str) or not any(not c.isspace() and c != '\ufeff' for c in selected):
            selected = request.get('clipboard')
        context = {'workspace_id': request.get('space'), 'workspace_label': request.get('space_label'), 'tab_label': request.get('tab_label'), 'focused_pane_id': request.get('terminal'), 'focused_pane_cwd': request.get('cwd'), 'selected_text': selected}
        if action == 'annotate.capture' and (not isinstance(selected, str) or not any(not c.isspace() and c != '\ufeff' for c in selected)):
            raise RuntimeError('Select terminal text to annotate')
        mode = 'editor' if action.endswith('capture') else 'manager'
        if request['local']:
            argv = [sys.executable, str(Path(__file__).resolve()), '--annotation-ui', str(binary()), mode, json.dumps(context, ensure_ascii=False)]
        else:
            remote_python(request, '--remote-check')
            source = Path(__file__).read_text(encoding='utf-8')
            argv = ['python3', '-c', source, '--annotation-ui-auto', mode, json.dumps(context, ensure_ascii=False)]
        width, height = (88, 24) if mode == 'editor' else (100, 30)
        return {'ok': True, 'launch': {'pane': pane, 'placement': 'popup', 'width': width, 'height': height, 'argv': argv}}
    if action in ('annotate.open', 'annotate.last'):
        import legacy_review
        return legacy_review.dispatch(request)
    if action in ('worktrunk.open', 'worktrunk.open-current', 'workthreads.menu'):
        import legacy_worktrees
        return legacy_worktrees.dispatch(request)
    raise RuntimeError(f'Legacy action {action!r} requires a Sprig backend port; it was not run')


def main():
    if len(sys.argv) == 3 and sys.argv[1] == '--custom-shell':
        try:
            response = custom_shell_run(json.loads(sys.argv[2]))
        except (OSError, ValueError, RuntimeError) as error:
            response = {'ok': False, 'error': str(error)}
        print(json.dumps(response, ensure_ascii=False))
        return
    if len(sys.argv) == 3 and sys.argv[1] == '--custom-ui':
        request = json.loads(sys.argv[2])
        cwd = request.get('cwd')
        if not isinstance(cwd, str) or not os.path.isdir(cwd):
            raise RuntimeError('Source pane folder is unavailable')
        os.chdir(cwd)
        argv = shell_argv(request['command'])
        os.execvpe(argv[0], argv, custom_env(request))
    if len(sys.argv) == 4 and sys.argv[1] == '--annotation-ui-auto':
        os.environ['HERDR_PLUGIN_STATE_DIR'] = str(state_dir())
        os.environ['HERDR_PLUGIN_CONTEXT_JSON'] = sys.argv[3]
        executable = str(binary())
        os.execv(executable, [executable, sys.argv[2]])
    if len(sys.argv) == 2 and sys.argv[1] in ('--remote-copy', '--remote-check'):
        try:
            if sys.argv[1] == '--remote-check':
                binary()
                response = {'ok': True}
            else:
                response = dispatch({'local': True, 'action': 'annotate.copy-context'})
        except (OSError, ValueError, RuntimeError) as error:
            response = {'ok': False, 'error': str(error)}
        print(json.dumps(response, ensure_ascii=False))
        return
    if len(sys.argv) == 5 and sys.argv[1] == '--annotation-ui':
        os.environ['HERDR_PLUGIN_STATE_DIR'] = str(state_dir())
        os.environ['HERDR_PLUGIN_CONTEXT_JSON'] = sys.argv[4]
        os.execv(sys.argv[2], [sys.argv[2], sys.argv[3]])
    try:
        request = json.load(sys.stdin)
        if not isinstance(request, dict):
            raise ValueError('Expected a JSON object')
        response = dispatch(request)
    except (OSError, ValueError, RuntimeError, ImportError) as error:
        response = {'ok': False, 'error': str(error)}
    print(json.dumps(response, ensure_ascii=False))


if __name__ == '__main__':
    main()
