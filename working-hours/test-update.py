import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from datetime import datetime, timedelta

spec = importlib.util.spec_from_file_location('hours_update', Path(__file__).with_name('update.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ExportTest(unittest.TestCase):
    def test_adjustments_continue_and_exports_have_one_total(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            day = datetime.now(module.TZ).date()
            key = day.isoformat()
            (root / 'dashboard.template.html').write_text('__WORK_DATA__')
            (root / 'working-hours-state.json').write_text(json.dumps({'totals': {key: 1}, 'estimateBaselines': {key: 3}}))
            with patch.object(module, 'ROOT', root), patch.object(module, 'read_activity', return_value=([(datetime.combine(day, datetime.min.time(), module.TZ), datetime.combine(day, datetime.min.time(), module.TZ) + timedelta(hours=4))], {day}, 1)), patch('sys.argv', ['update.py']):
                module.main()
            data = json.loads((root / 'data.json').read_text())
            self.assertEqual(data['days'][0]['hours'], 2)
            self.assertEqual(data['days'][0]['source'], 'recorded')
            self.assertEqual((root / 'daily-hours.csv').read_text().splitlines()[0], 'date,hours')
            self.assertNotIn('confirmed', (root / 'Daily-Log.md').read_text())

    def test_pause_resume_delayed_logs_midnight_and_exports(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            start = datetime(2026, 9, 16, 23, 30, tzinfo=module.TZ)
            midnight = start + timedelta(minutes=30)
            (root / 'dashboard.template.html').write_text('__WORK_DATA__')
            shared = {'revision': 1, 'totals': {'2026-09-16': .25}, 'estimateBaselines': {'2026-09-16': 0}, 'autoPaused': True, 'estimateSince': (start + timedelta(minutes=15)).timestamp() * 1000}
            path = root / 'working-hours-state.json'
            def run(end):
                path.write_text(json.dumps(shared))
                with patch.object(module, 'ROOT', root), patch.object(module, 'read_activity', return_value=([(start, end)], {start.date(), midnight.date()}, 1)), patch('sys.argv', ['update.py']):
                    module.main()
                return json.loads((root / 'data.json').read_text())
            data = run(start + timedelta(hours=2))
            totals = {d['date']: d['hours'] for d in data['days']}
            self.assertEqual(totals['2026-09-16'], .25)
            self.assertEqual(totals['2026-09-17'], 0)
            self.assertTrue(data['autoPaused'])
            self.assertEqual(json.loads(path.read_text()), shared)  # generator never writes shared state
            shared.update(autoPaused=False, estimateSince=(midnight + timedelta(minutes=45)).timestamp() * 1000)
            data = run(midnight + timedelta(hours=1, minutes=15))
            totals = {d['date']: d['hours'] for d in data['days']}
            self.assertEqual(totals['2026-09-16'], .25)
            self.assertEqual(totals['2026-09-17'], .5)
            self.assertIn('2026-09-17,0.5000', (root / 'daily-hours.csv').read_text())
            self.assertEqual(len(data['activityIntervals']), 1)
            # A delayed interval bridging the full pause adds only its post-resume tail.
            data = run(midnight + timedelta(hours=2))
            self.assertEqual(next(d['hours'] for d in data['days'] if d['date'] == '2026-09-17'), 1.25)

    def test_rereads_pause_committed_during_scan(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            start = datetime(2026, 9, 16, 12, tzinfo=module.TZ)
            path = root / 'working-hours-state.json'
            path.write_text(json.dumps({'totals': {'2026-09-16': 1}, 'estimateBaselines': {'2026-09-16': 0}}))
            (root / 'dashboard.template.html').write_text('__WORK_DATA__')
            paused = {'totals': {'2026-09-16': 2}, 'autoPaused': True, 'estimateBaselines': {'2026-09-16': 0}}
            def scan(*args):
                path.write_text(json.dumps(paused))
                return [(start, start + timedelta(hours=4))], {start.date()}, 1
            with patch.object(module, 'ROOT', root), patch.object(module, 'read_activity', side_effect=scan), patch('sys.argv', ['update.py']):
                module.main()
            self.assertEqual(json.loads((root / 'data.json').read_text())['days'][0]['hours'], 2)
            self.assertIn('2026-09-16,2', (root / 'confirmed-hours.csv').read_text())
            self.assertEqual(json.loads(path.read_text()), paused)

    def test_overlapping_sessions_are_counted_once(self):
        a = datetime(2026, 9, 16, 23, 30, tzinfo=module.TZ)
        totals = module.daily_seconds([(a, a + timedelta(hours=1)), (a + timedelta(minutes=15), a + timedelta(hours=2))])
        self.assertEqual(dict(totals), {'2026-09-16': 1800, '2026-09-17': 5400})

if __name__ == '__main__':
    unittest.main()
