#!/usr/bin/env python3
"""Materialize the pinned core and Sprig patches in a new, non-production checkout."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def run(args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True)


def prepare(destination):
    destination = Path(destination).expanduser().absolute()
    if destination.exists():
        raise FileExistsError(f'Refusing to modify an existing checkout: {destination}')
    metadata = json.loads((ROOT / 'sprig/upstreams.json').read_text())['core']
    patches = metadata['sprig_patches']
    checked = []
    for patch in patches:
        path = ROOT / patch['path']
        content = path.read_bytes()
        if hashlib.sha256(content).hexdigest() != patch['sha256']:
            raise ValueError(f'Patch checksum does not match provenance: {path}')
        directory = patch['directory']
        if directory not in ('.', 'vendor/ghostty'):
            raise ValueError(f'Unexpected patch directory: {directory}')
        checked.append((directory, path))
    run(['git', 'init', str(destination)])
    run(['git', 'remote', 'add', 'origin', metadata['upstream']], destination)
    run(['git', 'fetch', '--depth=1', 'origin', metadata['revision']], destination)
    run(['git', 'checkout', '--detach', 'FETCH_HEAD'], destination)
    run(['git', 'submodule', 'update', '--init', '--depth=1', 'vendor/ghostty'], destination)
    renderer = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=destination / 'vendor/ghostty', text=True).strip()
    if renderer != metadata['ghostty_revision']:
        raise ValueError(f'Core renderer pin differs from the patch baseline: {renderer}')
    for directory, patch in checked:
        run(['git', 'apply', '--check', str(patch)], destination / directory)
        run(['git', 'apply', str(patch)], destination / directory)
    print(json.dumps({'source': str(destination), 'base': metadata['revision'], 'patches': patches}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', help='new checkout directory; existing paths are never modified')
    prepare(parser.parse_args().destination)
