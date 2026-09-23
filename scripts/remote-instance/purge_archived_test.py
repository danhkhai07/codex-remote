import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
spec = importlib.util.spec_from_file_location('purge', Path(__file__).with_name('purge-archived.py'))
purge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(purge)
A = '11111111-1111-1111-1111-111111111111'
B = '22222222-2222-2222-2222-222222222222'


class PurgeTests(unittest.TestCase):
    def seed(self, base):
        root, evidence = base / 'copy', base / 'evidence'
        evidence.mkdir()
        for d in ['native/sessions', 'native/archived_sessions', 'vault/.state/Conversations/' + A, 'vault/Conversations/' + A + '/Turns', 'vault/References', 'vault/Groups', 'hours']:
            (root / d).mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(root / 'native/state_5.sqlite')
        db.executescript('create table threads(id text primary key,rollout_path text,archived int);create table thread_spawn_edges(parent_thread_id text,child_thread_id text);')
        for tid, folder, flag in [(A, 'archived_sessions', 1), (B, 'sessions', 0)]:
            p = root / 'native' / folder / ('rollout-' + tid + '.jsonl')
            p.write_text(json.dumps({'payload': {'id': tid}, 'text': 'fake transcript'}) + '\n')
            db.execute('insert into threads values(?,?,?)', (tid, str(p), flag))
        db.execute('insert into thread_spawn_edges values(?,?)', (A, B))
        db.commit(); db.close()
        db = sqlite3.connect(root / 'native/thread_history_1.sqlite')
        db.execute('create table thread_items(thread_id text,item_json text)')
        db.executemany('insert into thread_items values(?,?)', [(A, 'archived content'), (B, 'kept content')]); db.commit(); db.close()
        for file in ['vault/.state/Conversations/' + A + '/turn.json', 'vault/Conversations/' + A + '/Turns/turn.md', 'vault/Conversations/' + A + '/Index.md']:
            (root / file).write_text('generated transcript')
        (root / 'vault/Conversations' / A / 'Context.md').write_text('useful handoff')
        (root / 'vault/References/Knowledge.md').write_text('useful note')
        (root / 'vault/.state/Conversations.json').write_text(json.dumps({A: {'name': 'archived'}, B: {'name': 'retained'}}))
        (root / 'vault/.state/Groups.json').write_text(json.dumps({'revision': 2, 'groups': [], 'assignments': {A: 'x', B: 'x'}}))
        (root / 'native/history.jsonl').write_text('\n'.join(json.dumps({'session_id': tid, 'text': 'fake'}) for tid in [A, B]) + '\n')
        (root / 'hours/data.json').write_text(json.dumps({'generated': '2026-09-22T00:00:00Z', 'activityIntervals': [[1, 2]], 'days': [{'date': '2026-09-21', 'source': 'recorded'}]}))
        return root, evidence

    def test_exact_purge_preserves_active_and_knowledge_and_aggregate(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, e = self.seed(Path(tmp))
            result = purge.purge(root, e, 1, 1)
            self.assertEqual(result['deletedConversations'], 1)
            db = sqlite3.connect(root / 'native/thread_history_1.sqlite')
            self.assertEqual(db.execute('select * from thread_items').fetchall(), [(B, 'kept content')]); db.close()
            self.assertFalse(list((root / 'native/archived_sessions').glob('*.jsonl')))
            self.assertFalse((root / 'vault/Conversations' / A / 'Index.md').exists())
            self.assertEqual((root / 'vault/Conversations' / A / 'Context.md').read_text(), 'useful handoff')
            self.assertEqual((root / 'vault/References/Knowledge.md').read_text(), 'useful note')
            self.assertNotIn(A, (root / 'native/history.jsonl').read_text())
            self.assertEqual(json.loads((root / 'hours/activity-baseline.json').read_text())['activityIntervals'], [[1, 2]])
            with self.assertRaises(ValueError): purge.purge(root, e, 1, 1)

    def test_count_drift_is_no_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, e = self.seed(Path(tmp)); p = root / 'native/state_5.sqlite'; before = p.read_bytes()
            with self.assertRaises(ValueError): purge.purge(root, e, 46, 27)
            self.assertEqual(p.read_bytes(), before)
            self.assertFalse(list(e.iterdir()))

    def test_symlink_and_active_service_abort_before_deletion(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, e = self.seed(Path(tmp)); p = root / 'native/state_5.sqlite'; before = p.read_bytes()
            def busy(): raise ValueError('busy')
            with self.assertRaises(ValueError): purge.purge(root, e, 1, 1, busy)
            self.assertEqual(p.read_bytes(), before)
            self.assertTrue((e / 'purge-plan.json').exists())
            self.assertFalse((e / 'purge-result.json').exists())
        with tempfile.TemporaryDirectory() as tmp:
            root, e = self.seed(Path(tmp)); p = next((root / 'native/archived_sessions').glob('*.jsonl')); external = Path(tmp) / 'original'; p.rename(external); p.symlink_to(external)
            before = external.read_bytes()
            with self.assertRaises(ValueError): purge.purge(root, e, 1, 1)
            self.assertEqual(external.read_bytes(), before)

    def test_open_native_descriptor_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, e = self.seed(Path(tmp))
            import subprocess
            child = subprocess.Popen(['python3', '-c', 'import sys,time; f=open(sys.argv[1]);print("ready",flush=True);time.sleep(30)', str(root / 'native/state_5.sqlite')], stdout=subprocess.PIPE)
            try:
                child.stdout.readline()
                with self.assertRaises(ValueError): purge.purge(root, e, 1, 1)
                self.assertFalse(list(e.iterdir()))
            finally:
                child.terminate(); child.wait(); child.stdout.close()


if __name__ == '__main__': unittest.main()
