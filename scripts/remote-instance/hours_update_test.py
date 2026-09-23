import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
spec = importlib.util.spec_from_file_location('adapter', Path(__file__).with_name('hours-update.py'))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
generator = Path(__file__).resolve().parents[2] / 'working-hours/update.py'


class HoursTests(unittest.TestCase):
    def test_exact_algorithm_reads_only_owned_native_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for p in [root / 'native/sessions', root / 'native/archived_sessions', root / 'hours']:
                p.mkdir(parents=True)
            records = [{'timestamp': stamp, 'type': 'response_item', 'payload': {}} for stamp in ['2026-09-22T00:00:00Z', '2026-09-22T00:30:00Z']]
            (root / 'native/sessions/fake.jsonl').write_text(''.join(json.dumps(r) + '\n' for r in records))
            module = adapter.load(generator, root / 'native', root / 'hours')
            intervals, _days, count = module.read_activity(module.datetime.fromisoformat('2026-09-22T01:00:00+00:00'))
            self.assertEqual(count, 1)
            self.assertEqual(sum((b - a).total_seconds() for a, b in intervals), 1800)
            self.assertEqual(module.ROOT, root / 'hours')
            self.assertEqual(module.read_activity.__code__, module.read_activity.__globals__['read_activity'].__code__)

    def test_rejects_unreviewed_generator(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fake = root / 'fake.py'
            fake.write_text('raise Exception("must not execute")')
            with self.assertRaises(ValueError):
                adapter.load(fake, root, root)

    def test_timestamp_only_baseline_survives_purge_without_double_counting(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for p in [root / 'native/sessions', root / 'native/archived_sessions', root / 'hours']:
                p.mkdir(parents=True)
            records = [{'timestamp': stamp, 'type': 'response_item', 'payload': {}} for stamp in ['2026-09-22T00:15:00Z', '2026-09-22T00:45:00Z']]
            (root / 'native/sessions/active.jsonl').write_text(''.join(json.dumps(r) + '\n' for r in records))
            from datetime import datetime
            start = int(datetime.fromisoformat('2026-09-22T00:00:00+00:00').timestamp() * 1000)
            (root / 'hours/activity-baseline.json').write_text(json.dumps({'version': 1, 'activityIntervals': [[start, start + 1800000]], 'observedDays': ['2026-09-22']}))
            module = adapter.load(generator, root / 'native', root / 'hours')
            intervals, days, count = module.read_activity(module.datetime.fromisoformat('2026-09-22T01:00:00+00:00'))
            self.assertEqual(count, 1)
            self.assertEqual(sum((b - a).total_seconds() for a, b in intervals), 2700)
            self.assertEqual(len(days), 1)


if __name__ == '__main__':
    unittest.main()
