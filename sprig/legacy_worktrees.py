#!/usr/bin/env python3
"""Legacy workthread board and Worktrunk picker for the selected Sprig window."""
import base64
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import re
import secrets
import signal
import shlex
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time
from urllib.request import Request, urlopen
import tomllib


def dispatch(request):
    action = request.get('action')
    if action not in ('workthreads.menu', 'worktrunk.open', 'worktrunk.open-current'):
        raise RuntimeError(f'Unknown worktree action: {action}')
    if request.get('local') is not True and not request.get('machine'):
        raise RuntimeError('Remote worktree action has no source machine')
    if request.get('local') is not True and request.get('action') == 'workthreads.menu' and not request.get('core'):
        raise RuntimeError('Remote workthreads requires the local core executable')
    if not request.get('pane') or not request.get('cwd') or not request.get('app') or request.get('window') is None:
        raise RuntimeError('Worktree action requires the source pane, directory and window')
    argv = [sys.executable, str(Path(__file__).resolve()), '--ui', json.dumps(request)]
    if action == 'workthreads.menu':
        return {'ok': True, 'popup': {'argv': argv, 'width': '85%', 'height': '70%'}}
    config = worktrunk_config(request)
    placement = config.get('picker_placement', 'split')
    if placement == 'split':
        if request.get('local') is not True:
            argv = start_picker_bridge(request)
        return {'ok': True, 'launch': {'pane': request['pane'], 'direction': 'down', 'argv': argv}}
    if placement == 'popup':
        popup = {'argv': argv}
        for key in ('width', 'height'):
            value = config.get('popup_' + key)
            if value is not None:
                popup[key] = value
        return {'ok': True, 'popup': popup}
    raise RuntimeError(f'Unsupported Worktrunk picker placement: {placement}')


def run_process(args, *, cwd=None, input=None):
    process = subprocess.Popen(args, cwd=cwd, stdin=subprocess.PIPE if input is not None else None,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        stdout, stderr = process.communicate(input)
    except BaseException:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        raise
    return subprocess.CompletedProcess(args, process.returncode, stdout, stderr)


def run(args, cwd=None, check=True):
    result = run_process(args, cwd=cwd)
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f'{args[0]} failed')
    return result


def worktrunk_config(request):
    if request.get('local') is not True and not os.environ.get('SPRIG_PICKER_RPC'):
        core = request.get('core') or 'hc'
        command = ['sh', '-c', 'f=${XDG_CONFIG_HOME:-$HOME/.config}/herdr/plugins/config/worktrunk/config.toml; if [ -f "$f" ]; then cat "$f"; fi']
        result = run([core, 'exec', '--on', request['machine'], '--cwd', request['cwd'], *command])
        return tomllib.loads(result.stdout)
    path = Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'herdr/plugins/config/worktrunk/config.toml'
    return tomllib.loads(path.read_text(encoding='utf-8')) if path.exists() else {}


def app(request, command, payload=None):
    rpc = os.environ.get('SPRIG_PICKER_RPC')
    if rpc:
        return picker_rpc({'operation': command, 'payload': payload})
    args = [request['app'], '--window', str(request['window'])]
    args += ['do', command, json.dumps(payload)] if payload is not None else [command]
    output = json.loads(run(args).stdout)
    if output.get('error'):
        raise RuntimeError(output['error'])
    return output


def picker_rpc(payload):
    url = os.environ['SPRIG_PICKER_RPC']
    data = json.dumps(payload).encode()
    req = Request(url, data=data, headers={'Content-Type': 'application/json',
                   'Authorization': 'Bearer ' + os.environ['SPRIG_PICKER_TOKEN']})
    with urlopen(req, timeout=20) as response:
        result = json.load(response)
    if not result.get('ok'):
        raise RuntimeError(result.get('error', 'Picker bridge failed'))
    return result.get('result')


_picker_lost = threading.Event()
_picker_waiting = threading.Event()


def require_picker_bridge():
    if os.environ.get('SPRIG_PICKER_RPC'):
        if _picker_lost.is_set():
            raise RuntimeError('Worktrunk window bridge disconnected')
        try:
            picker_rpc({'operation': 'heartbeat'})
        except (OSError, RuntimeError) as error:
            _picker_lost.set()
            raise RuntimeError('Worktrunk window bridge disconnected') from error
        if _picker_lost.is_set():
            raise RuntimeError('Worktrunk window bridge disconnected')


def source_environment(session):
    env = 'env -u HC_SESSION -u HC_SOCKET -u HC_TERMINAL_ID'
    if session is not None:
        env += ' ' + shlex.quote('HC_SESSION=' + session)
    return env


def start_picker_bridge(request):
    encoded = base64.urlsafe_b64encode(json.dumps(request).encode()).decode()
    process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--picker-bridge', encoded],
                               stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, text=True, start_new_session=True)
    line = process.stdout.readline()
    if not line:
        raise RuntimeError('Could not start Worktrunk source bridge')
    response = json.loads(line)
    if response.get('error'):
        raise RuntimeError(response['error'])
    context = {'request': request, 'port': response['port'], 'token': response['token']}
    payload = base64.urlsafe_b64encode(json.dumps(context).encode()).decode()
    env = source_environment(response.get('session'))
    command = 'exec ' + env + ' python3 "${HERDR_APP_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app}/legacy_worktrees.py" --source-picker ' + shlex.quote(payload)
    return ['sh', '-c', command]


def picker_bridge(request):
    machine, core = request['machine'], request.get('core') or 'hc'
    catalog = json.loads(run([core, 'machine', 'ls', '--json']).stdout)['machines']
    matches = [m for m in catalog if m.get('name') == machine or m.get('id') == machine]
    if len(matches) != 1 or matches[0].get('via'):
        raise RuntimeError('Source machine has no unique direct SSH transport')
    target, session = matches[0].get('target'), matches[0].get('session')
    if not isinstance(target, str) or not target or target.startswith('-'):
        raise RuntimeError('Source machine has no valid SSH target')
    if session is not None and (not isinstance(session, str) or not session):
        raise RuntimeError('Source machine has an invalid core session')
    token = secrets.token_urlsafe(32)
    state = {'last': time.monotonic(), 'done': False}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            if self.path != '/call' or not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + token):
                self.send_error(403)
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 65536:
                    raise ValueError('invalid request size')
                data = json.loads(self.rfile.read(length))
                operation, payload = data.get('operation'), data.get('payload')
                state['last'] = time.monotonic()
                if operation == 'heartbeat':
                    result = {}
                elif operation == 'finish':
                    state['done'] = True
                    result = {}
                elif operation == 'ls' and payload is None:
                    result = {'spaces': [s for s in app(request, 'ls')['spaces'] if s.get('machine') == machine]}
                elif operation in ('space.select', 'tab.new') and isinstance(payload, dict):
                    key = 'id' if operation == 'space.select' else 'space'
                    valid = {'id'} if operation == 'space.select' else {'name', 'space', 'folder'}
                    if set(payload) != valid or not all(isinstance(v, str) for v in payload.values()):
                        raise ValueError('invalid picker arguments')
                    spaces = app(request, 'ls')['spaces']
                    if not any(s.get('id') == payload[key] and s.get('machine') == machine for s in spaces):
                        raise ValueError('space is not on the source machine')
                    if operation == 'tab.new' and payload['space'] != request.get('space'):
                        raise ValueError('tab must remain in the source space')
                    result = app(request, operation, payload)
                elif operation == 'space.new' and isinstance(payload, dict):
                    if set(payload) != {'name', 'folder', 'machine'} or payload.get('machine') != machine or not all(isinstance(v, str) for v in payload.values()):
                        raise ValueError('invalid source space arguments')
                    result = app(request, operation, payload)
                else:
                    raise ValueError('operation not allowed')
                response = {'ok': True, 'result': result}
            except (ValueError, KeyError, OSError, RuntimeError) as error:
                response = {'ok': False, 'error': str(error)}
            encoded = json.dumps(response).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.timeout = 1
    port = 20000 + secrets.randbelow(40000)
    ssh = None
    try:
        ssh = subprocess.Popen(['ssh', '-N', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes',
                                '-R', f'127.0.0.1:{port}:127.0.0.1:{server.server_port}', target],
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(json.dumps({'port': port, 'token': token, 'session': session}), flush=True)
        while not state['done'] and time.monotonic() - state['last'] < 30 and ssh.poll() is None:
            server.handle_request()
    finally:
        server.server_close()
        if ssh and ssh.poll() is None:
            ssh.terminate()
            try:
                ssh.wait(timeout=3)
            except subprocess.TimeoutExpired:
                ssh.kill()
                ssh.wait()


def valid_rpc(args):
    if not isinstance(args, list) or not all(isinstance(x, str) and len(x) < 8192 for x in args):
        return False
    if args == ['workspace', 'list'] or args == ['pane', 'list']:
        return True
    if len(args) == 4 and args[:3] == ['pane', 'list', '--workspace']:
        return bool(args[3])
    if len(args) == 3 and args[:2] in (['workspace', 'focus'], ['workspace', 'close']):
        return bool(args[2])
    if len(args) == 7 and args[:3] == ['workspace', 'create', '--cwd']:
        return bool(args[3]) and args[4] == '--label' and args[6] in ('--focus', '--no-focus')
    if len(args) == 9 and args[:3] == ['worktree', 'open', '--cwd']:
        return bool(args[3] and args[5]) and args[4] == '--path' and args[6] == '--label' and args[8] in ('--focus', '--no-focus')
    return len(args) == 5 and args[:2] == ['notification', 'show'] and args[3] == '--body'


def remote_board(request):
    machine = request['machine']
    core = request['core']
    catalog = json.loads(run([core, 'machine', 'ls', '--json']).stdout)['machines']
    matches = [m for m in catalog if m.get('name') == machine or m.get('id') == machine]
    if len(matches) != 1 or matches[0].get('via'):
        raise RuntimeError('Source machine has no unique direct SSH transport')
    target = matches[0].get('target')
    if not isinstance(target, str) or not target or target.startswith('-'):
        raise RuntimeError('Source machine has no valid SSH target')
    session = matches[0].get('session')
    if session is not None and (not isinstance(session, str) or not session):
        raise RuntimeError('Source machine has an invalid core session')
    runtime = Path(__file__).resolve().parent / 'plugin_runtimes' / 'workthreads'
    sys.path.insert(0, str(runtime))
    from herdr_workthreads import herdr
    os.environ.update(SPRIG_APP=request['app'], SPRIG_WINDOW=str(request['window']),
                      SPRIG_CORE=core, SPRIG_MACHINE=machine)
    token = secrets.token_urlsafe(32)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            if self.path != '/call' or not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + token):
                self.send_error(403)
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if length <= 0 or length > 65536:
                    raise ValueError('invalid request size')
                data = json.loads(self.rfile.read(length))
                args = data.get('args')
                if not valid_rpc(args):
                    raise ValueError('operation not allowed')
                result = herdr.call(*args)
                payload = {'ok': True, 'result': result}
            except (ValueError, KeyError, OSError, herdr.HerdrError) as error:
                payload = {'ok': False, 'error': str(error)}
            encoded = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    remote_port = 20000 + secrets.randbelow(40000)
    context = {'request': request, 'port': remote_port, 'token': token}
    encoded = base64.urlsafe_b64encode(json.dumps(context).encode()).decode()
    environment = source_environment(session)
    remote_command = 'exec ' + environment + ' python3 \"${HERDR_APP_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app}/legacy_worktrees.py\" --remote-board ' + shlex.quote(encoded)
    command = ['ssh', '-tt', '-o', 'ExitOnForwardFailure=yes', '-R',
               f'127.0.0.1:{remote_port}:127.0.0.1:{server.server_port}', target, remote_command]
    try:
        return subprocess.run(command, check=False).returncode
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def open_worktrunk_tab(request, machine, name, switch_args):
    space = request.get('space')
    if not space:
        raise RuntimeError('Worktrunk tab mode requires a source space')
    spaces = app(request, 'ls').get('spaces', [])
    if not any(s.get('id') == space and s.get('machine') == machine for s in spaces):
        raise RuntimeError('Worktrunk source space is no longer on the selected machine')
    created = app(request, 'tab.new', {'name': name, 'space': space, 'folder': request['cwd']})
    terminal = created.get('terminal')
    if not isinstance(terminal, str) or not terminal:
        raise RuntimeError('New Worktrunk tab returned no terminal address')
    source_picker = bool(os.environ.get('SPRIG_PICKER_RPC'))
    core = 'hc' if source_picker else request.get('core') or 'hc'
    if source_picker:
        terminal = terminal.split('/', 1)[-1]
    info = json.loads(run([core, 'get', '--json', terminal]).stdout)
    shell = ((info.get('foreground') or {}).get('name') or
             (info.get('argv') or [''])[0]).rsplit('/', 1)[-1].lstrip('-').lower()
    def quote(value):
        if shell in ('nu', 'nushell'):
            if "'" not in value:
                return "'" + value + "'"
            return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'
        return shlex.quote(value)
    line = 'wt switch ' + ' '.join(arg if arg in ('--create', '--base') else quote(arg)
                                    for arg in switch_args)
    require_picker_bridge()
    run([core, 'send', terminal, line])


def worktrunk(request):
    machine = None if request.get('local') is True else request['machine']
    cwd = request['cwd']
    def source(args, cwd=cwd, check=True):
        if machine is None or os.environ.get('SPRIG_PICKER_RPC'):
            return run(args, cwd, check)
        return run([request.get('core') or 'hc', 'exec', '--on', machine,
                    '--cwd', cwd, *args], check=check)
    config = worktrunk_config(request)
    if machine and not os.environ.get('SPRIG_PICKER_RPC'):
        wt = source(['sh', '-lc', 'command -v wt']).stdout.strip()
    else:
        wt = shutil.which('wt')
        if not wt:
            candidates = sorted((Path.home() / '.local/share/mise/installs/aqua-max-sixty-worktrunk').glob('*/worktrunk-*/wt'))
            wt = str(candidates[-1]) if candidates else None
    mode = config.get('open_mode', 'workspace')
    if mode not in ('workspace', 'tab'):
        raise RuntimeError(f'Unsupported Worktrunk open mode: {mode}')
    if not wt:
        raise RuntimeError('Worktrunk wt was not found on the source machine')
    version = source([wt, '--version']).stdout.lower()
    if not re.match(r'^(?:worktrunk\s+|wt\s+v)\d', version.strip()):
        raise RuntimeError('wt is not the Worktrunk executable')
    ref_roots = ['refs/heads']
    if config.get('show_remote_branches') is True:
        ref_roots.append('refs/remotes')
    refs = source(['git', 'for-each-ref', '--format=%(refname) %(refname:short)', *ref_roots]).stdout.splitlines()
    refs = [line.split(' ', 1)[1] for line in refs if ' ' in line and not line.split(' ', 1)[0].endswith('/HEAD')]
    listing = json.loads(source([wt, 'list', '--format=json']).stdout)
    items = listing if isinstance(listing, list) else listing['items']
    names = list(dict.fromkeys(refs + [item['branch'] for item in items if item.get('branch')]))
    current = request['action'] == 'worktrunk.open-current'
    label = 'current branch' if current else 'default branch'
    _picker_waiting.set()
    try:
        if _picker_lost.is_set():
            raise RuntimeError('Worktrunk window bridge disconnected')
        if shutil.which('fzf'):
            result = run_process(['fzf', '--print-query', '--reverse', '--info=inline', '--bind=alt-enter:print-query', '--prompt=worktree ❯ ', f'--header=↵ switch · type a new name to create from {label} · alt-↵ force typed name · esc cancel'], input='\n'.join(names))
            if result.returncode not in (0, 1):
                return
            name = result.stdout.splitlines()[-1] if result.stdout.splitlines() else ''
        else:
            name = input(f'Branch (existing → switch; new → create from {label}): ').strip()
    finally:
        _picker_waiting.clear()
    if not name:
        return
    exists = name in ('^', '-') or ':' in name or any(source(['git', 'show-ref', '--quiet', '--verify', f'refs/{kind}/{name}'], check=False).returncode == 0 for kind in ('heads', 'remotes'))
    args = [wt, 'switch'] + ([] if exists else ['--create']) + [name]
    if not exists and current:
        args += ['--base', '@']
    require_picker_bridge()
    if mode == 'tab':
        open_worktrunk_tab(request, machine, name, args[2:])
        return
    switched = source(args + ['--no-cd', '--format=json'])
    if switched.stderr:
        print(switched.stderr, file=sys.stderr, end='')
    result = json.loads(switched.stdout)
    path = result.get('path') or (result.get('worktree') or {}).get('path')
    if not path:
        raise RuntimeError('Worktrunk returned no checkout path')
    branch = result.get('branch') or name
    label = branch if branch == name else f'{branch} ({name})'
    if result.get('action') == 'created' and config.get('hold_on_create', config.get('hold_on_success', False)) is True:
        input(f'Created worktree {label}. Press Enter to continue. ')
    spaces = app(request, 'ls')['spaces']
    existing = next((s for s in spaces if s.get('machine') == machine and s.get('folder') == path), None)
    if existing:
        app(request, 'space.select', {'id': existing['id']})
    else:
        created = app(request, 'space.new', {'name': label, 'folder': path, 'machine': machine or ''})
        app(request, 'space.select', {'id': created['space']})


def main(request):
    if request['action'] == 'workthreads.menu':
        if request.get('local') is not True and not os.environ.get('SPRIG_WORKTHREADS_RPC'):
            return remote_board(request)
        runtime = Path(__file__).resolve().parent / 'plugin_runtimes' / 'workthreads'
        sys.path.insert(0, str(runtime))
        os.environ['PYTHONPATH'] = str(runtime) + os.pathsep + os.environ.get('PYTHONPATH', '')
        os.environ['SPRIG_APP'] = request['app']
        os.environ['SPRIG_CORE'] = request.get('core') or 'hc'
        os.environ['SPRIG_WINDOW'] = str(request['window'])
        os.environ['WORKTHREADS_INVOKER_CONTEXT'] = json.dumps({'workspace_id': request.get('space'), 'workspace_cwd': request['cwd'], 'focused_pane_cwd': request['cwd']})
        from herdr_workthreads.__main__ import main as board
        return board(['herdr_workthreads', 'menu'])
    worktrunk(request)
    return 0


if __name__ == '__main__':
    try:
        if sys.argv[1] == '--picker-bridge':
            try:
                picker_bridge(json.loads(base64.urlsafe_b64decode(sys.argv[2])))
            except (RuntimeError, OSError, ValueError, KeyError) as error:
                print(json.dumps({'error': str(error)}), flush=True)
                sys.exit(1)
            sys.exit(0)
        if sys.argv[1] == '--source-picker':
            context = json.loads(base64.urlsafe_b64decode(sys.argv[2]))
            os.environ['SPRIG_PICKER_RPC'] = f"http://127.0.0.1:{context['port']}/call"
            os.environ['SPRIG_PICKER_TOKEN'] = context['token']
            for attempt in range(20):
                try:
                    picker_rpc({'operation': 'heartbeat'})
                    break
                except OSError:
                    if attempt == 19:
                        raise RuntimeError('Cannot connect to the authenticated Worktrunk window bridge')
                    time.sleep(0.25)
            def bridge_signal(_signum, _frame):
                if _picker_waiting.is_set():
                    raise RuntimeError('Worktrunk window bridge disconnected')
            previous_signal = signal.signal(signal.SIGUSR1, bridge_signal)
            stop = threading.Event()
            def heartbeat():
                while not stop.wait(5):
                    try:
                        picker_rpc({'operation': 'heartbeat'})
                    except (OSError, RuntimeError):
                        if not stop.is_set():
                            _picker_lost.set()
                            if _picker_waiting.is_set():
                                os.kill(os.getpid(), signal.SIGUSR1)
                        return
            heartbeat_thread = threading.Thread(target=heartbeat, daemon=True)
            heartbeat_thread.start()
            try:
                sys.exit(main(context['request']))
            finally:
                stop.set()
                heartbeat_thread.join()
                signal.signal(signal.SIGUSR1, previous_signal)
                try:
                    picker_rpc({'operation': 'finish'})
                except (OSError, RuntimeError):
                    pass
        if sys.argv[1] == '--remote-board':
            context = json.loads(base64.urlsafe_b64decode(sys.argv[2]))
            os.environ['SPRIG_WORKTHREADS_RPC'] = f"http://127.0.0.1:{context['port']}/call"
            os.environ['SPRIG_WORKTHREADS_TOKEN'] = context['token']
            sys.exit(main(context['request']))
        sys.exit(main(json.loads(sys.argv[2])))
    except (RuntimeError, OSError, ValueError, KeyError) as error:
        print(f'Worktree plugin: {error}', file=sys.stderr)
        if sys.stdin.isatty():
            input('Press Enter to close. ')
        sys.exit(1)
