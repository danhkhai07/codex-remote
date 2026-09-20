import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from datetime import datetime

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
            with patch.object(module, 'ROOT', root), patch.object(module, 'read_activity', return_value=({key: 4 * 3600}, {day}, 1)), patch('sys.argv', ['update.py']):
                module.main()
            data = json.loads((root / 'data.json').read_text())
            self.assertEqual(data['days'][0]['hours'], 2)
            self.assertEqual(data['days'][0]['source'], 'recorded')
            self.assertEqual((root / 'daily-hours.csv').read_text().splitlines()[0], 'date,hours')
            self.assertNotIn('confirmed', (root / 'Daily-Log.md').read_text())

if __name__ == '__main__':
    unittest.main()
