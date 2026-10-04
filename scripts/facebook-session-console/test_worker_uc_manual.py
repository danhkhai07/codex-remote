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
            body = """<p>Enter your authenticator app code</p>
            <input autocomplete='one-time-code' maxlength='6' style='position:fixed;left:100px;top:100px;width:150px;height:40px'>
            <button style='position:fixed;left:100px;top:160px' onclick="if(document.querySelector('input').value.length===6)location.href='/checkpoint/email'">Continue</button>"""
        elif self.path == '/checkpoint/email':
            body = """<p>We sent a code to your email</p>
            <input style='position:fixed;left:100px;top:100px;width:150px;height:40px'>
            <button style='position:fixed;left:100px;top:160px' onclick="if(document.querySelector('input').value.length===6)location.href='/done'">Continue</button>"""
        elif self.path in ('/done', '/watch/'):
            body = '<button aria-label="Account">Account</button>'
        else:
            self.send_error(404)
            return
        encoded = body.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(encoded)))
        if self.path == '/done':
            self.send_header('Set-Cookie', 'c_user=fixture; Path=/; Max-Age=3600')
            self.send_header('Set-Cookie', 'xs=fixture; Path=/; Max-Age=3600')
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
                   'FB_SESSION_TEST_URL': f'http://127.0.0.1:{server.server_port}/',
                   'FB_SESSION_TEST_ORIGIN': f'http://127.0.0.1:{server.server_port}'}
            process = subprocess.Popen([sys.executable, str(Path(__file__).with_name('worker_uc.py')), 'login'],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, env=env)
            config = {'account': 'fixture', 'password': 'fixture',
                      'totpSecret': 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
                      'captchaKey': '', 'manualCaptcha': True}
            process.stdin.write((json.dumps(config) + '\n').encode())
            process.stdin.flush()
            deadline = time.monotonic() + 100
            seen = []
            stage = 0
            while time.monotonic() < deadline:
                ready, _, _ = select.select([process.stdout], [], [], 1)
                if not ready:
                    if process.poll() is not None:
                        break
                    continue
                line = process.stdout.readline()
                if not line:
                    raise AssertionError(f'Worker exited at stage {stage}, phases {seen[-16:]}: {process.stderr.read().decode()[-1200:]}')
                event = json.loads(line)
                if 'phase' in event:
                    seen.append(event['phase'] + (': ' + event['result'] if event.get('result') else ''))
                if event.get('frame'):
                    image = base64.b64decode(event['frame'])
                    assert image[:3] == b'\xff\xd8\xff'
                manual_stage = event.get('manualStage')
                wrote = False
                if manual_stage == 'captcha' and stage == 0:
                    process.stdin.write(b'{"type":"click","x":150,"y":135}\n')
                    stage = 1
                    wrote = True
                elif manual_stage == 'two-factor' and stage == 1:
                    # It must remain on 2FA until the owner provides the code.
                    assert 'Entering verification code' not in seen, seen
                    process.stdin.write(b'{"type":"click","x":150,"y":120}\n')
                    process.stdin.write(b'{"type":"text","text":"123456"}\n')
                    process.stdin.write(b'{"type":"click","x":150,"y":180}\n')
                    stage = 2
                    wrote = True
                elif manual_stage == 'other-code' and stage == 2:
                    process.stdin.write(b'{"type":"click","x":150,"y":120}\n')
                    process.stdin.write(b'{"type":"text","text":"654321"}\n')
                    process.stdin.write(b'{"type":"click","x":150,"y":180}\n')
                    stage = 3
                    wrote = True
                if wrote:
                    process.stdin.flush()
                if any(item.startswith('Session ready') for item in seen):
                    break
            assert stage == 3, (stage, seen)
            assert any(item.startswith('Session ready') for item in seen), seen
            assert 'Entering verification code' not in seen, seen
            assert (Path(state) / 'storage-state.json').exists()
            process.wait(timeout=20)
            assert process.returncode == 0, seen
            checker = subprocess.Popen([sys.executable, str(Path(__file__).with_name('worker_uc.py')), 'check'],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, env=env)
            checked, diagnostic = checker.communicate(b'{}\n', timeout=60)
            check_phases = [json.loads(line).get('phase') for line in checked.splitlines()]
            assert checker.returncode == 0 and 'Session ready' in check_phases, (check_phases, diagnostic.decode()[-800:])
            print('Manual browser: CAPTCHA, 2FA and email step completed by owner input; saved profile passed another fresh-browser check; no paid task')
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
