import importlib.util
from pathlib import Path
import json
import tempfile
import unittest
from unittest import mock


spec = importlib.util.spec_from_file_location('worker_uc', Path(__file__).with_name('worker_uc.py'))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WorkerTests(unittest.TestCase):
    def test_session_marker_requires_fresh_browser_check(self):
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(worker, 'SESSION_FILE', Path(directory) / 'storage-state.json'):
                first, second = mock.Mock(), mock.Mock()
                with mock.patch.object(worker, 'browser', return_value=second), mock.patch.object(worker, 'detect', return_value=('login', None)):
                    self.assertFalse(worker.save_verified_session(first))
                self.assertFalse(worker.SESSION_FILE.exists())
                with mock.patch.object(worker, 'browser', return_value=second), mock.patch.object(worker, 'detect', return_value=('authenticated', None)):
                    self.assertTrue(worker.save_verified_session(first))
                marker = json.loads(worker.SESSION_FILE.read_text())
                self.assertEqual(marker['engine'], 'undetected-chromedriver')
                self.assertEqual(worker.SESSION_FILE.stat().st_mode & 0o777, 0o600)
                self.assertNotIn('cookies', marker)

    def test_totp_and_stage_precedence(self):
        self.assertEqual(worker.totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59), '287082')
        self.assertEqual(worker.classify({'captcha': True, 'code_step': True, 'code': True}), 'captcha')
        self.assertEqual(worker.classify({'identity': True, 'captcha': True}), 'identity')
        self.assertEqual(worker.classify({'code_step': True, 'code': False}), 'two-factor-loading')
        self.assertEqual(worker.classify({'has_cookies': True}), 'unknown')

    def test_code_input_selection(self):
        empty = {'type': 'text', 'name': '', 'id': '', 'placeholder': '', 'aria-label': '',
                 'autocomplete': '', 'inputmode': '', 'maxlength': -1, 'disabled': False, 'readonly': False}
        self.assertEqual(worker.select_code_inputs([{**empty, 'name': 'email'}, empty]), ('single', [1]))
        self.assertEqual(worker.select_code_inputs([{**empty, 'name': 'approvals_code', 'maxlength': 6}, empty]), ('single', [0]))
        self.assertEqual(worker.select_code_inputs([{**empty, 'maxlength': 1}] * 6), ('segmented', list(range(6))))
        self.assertIsNone(worker.select_code_inputs([empty, empty]))

    def test_captcha_poll_keeps_original_task_id(self):
        replies = [
            {'taskId': 98},
            {'status': 'processing'},
            {'status': 'ready', 'solution': {'token': 'fixture'}},
        ]
        seen = []

        def post(url, json, timeout):
            seen.append((url, json))
            response = mock.Mock()
            response.json.return_value = replies.pop(0)
            return response

        with mock.patch.object(worker.requests, 'post', side_effect=post), mock.patch.object(worker.time, 'sleep'):
            value = {'url': 'https://www.facebook.com/', 'public_key': '11111111-1111-1111-1111-111111111111',
                     'user_agent': 'fixture', 'subdomain': None, 'data': None}
            self.assertEqual(worker.solve_captcha('fixture-key', value), 'fixture')
        self.assertEqual(len(seen), 3)
        self.assertEqual(seen[1][1]['taskId'], 98)
        self.assertEqual(seen[2][1]['taskId'], 98)


if __name__ == '__main__':
    unittest.main()
