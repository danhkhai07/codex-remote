"""Local-only browser smoke for the production UC worker (no Facebook traffic)."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import threading


class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/':
            body = '<input name="email"><input name="pass" type="password"><button>Log in</button>'
        elif self.path == '/captcha':
            body = '<p>Complete a challenge to verify</p><iframe src="/frame"></iframe>'
        elif self.path == '/frame':
            body = '<p>Challenge frame</p>'
        elif self.path == '/code':
            body = '<p>Enter your authenticator app code</p><input autocomplete="one-time-code" maxlength="6">'
        else:
            self.send_error(404)
            return
        encoded = body.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, *_):
        pass


def main():
    with TemporaryDirectory(prefix='fb-uc-smoke-') as state:
        server = ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            root = f'http://127.0.0.1:{server.server_port}'
            env = {**os.environ, 'FB_SESSION_STATE_DIR': state, 'FB_SESSION_DRY_RUN': '1',
                   'FB_SESSION_TEST_URL': root + '/'}
            worker_path = Path(__file__).with_name('worker_uc.py')
            result = subprocess.run([sys.executable, str(worker_path), 'login'], input='{}',
                                    text=True, capture_output=True, env=env, timeout=60)
            events = [json.loads(line) for line in result.stdout.splitlines()]
            assert result.returncode == 0, events
            assert events[-1]['phase'] == 'Login form ready', events
            assert not (Path(state) / 'storage-state.json').exists()
            assert (Path(state) / 'browser-profile').exists()
            env['FB_SESSION_TEST_URL'] = root + '/code'
            resumed = subprocess.run([sys.executable, str(worker_path), 'login'], input='{}',
                                     text=True, capture_output=True, env=env, timeout=60)
            resumed_events = [json.loads(line) for line in resumed.stdout.splitlines()]
            assert resumed.returncode == 0, resumed_events
            assert resumed_events[-1]['phase'] == 'Current stage: two-factor', resumed_events
            assert not (Path(state) / 'storage-state.json').exists()
            os.environ['FB_SESSION_STATE_DIR'] = state
            spec = importlib.util.spec_from_file_location('worker_uc', worker_path)
            worker = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(worker)
            browser = worker.browser()
            try:
                browser.get(root + '/code')
                kind, selected = worker.detect(browser)
                assert kind == 'two-factor', (kind, selected)
                assert selected[1] == ('single', [0]), selected
                browser.get(root + '/captcha')
                assert worker.detect(browser)[0] == 'captcha'
            finally:
                browser.quit()
            print('UC browser: login form, 2FA and CAPTCHA classified; no account submitted or session marked ready')
        finally:
            server.shutdown()
            thread.join()


if __name__ == '__main__':
    main()
