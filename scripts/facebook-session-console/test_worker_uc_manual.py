"""End-to-end manual CAPTCHA control using a local page and real UC browser."""

import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import select
import subprocess
import sys
from tempfile import TemporaryDirectory
import threading
import time


class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/':
            body = """<input name='email'><input name='pass' type='password'>
            <button onclick="location.href='/captcha'">Log in</button>"""
        elif self.path == '/captcha':
            body = """<p>Complete a challenge to verify</p>
            <button style='position:fixed;left:100px;top:100px;width:120px;height:80px'
              onclick="location.href='/two_step_verification/two_factor/'">Solve puzzle</button>"""
        elif self.path == '/two_step_verification/two_factor/':
            body = '<p>Enter your authenticator app code</p><input autocomplete="one-time-code" maxlength="6"><button>Continue</button>'
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
    with TemporaryDirectory(prefix='fb-uc-manual-') as state:
        server = ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        process = None
        try:
            env = {**os.environ, 'FB_SESSION_STATE_DIR': state,
                   'FB_SESSION_TEST_URL': f'http://127.0.0.1:{server.server_port}/'}
            process = subprocess.Popen([sys.executable, str(Path(__file__).with_name('worker_uc.py')), 'login'],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.DEVNULL, env=env)
            config = {'account': 'fixture', 'password': 'fixture',
                      'totpSecret': 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
                      'captchaKey': '', 'manualCaptcha': True}
            process.stdin.write((json.dumps(config) + '\n').encode())
            process.stdin.flush()
            deadline = time.monotonic() + 65
            seen = []
            clicked = False
            while time.monotonic() < deadline:
                ready, _, _ = select.select([process.stdout], [], [], 1)
                if not ready:
                    if process.poll() is not None:
                        break
                    continue
                event = json.loads(process.stdout.readline())
                if 'phase' in event:
                    seen.append(event['phase'])
                if event.get('frame') and not clicked:
                    image = base64.b64decode(event['frame'])
                    assert image[:3] == b'\xff\xd8\xff'
                    process.stdin.write(b'{"type":"click","x":150,"y":135}\n')
                    process.stdin.flush()
                    clicked = True
                if '2FA code form detected' in seen:
                    break
            assert 'Solve CAPTCHA in this page' in seen, seen
            assert clicked, seen
            assert '2FA code form detected' in seen, seen
            assert not (Path(state) / 'storage-state.json').exists()
            print('Manual CAPTCHA: browser frame streamed; owner click advanced local challenge to 2FA; no paid task')
        finally:
            if process and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            server.shutdown()
            thread.join()


if __name__ == '__main__':
    main()
