import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('stage', Path(__file__).with_name('workboard-stage.py'))
stage = importlib.util.module_from_spec(spec); spec.loader.exec_module(stage)
# Reuse accepted fake seed and 10 unit controls; never imports/runs the live file.
candidate = Path('/root/WORKTREES/workboard-isolated-preview')
temp = tempfile.TemporaryDirectory()
root = Path(temp.name)
(root / 'server.py').write_text(stage.render((candidate / 'server.py').read_bytes()))
shutil.copytree(candidate / 'tests', root / 'tests', ignore=shutil.ignore_patterns('__pycache__'))
shutil.copytree(candidate / 'public', root / 'public')
spec = importlib.util.spec_from_file_location('accepted_tests', root / 'tests/test_server.py')
accepted = importlib.util.module_from_spec(spec); spec.loader.exec_module(accepted)
app = accepted.app


class CompatibilityTests(accepted.WorkboardTests):
    def test_old_and_isolated_origins_both_login_save_logout_no_csrf_bypass(self):
        with patch.dict(os.environ, {'WORKBOARD_ORIGIN': 'https://codex.danhkhai.io.vn', 'WORKBOARD_ISOLATED_PREVIEW': '1'}):
            for origin in ['https://codex.danhkhai.io.vn', self.origin]:
                status, session, headers = self.request('login', 'POST', {'password': 'test-private-password-123'}, {'Origin': origin})
                self.assertEqual(status, 200)
                auth = {'Origin': origin, 'Cookie': headers['Set-Cookie'].split(';')[0], 'X-CSRF-Token': session['csrf']}
                state = self.request('state', headers=auth)[1]
                self.assertEqual(self.request('state', 'PUT', state, {**auth, 'X-CSRF-Token': ''})[0], 403)
                self.assertEqual(self.request('state', 'PUT', state, auth)[0], 200)
                self.assertEqual(self.request('logout', 'POST', {}, auth)[0], 200)
            for origin in ['https://remote.danhkhai.io.vn', 'https://p5180.danhkhai.io.vn', 'http://localhost:' + str(self.port), self.origin + '/']:
                self.assertEqual(self.request('login', 'POST', {'password': 'test-private-password-123'}, {'Origin': origin})[0], 403)
            self.assertEqual(self.request('login', 'POST', {'password': 'test-private-password-123'}, {'Origin': self.origin, 'Sec-Fetch-Site': 'cross-site'})[0], 403)
        with patch.dict(os.environ, {'WORKBOARD_ORIGIN': 'https://codex.danhkhai.io.vn', 'WORKBOARD_ISOLATED_PREVIEW': '0'}):
            self.assertEqual(self.request('login', 'POST', {'password': 'test-private-password-123'})[0], 403)


if __name__ == '__main__':
    try: unittest.main()
    finally: temp.cleanup()
