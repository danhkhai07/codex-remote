import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
spec = importlib.util.spec_from_file_location('snapshot', Path(__file__).with_name('snapshot.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SnapshotTests(unittest.TestCase):
    def test_independent_prefix_database_and_no_automatic_jobs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            native, vault, hours, out = [root / name for name in ['old-native', 'old-vault', 'old-hours', 'new']]
            for p in [native / 'sessions', vault / '.state', vault / 'Conversations/test/.orchestration', hours]:
                p.mkdir(parents=True)
            log = native / 'sessions/fixture.jsonl'
            log.write_bytes(b'{"complete":true}\n{"partial":')
            config = native / 'config.toml'
            config.write_text('model = "FAKE"\n')
            (native / 'rules').mkdir()
            executable = native / 'rules/tool.sh'
            executable.write_text('#!/bin/sh\nexit 0\n')
            executable.chmod(0o755)
            with sqlite3.connect(native / 'state_5.sqlite') as db:
                db.execute('CREATE TABLE threads(id TEXT, rollout_path TEXT)')
                db.execute('INSERT INTO threads VALUES (?,?)', ('test', str(log)))
                db.execute('CREATE TABLE remote_control_enrollments(value TEXT)')
                db.execute("INSERT INTO remote_control_enrollments VALUES ('FAKE old registration')")
            with sqlite3.connect(native / 'queue_1.sqlite') as db:
                db.execute('CREATE TABLE pending(value TEXT)')
                db.execute("INSERT INTO pending VALUES ('DO NOT REPLAY')")
            original = b'{"version":1,"tasks":[{"status":"running","result":"FAKE evidence"}]}'
            (vault / '.state/Orchestration.json').write_bytes(original)
            (vault / 'Conversations/test/.orchestration/request.json').write_text('DO NOT REPLAY')
            (vault / 'Shared').mkdir()
            (vault / 'Shared/Context.md').write_text('FAKE shared notes')
            (hours / 'working-hours-state.json').write_text('{"revision":7,"totals":{},"timer":null}')
            before = {str(p): p.read_bytes() for p in root.rglob('*') if p.is_file()}
            result = module.prepare(native, vault, hours, out)
            self.assertEqual(result['nativeThreads'], 1)
            self.assertEqual((out / 'native/sessions/fixture.jsonl').read_bytes(), b'{"complete":true}\n')
            self.assertNotEqual(log.stat().st_ino, (out / 'native/sessions/fixture.jsonl').stat().st_ino)
            self.assertEqual((out / 'native/rules/tool.sh').stat().st_mode & 0o777, 0o700)
            self.assertEqual((out / 'archive/Orchestration.json').read_bytes(), original)
            self.assertEqual(json.loads((out / 'vault/.state/Orchestration.json').read_text())['tasks'], [])
            self.assertFalse((out / 'native/queue_1.sqlite').exists())
            self.assertTrue((out / 'archive/native-operational/queue_1.sqlite').exists())
            self.assertFalse((out / 'vault/Conversations/test/.orchestration').exists())
            with sqlite3.connect(out / 'native/state_5.sqlite') as db:
                self.assertEqual(db.execute('SELECT rollout_path FROM threads').fetchone()[0], str(out / 'native/sessions/fixture.jsonl'))
                self.assertEqual(db.execute('SELECT count(*) FROM remote_control_enrollments').fetchone()[0], 0)
            for p, content in before.items():
                self.assertEqual(Path(p).read_bytes(), content)
            with self.assertRaises(ValueError):
                module.prepare(native, vault, hours, out)

    def test_rejects_symlink_source_and_overlap(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ['native', 'vault', 'hours']:
                (root / name).mkdir()
            with self.assertRaises(ValueError):
                module.prepare(root / 'native', root / 'vault', root / 'hours', root / 'native/child')
            original = root / 'file'
            original.write_text('FAKE')
            (root / 'link').symlink_to(original)
            snapshot = module.Snapshot(root / 'new')
            with self.assertRaises(ValueError):
                snapshot.copy(root / 'link', 'copied')


if __name__ == '__main__':
    os.umask(0o077)
    unittest.main()
