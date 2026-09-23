#!/usr/bin/env python3
"""Bounded one-shot OFFLINE purge of explicitly counted archived snapshot threads.

No original home/Vault writes, no model/native startup and no transcript backup.
A durable plan precedes mutation. A partial attempt requires explicit inspection;
this command will never adopt/retry an existing plan. Keep handoffs/topic notes.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import subprocess
from datetime import datetime, timezone


def digest(p):
    h = hashlib.sha256()
    with p.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def checked(root, p):
    if not p.is_relative_to(root) or p.resolve() != p:
        raise ValueError('Path outside owned snapshot or symlink')
    s = p.lstat()
    if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1:
        raise ValueError('Not an independent regular snapshot file')
    return p


def atomic(p, content, exclusive=False):
    if exclusive:
        with p.open('x') as f:
            os.chmod(p, 0o600)
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
    else:
        temp = p.with_name(p.name + '.purge-' + str(os.getpid()))
        atomic(temp, content, True)
        os.replace(temp, p)
    fd = os.open(p.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def no_users(root):
    # Native children and any process with an open copied DB/log make offline
    # surgery unsafe. The deployment lock additionally excludes other operators.
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit() or int(proc.name) == os.getpid():
            continue
        try:
            for fd in (proc / 'fd').iterdir():
                try:
                    target = os.readlink(fd)
                except FileNotFoundError:
                    continue
                if target.startswith(str(root / 'native') + '/'):
                    raise ValueError('Snapshot has an open native descriptor')
            env = (proc / 'environ').read_bytes().split(b'\0')
            if ('CODEX_HOME=' + str(root / 'native')).encode() in env:
                raise ValueError('Snapshot has a native process')
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue


def purge(root, evidence, expected_archived, expected_active, before_mutation=lambda: None):
    root, evidence = Path(root).absolute(), Path(evidence).absolute()
    if root.resolve() != root or root in [Path('/root/.codex'), Path('/root/VAULTS/Codex-Context')]:
        raise ValueError('Unsafe snapshot root')
    if evidence.resolve() != evidence or not evidence.is_dir():
        raise ValueError('Evidence directory must exist without symlinks')
    native, vault = root / 'native', root / 'vault'
    dbpath = checked(root, native / 'state_5.sqlite')
    no_users(root)
    db = sqlite3.connect(dbpath, timeout=0)
    try:
        rows = db.execute('select id,rollout_path,archived from threads order by id').fetchall()
        archived = {r[0] for r in rows if r[2] == 1}
        active = {r[0] for r in rows if r[2] == 0}
        if len(archived) != expected_archived or len(active) != expected_active or len(rows) != len(archived | active):
            raise ValueError('Snapshot counts changed')
        if not all(re.fullmatch(r'[0-9a-f-]{36}', x) for x in archived | active):
            raise ValueError('Invalid thread identity')
        ids = sorted(archived)
        remove = set()
        kept = {}
        for tid, rollout, flag in rows:
            p = checked(root, Path(rollout))
            if not (p.is_relative_to(native / 'sessions') or p.is_relative_to(native / 'archived_sessions')):
                raise ValueError('Unexpected rollout tree')
            if flag:
                remove.add(p)
            else:
                kept[str(p)] = digest(p)
        for directory in [native / 'sessions', native / 'archived_sessions']:
            for p in directory.rglob('*.jsonl'):
                checked(root, p)
                if any(p.stem.endswith('-' + tid) for tid in ids):
                    remove.add(p)
        for tid in ids:
            generated = [vault / 'Conversations' / tid / 'Index.md']
            for folder in [vault / 'Conversations' / tid / 'Turns', vault / '.state/Conversations' / tid]:
                if folder.exists():
                    generated.extend(p for p in folder.rglob('*') if not p.is_dir())
            for p in generated:
                if p.exists():
                    remove.add(checked(root, p))
        rewrites = {}
        for name, key in [('history.jsonl', 'session_id'), ('session_index.jsonl', 'id')]:
            p = native / name
            if p.exists():
                checked(root, p)
                lines = []
                with p.open() as f:
                    for line in f:
                        if len(line) > 16 * 1024 * 1024:
                            raise ValueError('Oversize index record')
                        if json.loads(line).get(key) not in archived:
                            lines.append(line)
                rewrites[p] = ''.join(lines)
        p = vault / '.state/Conversations.json'
        if p.exists():
            value = json.loads(checked(root, p).read_text())
            rewrites[p] = json.dumps({k: v for k, v in value.items() if k not in archived}, indent=2) + '\n'
        p = vault / '.state/Groups.json'
        if p.exists():
            value = json.loads(checked(root, p).read_text())
            value['assignments'] = {k: v for k, v in value.get('assignments', {}).items() if k not in archived}
            value['revision'] += 1
            rewrites[p] = json.dumps(value, indent=2) + '\n'
        for p in [vault / 'Sources.md', *list((vault / 'Groups').glob('*/Index.md'))]:
            if p.exists():
                rewrites[p] = ''.join(line for line in checked(root, p).read_text().splitlines(True) if not any(tid in line for tid in ids))
        attached = ['main']
        for alias, name in [('history', 'thread_history_1.sqlite'), ('memory', 'memories_1.sqlite')]:
            p = native / name
            if p.exists():
                checked(root, p)
                db.execute('attach database ? as ' + alias, (str(p),))
                attached.append(alias)
        # Enumerate schema association columns, not assumed FK cascades. Unknown
        # associated columns are rejected below instead of leaving hidden history.
        deletes = []
        preserve_rows = {}
        for alias in attached:
            db.execute('pragma ' + alias + '.secure_delete=ON')
            for (table,) in db.execute('select name from ' + alias + '.sqlite_master where type="table"'):
                cols = [c[1] for c in db.execute('pragma ' + alias + '.table_info("' + table + '")')]
                association = [c for c in cols if c in ['thread_id', 'parent_thread_id', 'child_thread_id']]
                if alias == 'main' and table == 'threads':
                    association.append('id')
                if not association:
                    continue
                predicate = ' or '.join('"' + c + '" in (' + ','.join('?' for _ in ids) + ')' for c in association)
                values = ids * len(association)
                qualified = alias + '."' + table + '"'
                count = db.execute('select count(*) from ' + qualified + ' where ' + predicate, values).fetchone()[0]
                deletes.append((qualified, predicate, values, count))
                h = hashlib.sha256()
                for row in db.execute('select * from ' + qualified + ' where not (' + predicate + ') order by rowid', values):
                    h.update(repr(row).encode())
                preserve_rows[qualified] = h.hexdigest()
        baseline = root / 'hours/activity-baseline.json'
        data = json.loads(checked(root, root / 'hours/data.json').read_text())
        baseline_text = json.dumps({'version': 1, 'capturedAt': data['generated'], 'reason': 'Preserve timestamp-only aggregate before archived snapshot purge; no conversation content', 'activityIntervals': data['activityIntervals'], 'observedDays': [d['date'] for d in data['days'] if d['source'] != 'unknown']}, indent=2) + '\n'
        plan = {'version': 1, 'status': 'planned', 'at': datetime.now(timezone.utc).isoformat(), 'root': str(root), 'archived': ids, 'keptThreads': sorted(active), 'keptRolloutHashes': kept, 'deletedFiles': {str(p): digest(p) for p in sorted(remove)}, 'rewrites': {str(p): {'before': digest(p), 'after': hashlib.sha256(s.encode()).hexdigest()} for p, s in rewrites.items()}, 'databaseDeletes': {q: c for q, _p, _v, c in deletes}, 'preservedRows': preserve_rows}
        if baseline.exists():
            raise ValueError('Prior baseline present; inspect prior attempt')
        atomic(evidence / 'purge-plan.json', json.dumps(plan, indent=2) + '\n', True)
        before_mutation()
        no_users(root)
        atomic(baseline, baseline_text, True)
        db.execute('pragma foreign_keys=ON')
        db.execute('BEGIN EXCLUSIVE')
        for q, p, v, count in deletes:
            cursor = db.execute('delete from ' + q + ' where ' + p, v)
            # Foreign-key cascades may have removed a child table already.
            if cursor.rowcount > count:
                raise ValueError('Database changed after plan')
        db.commit()
        for alias in attached:
            db.execute('VACUUM ' + alias)
            if db.execute('pragma ' + alias + '.integrity_check').fetchone()[0] != 'ok' or db.execute('pragma ' + alias + '.foreign_key_check').fetchall():
                raise ValueError('Database integrity failed')
        for p in sorted(remove):
            if digest(checked(root, p)) != plan['deletedFiles'][str(p)]:
                raise ValueError('Delete target changed')
            p.unlink()
        for p, s in rewrites.items():
            if digest(checked(root, p)) != plan['rewrites'][str(p)]['before']:
                raise ValueError('Rewrite target changed')
            atomic(p, s)
        for p, sha in kept.items():
            if digest(Path(p)) != sha:
                raise ValueError('Retained rollout changed')
        for q, p, v, _count in deletes:
            h = hashlib.sha256()
            for row in db.execute('select * from ' + q + ' where not (' + p + ') order by rowid', v):
                h.update(repr(row).encode())
            if h.hexdigest() != preserve_rows[q]:
                raise ValueError('Retained database rows changed')
        if db.execute('select archived,count(*) from threads group by archived').fetchall() != [(0, expected_active)]:
            raise ValueError('Unexpected final conversation count')
        result = {'status': 'complete', 'at': datetime.now(timezone.utc).isoformat(), 'deletedConversations': len(ids), 'remainingConversations': len(active), 'deletedFiles': len(remove), 'nativeDatabaseIntegrity': True, 'retainedRolloutsAndRowsUnchanged': True, 'usefulNotesPreserved': True, 'hoursAggregateBaseline': digest(baseline), 'planSha256': digest(evidence / 'purge-plan.json')}
        atomic(evidence / 'purge-result.json', json.dumps(result, indent=2) + '\n', True)
        return result
    finally:
        db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    parser.add_argument('--evidence', required=True)
    parser.add_argument('--expected-archived', type=int, required=True)
    parser.add_argument('--expected-active', type=int, required=True)
    args = parser.parse_args()
    # Production use remains fixed to the authorized independent snapshot.
    if args.root != '/root/.local/state/codex-remote-secure':
        raise SystemExit('CLI is restricted to the authorized new snapshot')
    def inactive():
        for unit in ['codex-remote-secure.service', 'codex-remote-secure-hours.service', 'codex-remote-secure-hours.timer']:
            if subprocess.check_output(['systemctl', 'show', unit, '-p', 'ActiveState', '--value'], text=True).strip() != 'inactive':
                raise ValueError('New service/timer must be inactive')
    inactive()
    print(json.dumps(purge(args.root, args.evidence, args.expected_archived, args.expected_active, inactive)))
