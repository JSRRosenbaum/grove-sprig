"""Map workthread operations onto the selected Sprig window."""

from __future__ import annotations

import json
import os
import posixpath
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError

from .manifest import Thread, Worktree
from .ui import Abort


class HerdrError(Abort):
    def __init__(self, code: str, message: str, command: tuple[str, ...]):
        super().__init__(f"Sprig {' '.join(command)}: {code}: {message}")
        self.code = code
        self.message = message


def call(*args: str) -> dict:
    rpc = os.environ.get("SPRIG_WORKTHREADS_RPC")
    if rpc:
        request = Request(rpc, data=json.dumps({"args": args}).encode(),
                          headers={"Content-Type": "application/json",
                                   "Authorization": "Bearer " + os.environ["SPRIG_WORKTHREADS_TOKEN"]})
        try:
            with urlopen(request, timeout=120) as response:
                payload = json.load(response)
        except (OSError, URLError, ValueError) as error:
            raise HerdrError("transport", str(error), args) from error
        if not payload.get("ok"):
            raise HerdrError(payload.get("code", "remote_error"), payload.get("error", "request failed"), args)
        return payload["result"]
    machine = os.environ.get("SPRIG_MACHINE") or None
    app = os.environ.get("SPRIG_APP") or shutil.which("herdr-app")
    window = os.environ.get("SPRIG_WINDOW")
    if not app:
        raise HerdrError("missing_app", "herdr-app is not on PATH; set SPRIG_APP", args)

    def invoke(*command):
        try:
            result = subprocess.run([app, *(["--window", window] if window else []), *command],
                                    capture_output=True, text=True, check=False)
        except OSError as error:
            raise HerdrError("execution", str(error), args) from error
        try:
            payload = json.loads(result.stdout)
        except (ValueError, TypeError) as error:
            raise HerdrError("unreadable_response", result.stderr.strip() or str(error), args) from error
        if result.returncode or payload.get("error"):
            raise HerdrError("app_error", str(payload.get("error") or result.stderr), args)
        return payload

    def option(name):
        return args[args.index(name) + 1] if name in args else None

    if args[:2] in (("workspace", "list"), ("pane", "list")):
        spaces = [s for s in invoke("ls").get("spaces", []) if s.get("machine") == machine]
        if args[0] == "workspace":
            result = []
            for space in spaces:
                folder = space.get("folder")
                checkout = None
                if folder:
                    git = ["git", "-C", folder, "rev-parse", "--show-toplevel", "--git-common-dir", "--git-dir"]
                    if machine:
                        git = [os.environ.get("SPRIG_CORE", "hc"), "exec", "--on", machine, *git]
                    probe = subprocess.run(git, capture_output=True, text=True)
                    lines = probe.stdout.splitlines()
                    paths = posixpath if machine else os.path
                    if probe.returncode == 0 and len(lines) >= 3 and paths.normpath(paths.join(folder, lines[1])) != paths.normpath(paths.join(folder, lines[2])):
                        checkout = {"is_linked_worktree": True, "checkout_path": lines[0]}
                result.append({"workspace_id": space["id"], "label": space.get("name"), "worktree": checkout})
            return {"workspaces": result}
        result = []
        for space in spaces:
            if option("--workspace") and space["id"] != option("--workspace"):
                continue
            for tab in space.get("tabs", []):
                for terminal in tab.get("terminals", []):
                    address = terminal.get("terminal")
                    if not address:
                        raise HerdrError("unreadable_response", "pane has no terminal address", args)
                    proc = subprocess.run([os.environ.get("SPRIG_CORE", "hc"), "get", "--json", address],
                                          capture_output=True, text=True, check=False)
                    try:
                        record = json.loads(proc.stdout)
                    except ValueError as error:
                        raise HerdrError("unreadable_response", proc.stderr.strip() or str(error), args) from error
                    if proc.returncode or record.get("error"):
                        raise HerdrError("core_error", str(record.get("error") or proc.stderr), args)
                    cwd = (record.get("foreground") or {}).get("cwd") or record.get("cwd")
                    result.append({"workspace_id": space["id"], "cwd": cwd,
                                   "pane_id": terminal.get("pane"), "agent": terminal.get("app"),
                                   "agent_status": terminal.get("status")})
        return {"panes": result}
    if args[:2] in (("workspace", "create"), ("worktree", "open")):
        folder = option("--path") or option("--cwd")
        spaces = invoke("ls").get("spaces", [])
        existing = next((s for s in spaces if s.get("machine") == machine and s.get("folder") == folder), None)
        if existing:
            if "--focus" in args:
                invoke("do", "space.select", json.dumps({"id": existing["id"]}))
            return {"workspace": {"workspace_id": existing["id"], "label": existing.get("name")}}
        active = next((s["id"] for s in spaces if s.get("active")), None)
        created = invoke("do", "space.new", json.dumps({"folder": folder, "name": option("--label") or "", "machine": machine or ""}))
        workspace_id = created.get("space")
        if not workspace_id:
            raise HerdrError("unreadable_response", "space.new did not return an id", args)
        if "--no-focus" in args and active:
            invoke("do", "space.select", json.dumps({"id": active}))
        return {"workspace": {"workspace_id": workspace_id, "label": option("--label")}}
    if args[:2] in (("workspace", "focus"), ("workspace", "close")):
        spaces = invoke("ls").get("spaces", [])
        if not any(s.get("id") == args[2] and s.get("machine") == machine for s in spaces):
            raise HerdrError("wrong_machine", "space is not on the source machine", args)
    if args[:2] == ("workspace", "focus"):
        return invoke("do", "space.select", json.dumps({"id": args[2]}))
    if args[:2] == ("workspace", "close"):
        return invoke("do", "space.close", json.dumps({"id": args[2], "confirmed": True}))
    if args[:2] == ("notification", "show"):
        print(f"{args[2]}: {option('--body') or ''}")
        return {}
    raise HerdrError("unsupported", "unsupported workspace operation", args)


def try_call(*args: str) -> dict | None:
    try:
        return call(*args)
    except HerdrError:
        return None


# --- invocation context -------------------------------------------------------


@dataclass
class Context:
    workspace_id: str | None
    workspace_cwd: str | None
    focused_pane_cwd: str | None
    workspace_label: str | None


def context() -> Context:
    raw = os.environ.get("WORKTHREADS_INVOKER_CONTEXT") or os.environ.get("HERDR_PLUGIN_CONTEXT_JSON") or "{}"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {}
    return Context(
        workspace_id=os.environ.get("WORKTHREADS_WORKSPACE_ID")
        or data.get("workspace_id")
        or os.environ.get("HERDR_WORKSPACE_ID"),
        workspace_cwd=data.get("workspace_cwd"),
        focused_pane_cwd=data.get("focused_pane_cwd"),
        workspace_label=data.get("workspace_label"),
    )


# --- queries ------------------------------------------------------------------


def workspaces() -> list[dict]:
    return call("workspace", "list").get("workspaces", [])


def panes(workspace_id: str | None = None) -> list[dict]:
    args = ["pane", "list"]
    if workspace_id:
        args += ["--workspace", workspace_id]
    return call(*args).get("panes", [])


def _resolve(path: str | None) -> Path | None:
    if not path:
        return None
    try:
        return Path(path).resolve()
    except OSError:
        return None


def _plugin_root() -> Path | None:
    return _resolve(os.environ.get("HERDR_PLUGIN_ROOT"))


def panes_inside(root: Path, pane_list: list[dict] | None = None) -> list[dict]:
    """Panes whose working directory lies inside `root`, excluding this plugin's own popup."""
    target = root.resolve()
    plugin_root = _plugin_root()
    inside = []
    for pane in pane_list if pane_list is not None else panes():
        cwd = _resolve(pane.get("foreground_cwd") or pane.get("cwd"))
        if cwd is None:
            continue
        if plugin_root and cwd.is_relative_to(plugin_root):
            continue
        if cwd.is_relative_to(target):
            inside.append(pane)
    return inside


def _checkout_path(workspace: dict) -> Path | None:
    """The checkout a Herdr worktree workspace is bound to, or None for plain workspaces."""
    provenance = workspace.get("worktree") or {}
    if not provenance.get("is_linked_worktree"):
        return None
    return _resolve(provenance.get("checkout_path"))


def nested_workspace_ids(root: Path, all_workspaces: dict[str, dict]) -> set[str]:
    """Herdr worktree workspaces whose checkout lies inside `root`: the per-repository
    workspaces of a thread. They are never the thread's own workspace."""
    target = root.resolve()
    found = set()
    for workspace in all_workspaces.values():
        checkout = _checkout_path(workspace)
        if checkout is not None and checkout.is_relative_to(target):
            found.add(workspace["workspace_id"])
    return found


def map_live(threads: list[Thread], *, heal: bool = True) -> dict[str, str]:
    """thread name -> workspace id for every thread with a live thread workspace.

    Pane working directories are the primary signal (workspace ids change on server
    restart). The manifest hint and the workspace label are fallbacks. Matches found by
    the primary signal are written back to the manifest as the new hint. Per-repository
    worktree workspaces (see `repo_workspaces`) are excluded: Herdr marks them with
    worktree provenance.
    """
    live: dict[str, str] = {}
    all_panes = panes()
    all_workspaces = {ws["workspace_id"]: ws for ws in workspaces()}

    for thread in threads:
        if not thread.readable:
            continue
        nested = nested_workspace_ids(thread.root, all_workspaces)
        hits = panes_inside(thread.root, all_panes)
        ids = sorted({pane["workspace_id"] for pane in hits} - nested)
        if ids:
            hinted = (thread.workspace or {}).get("id")
            chosen = hinted if hinted in ids else ids[0]
            live[thread.name] = chosen
            if heal and (thread.workspace or {}).get("id") != chosen and thread.mutable:
                thread.remember_workspace(chosen, all_workspaces.get(chosen, {}).get("label"))
                try:
                    thread.save()
                except Exception:
                    pass
            continue

        hint = thread.workspace or {}
        hinted_id = hint.get("id")
        if hinted_id and hinted_id in all_workspaces and hinted_id not in nested:
            label = all_workspaces[hinted_id].get("label")
            if label == hint.get("label") or label == thread.name:
                live[thread.name] = hinted_id
                continue

        by_label = [
            ws
            for ws in all_workspaces.values()
            if ws.get("label") == thread.name and _checkout_path(ws) is None
        ]
        if len(by_label) == 1:
            live[thread.name] = by_label[0]["workspace_id"]
    return live


def repo_workspaces(thread: Thread, all_workspaces: list[dict] | None = None) -> dict[str, str]:
    """worktree folder -> workspace id for the thread's per-repository worktree workspaces
    that are currently open. Identity comes from Herdr's worktree provenance (the checkout
    path), which survives server restarts."""
    if not thread.readable:
        return {}
    by_checkout: dict[Path, str] = {}
    for workspace in all_workspaces if all_workspaces is not None else workspaces():
        checkout = _checkout_path(workspace)
        if checkout is not None:
            by_checkout.setdefault(checkout, workspace["workspace_id"])
    found: dict[str, str] = {}
    for worktree in thread.worktrees:
        path = _resolve(str(thread.path_of(worktree)))
        if path is not None and path in by_checkout:
            found[worktree.folder] = by_checkout[path]
    return found


def map_repo_live(threads: list[Thread]) -> dict[str, dict[str, str]]:
    """thread name -> {worktree folder -> workspace id} for open per-repository workspaces."""
    all_workspaces = workspaces()
    return {
        thread.name: found
        for thread in threads
        if thread.readable and (found := repo_workspaces(thread, all_workspaces))
    }


def current_thread(threads: list[Thread], ctx: Context) -> Thread | None:
    """The thread the user invoked the action from, if any."""
    readable = [thread for thread in threads if thread.readable]
    if ctx.workspace_id:
        live = map_live(readable)
        for thread in readable:
            if live.get(thread.name) == ctx.workspace_id:
                return thread
        for thread in readable:
            if ctx.workspace_id in repo_workspaces(thread).values():
                return thread
    for candidate in (ctx.workspace_cwd, ctx.focused_pane_cwd):
        cwd = _resolve(candidate)
        if cwd is None:
            continue
        for thread in readable:
            if cwd.is_relative_to(thread.root.resolve()):
                return thread
    return None


# --- mutations ----------------------------------------------------------------


def create_workspace(thread: Thread, *, focus: bool = True) -> str:
    result = call(
        "workspace",
        "create",
        "--cwd",
        str(thread.root),
        "--label",
        thread.name,
        "--focus" if focus else "--no-focus",
    )
    workspace_id = result["workspace"]["workspace_id"]
    thread.remember_workspace(workspace_id, result["workspace"].get("label"))
    return workspace_id


def repo_workspace_label(thread: Thread, worktree: Worktree) -> str:
    return thread.name if worktree.suffix is None else f"{thread.name}@{worktree.suffix}"


def open_repo_workspace(thread: Thread, worktree: Worktree, *, focus: bool = False) -> str:
    """Open one worktree entry as a Herdr worktree workspace. Herdr binds it to its
    repository and indents it under the repository's workspace in the sidebar (opening
    that parent workspace first when none is open). Idempotent: an already-open checkout
    returns its existing workspace id."""
    result = call(
        "worktree",
        "open",
        "--cwd",
        worktree.repo_path,
        "--path",
        str(thread.path_of(worktree)),
        "--label",
        repo_workspace_label(thread, worktree),
        "--focus" if focus else "--no-focus",
    )
    return result["workspace"]["workspace_id"]


@dataclass
class Opened:
    workspace_id: str | None = None  # the thread workspace, when the mode has one
    repo_workspaces: dict[str, str] = field(default_factory=dict)  # folder -> workspace id
    created: bool = False  # something new was opened
    failures: list[str] = field(default_factory=list)

    @property
    def any(self) -> str | None:
        """Some workspace of the thread: the thread workspace, else the first nested one."""
        return self.workspace_id or next(iter(self.repo_workspaces.values()), None)


def open_thread(
    config,
    thread: Thread,
    *,
    focus: bool,
    workspace_id: str | None = None,
    only: list[Worktree] | None = None,
) -> Opened:
    """Open whatever workspaces the configured mode calls for and are not open yet.

    `workspace_id` is the live thread workspace when the caller already knows it. `only`
    restricts the per-repository workspaces to the given entries (after `add`). Failures
    to open a nested workspace are collected, not raised: the thread itself is fine.
    """
    opened = Opened(workspace_id=workspace_id)
    if config.thread_workspace and opened.workspace_id is None:
        opened.workspace_id = create_workspace(thread, focus=False)
        opened.created = True
    if config.repo_workspaces:
        existing = repo_workspaces(thread)
        wanted = only if only is not None else thread.worktrees
        for worktree in wanted:
            if worktree.folder in existing:
                opened.repo_workspaces[worktree.folder] = existing[worktree.folder]
                continue
            try:
                opened.repo_workspaces[worktree.folder] = open_repo_workspace(thread, worktree)
                opened.created = True
            except HerdrError as error:
                opened.failures.append(f"{worktree.folder}: {error.code}: {error.message}")
        if only is not None:
            for folder, existing_id in existing.items():
                opened.repo_workspaces.setdefault(folder, existing_id)
    if focus and opened.any:
        focus_workspace(opened.any)
    return opened


def close_repo_workspaces(thread: Thread, worktrees: list[Worktree]) -> list[str]:
    """Close the per-repository workspaces of the given entries. Returns the closed ids."""
    open_ids = repo_workspaces(thread)
    closed = []
    for worktree in worktrees:
        workspace_id = open_ids.get(worktree.folder)
        if workspace_id and close_workspace(workspace_id):
            closed.append(workspace_id)
    return closed


def focus_workspace(workspace_id: str) -> None:
    call("workspace", "focus", workspace_id)


def close_workspace(workspace_id: str) -> bool:
    """True when closed (or already gone)."""
    try:
        call("workspace", "close", workspace_id)
        return True
    except HerdrError as error:
        if "not_found" in error.code or "unknown" in error.code:
            return True
        raise


def busy_panes(*workspace_ids: str) -> list[dict]:
    wanted = set(workspace_ids)
    return [
        pane
        for pane in panes()
        if pane.get("workspace_id") in wanted and pane.get("agent_status") in ("working", "blocked")
    ]


def notify(title: str, body: str) -> None:
    try_call("notification", "show", title, "--body", body)
