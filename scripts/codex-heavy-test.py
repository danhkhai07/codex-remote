#!/usr/bin/python3
"""Small real-systemd regression checks. No model/user data, no global OOM.

Run directly (not inside codex-heavy): it creates its own bounded fixtures.
"""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True

RUNNER = Path(__file__).with_name('codex-heavy.py')
spec = importlib.util.spec_from_file_location('heavy', RUNNER)
heavy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(heavy)


def run(code, *options, **kwargs):
    return subprocess.run(['/usr/bin/python3', str(RUNNER), '--memory-mib', '256',
                           '--timeout', '12', '--queue-timeout', '20', *options,
                           '--', '/usr/bin/python3', '-c', code], text=True,
                          capture_output=True, timeout=40, **kwargs)


def start(code, label, *options):
    return subprocess.Popen(['/usr/bin/python3', str(RUNNER), '--label', label,
                             '--memory-mib', '256', '--timeout', '12',
                             '--queue-timeout', '20', *options,
                             '--', '/usr/bin/python3', '-c', code],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def wait_file(path, timeout=10):
    deadline = time.monotonic() + timeout
    while not path.exists() and time.monotonic() < deadline:
        time.sleep(.05)
    assert path.exists(), f'Fixture did not start: {path}'


class RunnerTest(unittest.TestCase):
    def test_environment_and_arguments_are_not_shell_expanded(self):
        with patch.dict(os.environ, {'CANARY_SECRET': 'private-canary-value'}):
            self.assertNotIn('CANARY_SECRET', heavy.job_environment([]))
            result = run("import os,json; print(json.dumps(dict(secret=os.getenv('CANARY_SECRET'),cwd=os.getcwd(),cgroup=open('/proc/self/cgroup').read())))")
            self.assertEqual(result.returncode, 0, result.stderr)
            data = json.loads(result.stdout)
            self.assertIsNone(data['secret'])
            self.assertIn('/system.slice/codex-heavy-', data['cgroup'])
            self.assertEqual(data['cwd'], os.getcwd())
            explicit = run("import os; assert os.environ['CANARY_SECRET']=='private-canary-value'", '--env', 'CANARY_SECRET')
            self.assertEqual(explicit.returncode, 0, explicit.stderr)
            self.assertNotIn('private-canary-value', explicit.stderr)
        with tempfile.TemporaryDirectory(prefix='heavy arguments ') as directory:
            result = subprocess.run(['/usr/bin/python3', str(RUNNER), '--memory-mib', '256',
                                     '--', '/usr/bin/printf', '%s', '$(touch should-not-exist); quoted'],
                                    cwd=directory, text=True, capture_output=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout, '$(touch should-not-exist); quoted')
            self.assertFalse(Path(directory, 'should-not-exist').exists())

    def test_exit_timeout_and_nested_runner(self):
        self.assertEqual(run('raise SystemExit(23)').returncode, 23)
        result = run('import time; time.sleep(20)', '--timeout', '1')
        self.assertEqual(result.returncode, 124, result.stderr)
        result = run(f"import subprocess; r=subprocess.run(['/usr/bin/python3',{str(RUNNER)!r},'--','true']); assert r.returncode != 0")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Already inside', result.stderr)

    def test_queue_is_owned_by_service_after_launcher_is_killed(self):
        with tempfile.TemporaryDirectory() as directory:
            a, b = Path(directory, 'a'), Path(directory, 'b')
            first = start(f"from pathlib import Path; import time; Path({str(a)!r}).write_text('started'); time.sleep(2); Path({str(a)!r}).write_text('done')", 'fixture-first')
            wait_file(a)
            first.kill()
            first.wait(timeout=5)
            second = start(f"from pathlib import Path; assert Path({str(a)!r}).read_text()=='done'; Path({str(b)!r}).write_text('done')", 'fixture-second')
            output, errors = second.communicate(timeout=20)
            self.assertEqual(second.returncode, 0, output + errors)
            self.assertTrue(b.exists())
            first.communicate(timeout=10)

    def test_cancel_queued_job_does_not_cancel_holder(self):
        with tempfile.TemporaryDirectory() as directory:
            a, b = Path(directory, 'a'), Path(directory, 'b')
            first = start(f"from pathlib import Path; import time; Path({str(a)!r}).write_text('started'); time.sleep(3); Path({str(a)!r}).write_text('done')", 'fixture-holder')
            wait_file(a)
            second = start(f"from pathlib import Path; Path({str(b)!r}).touch()", 'fixture-cancel')
            time.sleep(.5)
            second.send_signal(signal.SIGTERM)
            second.communicate(timeout=15)
            self.assertEqual(second.returncode, 130)
            _, errors = first.communicate(timeout=15)
            self.assertEqual(first.returncode, 0, errors)
            self.assertEqual(a.read_text(), 'done')
            self.assertFalse(b.exists())

    def test_cancel_running_job_removes_command_children(self):
        with tempfile.TemporaryDirectory() as directory:
            pidfile = Path(directory, 'child-pid')
            job = start(f"import subprocess,time; from pathlib import Path; child=subprocess.Popen(['/usr/bin/sleep','60']); Path({str(pidfile)!r}).write_text(str(child.pid)); time.sleep(60)", 'fixture-running-cancel')
            wait_file(pidfile)
            child_pid = int(pidfile.read_text())
            job.send_signal(signal.SIGTERM)
            _, errors = job.communicate(timeout=20)
            self.assertEqual(job.returncode, 130, errors)
            deadline = time.monotonic() + 3
            while Path(f'/proc/{child_pid}').exists() and time.monotonic() < deadline:
                time.sleep(.1)
            self.assertFalse(Path(f'/proc/{child_pid}').exists())

    def test_applied_limits_and_metadata_exclude_secrets(self):
        result = run("from pathlib import Path; cg=Path('/sys/fs/cgroup') / Path('/proc/self/cgroup').read_text().strip().split('::')[1].lstrip('/'); assert (cg/'memory.max').read_text().strip()==str(256*1024*1024); assert (cg/'memory.swap.max').read_text().strip()=='0'; q,p=map(int,(cg/'cpu.max').read_text().split()); assert q==p; print('private-output-canary')", '--label', 'fixture-limits')
        self.assertEqual(result.returncode, 0, result.stderr)
        records = [json.loads(p.read_text()) for p in heavy.HISTORY.glob('*.json')]
        record = next(r for r in reversed(sorted(records, key=lambda r:r.get('finished_at', ''))) if r['label']=='fixture-limits')
        self.assertEqual(record['exit_code'], 0)
        self.assertIn('memory.peak', record)
        self.assertNotIn('private-output-canary', json.dumps(record))
        self.assertNotIn('command', record)
        self.assertNotIn('environment', record)

    def test_insufficient_headroom_fails_without_running(self):
        result = run("raise Exception('MUST NOT RUN')", '--reserve-mib', '65536', '--queue-timeout', '1')
        self.assertEqual(result.returncode, 75, result.stderr)
        self.assertNotIn('MUST NOT RUN', result.stderr)

    def test_cgroup_memory_oom_is_local_and_releases_slot(self):
        gateway_before = subprocess.check_output(['/usr/bin/systemctl', 'show', 'codex-remote.service', '-p', 'MainPID'], text=True)
        # Disable reclaim throttling only inside this disposable 128 MiB cgroup
        # so allocation reaches MemoryMax promptly instead of hitting timeout.
        code = "from pathlib import Path; import time; cg=Path('/sys/fs/cgroup') / Path('/proc/self/cgroup').read_text().strip().split('::')[1].lstrip('/'); assert (cg/'memory.max').read_text().strip()==str(128*1024*1024); (cg/'memory.high').write_text('max'); data=bytearray(200*1024*1024); time.sleep(2)"
        result = run(code, '--memory-mib', '128', '--label', 'fixture-local-oom')
        self.assertNotEqual(result.returncode, 0)
        records = [json.loads(p.read_text()) for p in heavy.HISTORY.glob('*.json')]
        record = next(r for r in reversed(sorted(records, key=lambda r:r.get('finished_at', ''))) if r['label']=='fixture-local-oom')
        self.assertEqual(record['service_result'].get('Result'), 'oom-kill', record)
        gateway_after = subprocess.check_output(['/usr/bin/systemctl', 'show', 'codex-remote.service', '-p', 'MainPID'], text=True)
        self.assertEqual(gateway_before, gateway_after)
        result = run('print("slot released")')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('slot released', result.stdout)


if __name__ == '__main__':
    unittest.main(verbosity=2)
