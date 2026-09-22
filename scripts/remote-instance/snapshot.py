#!/usr/bin/env python3
"""Prepare a NEW independent state copy. Never opens the source for writing.

This is not a globally atomic snapshot of a running app. SQLite backup transactions
and complete JSONL prefixes have individual capture times. Old jobs remain old.
No model, gateway, timer or native scheduler is started by this tool.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat
import time

MAX_TOTAL = 2 * 1024**3
CHUNK = 1024**2


class Snapshot:
    def __init__(self, output):
        self.output = Path(output).absolute()
        if self.output.exists() or self.output.is_symlink():
            raise ValueError('New snapshot directory required')
        if self.output.parent.resolve(strict=True) != self.output.parent:
            raise ValueError('Snapshot parent must be canonical')
        self.output.mkdir(mode=0o700)
        self.bytes = 0
        self.files = []
        self.skipped_runtime = []

    def copy(self, source, relative, jsonl=False):
        source = Path(source)
        if source.is_symlink():
            raise ValueError('Symlink source must be reviewed explicitly')
        target = self.output / relative
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        src = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            meta = os.fstat(src)
            if not stat.S_ISREG(meta.st_mode):
                raise ValueError('Nonregular snapshot source')
            if self.bytes + meta.st_size > MAX_TOTAL:
                raise ValueError('Snapshot exceeds bounded copy limit')
            digest = hashlib.sha256()
            last_line = count = 0
            with open(target, 'xb') as dest:
                os.chmod(target, 0o700 if meta.st_mode & 0o111 else 0o600)
                remaining = meta.st_size
                while remaining:
                    chunk = os.read(src, min(CHUNK, remaining))
                    if not chunk:
                        raise ValueError('Source truncated during snapshot')
                    remaining -= len(chunk)
                    dest.write(chunk)
                    if jsonl:
                        newline = chunk.rfind(b'\n')
                        if newline >= 0:
                            last_line = count + newline + 1
                    count += len(chunk)
                if jsonl:
                    dest.truncate(last_line)
                    count = last_line
                dest.flush()
                os.fsync(dest.fileno())
            after = os.fstat(src)
            if (after.st_dev, after.st_ino) != (meta.st_dev, meta.st_ino) or after.st_size < meta.st_size:
                raise ValueError('Source identity/size changed while copying')
            if not jsonl and (after.st_mtime_ns != meta.st_mtime_ns or after.st_size != meta.st_size):
                raise ValueError('Mutable non-log source changed; take a new snapshot')
            with open(target, 'rb') as result:
                for chunk in iter(lambda: result.read(CHUNK), b''):
                    digest.update(chunk)
            self.bytes += count
            self.files.append({'path': str(relative), 'bytes': count, 'sha256': digest.hexdigest(),
                               'sourceSize': meta.st_size, 'jsonlCompletePrefix': jsonl,
                               'sourceMode': stat.S_IMODE(meta.st_mode),
                               'sourceMtimeNs': meta.st_mtime_ns, 'capturedAt': time.time()})
        finally:
            os.close(src)

    def tree(self, source, relative, skip=None):
        source = Path(source)
        if source.is_symlink():
            raise ValueError('Symlink directory source')
        for item in sorted(source.iterdir()):
            local = Path(relative) / item.name
            if skip and skip(item, local):
                self.skipped_runtime.append(str(local))
                continue
            if item.is_symlink():
                raise ValueError('Symlink source must be reviewed explicitly')
            if item.is_dir():
                (self.output / local).mkdir(parents=True, exist_ok=True, mode=0o700)
                self.tree(item, local, skip)
            else:
                self.copy(item, local, jsonl=item.suffix == '.jsonl')

    def database(self, source, relative):
        source = Path(source)
        if source.is_symlink():
            raise ValueError('Symlink database')
        target = self.output / relative
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        start = time.monotonic()

        def progress(_status, _remaining, _pages):
            if time.monotonic() - start > 60:
                raise TimeoutError('SQLite backup timed out')

        with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as src:
            src.execute('PRAGMA query_only=ON')
            with sqlite3.connect(target) as dest:
                src.backup(dest, pages=128, progress=progress, sleep=0.05)
                if dest.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                    raise ValueError('SQLite snapshot integrity failed')
        os.chmod(target, 0o600)
        self.bytes += target.stat().st_size
        if self.bytes > MAX_TOTAL:
            raise ValueError('Snapshot exceeds bounded copy limit')


def prepare(native, vault, hours, output):
    native, vault, hours = (Path(p).absolute() for p in (native, vault, hours))
    for p in (native, vault, hours):
        if not p.is_dir() or p.is_symlink() or p.resolve() != p:
            raise ValueError('Sources must be canonical directories')
    output = Path(output).absolute()
    if any(output == p or p in output.parents or output in p.parents for p in (native, vault, hours)):
        raise ValueError('Source/destination overlap')
    snapshot = Snapshot(output)
    started = time.time()
    for name in ['config.toml', 'auth.json', 'models_cache.json', 'history.jsonl', 'session_index.jsonl']:
        if (native / name).exists():
            snapshot.copy(native / name, Path('native') / name, jsonl=name.endswith('.jsonl'))
    for name in ['sessions', 'archived_sessions', 'skills', 'rules', 'plugins']:
        if (native / name).exists():
            snapshot.tree(native / name, Path('native') / name,
                          lambda p, _: p.name in {'.remote-plugin-install-staging', '.git'})
    for source in sorted(native.glob('*.sqlite')):
        # Queues/goals/enrollments are never automatically resumed in a second controller.
        category = 'native' if source.name in ['state_5.sqlite', 'thread_history_1.sqlite', 'memories_1.sqlite'] else 'archive/native-operational'
        snapshot.database(source, Path(category) / source.name)
    state = output / 'native/state_5.sqlite'
    rewritten = 0
    with sqlite3.connect(state) as db:
        for thread, old in db.execute('SELECT id, rollout_path FROM threads').fetchall():
            original = Path(old)
            if not original.is_absolute() or native not in original.parents:
                raise ValueError('Native rollout points outside the source home')
            local = original.relative_to(native)
            target = output / 'native' / local
            if not target.is_file():
                raise ValueError('Missing captured native rollout')
            db.execute('UPDATE threads SET rollout_path=? WHERE id=?', (str(target), thread))
            rewritten += 1
        # Remote enrollment ownership must not duplicate the original native instance.
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if 'remote_control_enrollments' in tables:
            db.execute('DELETE FROM remote_control_enrollments')
    config = output / 'native/config.toml'
    if config.exists():
        import tomllib
        parsed = tomllib.loads(config.read_text())
        if 'sqlite_home' in parsed:
            raise ValueError('Explicit sqlite_home requires reviewed rewrite')
        config.write_text('sqlite_home = ' + json.dumps(str(output / 'native')) + '\n' + config.read_text())
    snapshot.tree(vault, 'vault', lambda p, local: p.name in {'.orchestration', '.orchestration.sock'}
                  or str(local) == 'vault/.state/Orchestration.json')
    old_orchestration = vault / '.state/Orchestration.json'
    if old_orchestration.exists():
        snapshot.copy(old_orchestration, 'archive/Orchestration.json')
    (output / 'vault/.state').mkdir(parents=True, exist_ok=True, mode=0o700)
    (output / 'vault/.state/Orchestration.json').write_text(json.dumps({'version': 1, 'tasks': [], 'notices': [], 'paused': [], 'cycles': {}}) + '\n')
    # Separate totals/timers; copy preserves evidence, no pause/resume is executed.
    for name in ['working-hours-state.json', 'data.json', 'update.py', 'dashboard.template.html']:
        if (hours / name).exists():
            snapshot.copy(hours / name, Path('hours') / name)
    result = {'kind': 'isolated-state-snapshot-not-active', 'startedAt': started, 'finishedAt': time.time(),
              'nativeThreads': rewritten, 'bytesCopied': snapshot.bytes, 'sourceCopyObservations': snapshot.files,
              'skippedRuntime': snapshot.skipped_runtime, 'native': str(output / 'native'), 'vault': str(output / 'vault'),
              'originalJobsContinueOnlyOnOldInstance': True, 'copiedOperationalStateIsArchiveOnly': True,
              'globallyAtomic': False, 'automaticSynchronization': False,
              'activationReady': False, 'remaining': ['owner-key boundary', 'native credential/config check',
                  'Use the reviewed hours-update.py instance adapter; do not run the original generator directly']}
    (output / 'snapshot.json').write_text(json.dumps(result, indent=2) + '\n')
    return {k: result[k] for k in ['kind', 'nativeThreads', 'bytesCopied', 'activationReady', 'remaining']}


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ['native', 'vault', 'hours', 'output']:
        parser.add_argument('--' + arg, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.native, args.vault, args.hours, args.output), indent=2))
