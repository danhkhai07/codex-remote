#!/usr/bin/python3
"""Serialize build/test jobs in separate, bounded systemd services (Linux/root).

No shell interpolation, package dependencies, gateway changes, or secret logging.
The service owns the queue lock, even if its launching conversation disappears.
"""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import time
import uuid

ROOT = Path('/run/codex-heavy')
HISTORY = Path('/var/log/codex-heavy')
SYSTEMD_RUN = '/usr/bin/systemd-run'
SYSTEMCTL = '/usr/bin/systemctl'
SAFE_ENV = ('PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR')


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def private_directory(path):
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise ValueError(f'Expected a private root-owned directory: {path}')


def write_json(path, data):
    temporary = path.with_suffix('.tmp')
    with temporary.open('w') as handle:
        json.dump(data, handle, ensure_ascii=False)
        handle.write('\n')
    temporary.replace(path)


def cgroup_path():
    for line in Path('/proc/self/cgroup').read_text().splitlines():
        if line.startswith('0::'):
            return line[3:]
    raise ValueError('cgroup v2 is required')


def available_mib():
    for line in Path('/proc/meminfo').read_text().splitlines():
        if line.startswith('MemAvailable:'):
            return int(line.split()[1]) // 1024
    raise ValueError('MemAvailable is unavailable')


def bounded_integer(low, high):
    def parse(value):
        number = int(value)
        if not low <= number <= high:
            raise argparse.ArgumentTypeError(f'Must be between {low} and {high}')
        return number
    return parse


def arguments(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--label', default='build-test')
    parser.add_argument('--memory-mib', type=bounded_integer(128, 2048), default=1536)
    parser.add_argument('--timeout', type=bounded_integer(1, 3600), default=900)
    parser.add_argument('--queue-timeout', type=bounded_integer(1, 3600), default=600)
    parser.add_argument('--reserve-mib', type=bounded_integer(1024, 65536), default=2048)
    parser.add_argument('--env', action='append', default=[], metavar='NAME')
    parser.add_argument('--status', action='store_true')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,79}', args.label):
        parser.error('--label must be 1–80 letters, digits, dots, dashes or underscores')
    if args.command[:1] == ['--']:
        args.command = args.command[1:]
    if not args.command and not args.status:
        parser.error('Provide -- followed by a build/test command')
    for key in args.env:
        if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key) or key.startswith('CODEX_HEAVY_'):
            parser.error('--env takes an environment variable NAME, not its value')
    return args


def job_environment(names):
    environment = {key: os.environ[key] for key in (*SAFE_ENV, *names) if key in os.environ}
    environment.setdefault('PATH', '/usr/local/bin:/usr/bin:/bin')
    environment['CODEX_HEAVY_ACTIVE'] = '1'
    return environment


def systemd_arguments(job, payload):
    memory = job['memory_mib']
    return [SYSTEMD_RUN, '--quiet', '--wait', '--pipe', '--unit=' + job['unit'],
            '--description=Codex bounded build/test: ' + job['label'],
            '-p', 'Type=exec', '-p', 'Slice=system.slice',
            '-p', f'MemoryHigh={memory * 4 // 5}M', '-p', f'MemoryMax={memory}M',
            '-p', 'MemorySwapMax=0', '-p', 'CPUQuota=100%', '-p', 'TasksMax=256',
            '-p', 'OOMPolicy=stop', '-p', 'KillMode=control-group',
            '-p', 'TimeoutStopSec=5',
            '-p', f'RuntimeMaxSec={job["timeout"] + job["queue_timeout"] + 15}',
            '/usr/bin/python3', str(Path(__file__).resolve()), '--worker', str(payload)]


def sample(cgroup):
    result = {}
    for name in ('memory.current', 'memory.peak', 'memory.events'):
        try:
            value = (cgroup / name).read_text().strip()
            result[name] = int(value) if value.isdigit() else dict(
                (key, int(count)) for key, count in (line.split() for line in value.splitlines()))
        except (OSError, ValueError):
            pass
    processes = []
    try:
        pids = (cgroup / 'cgroup.procs').read_text().split()
    except OSError:
        pids = []
    for pid in pids:
        try:
            fields = dict(line.split(':', 1) for line in Path(f'/proc/{pid}/status').read_text().splitlines())
            processes.append({'pid': int(pid), 'name': fields['Name'].strip(),
                              'rss_kib': int(fields.get('VmRSS', '0 kB').split()[0])})
        except (OSError, ValueError, KeyError):
            continue
    result['top_rss'] = sorted(processes, key=lambda row: row['rss_kib'], reverse=True)[:5]
    return result


def stop_process(child):
    try:
        os.killpg(child.pid, signal.SIGTERM)
        child.wait(timeout=3)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait()
    except ProcessLookupError:
        pass


def worker(payload):
    os.umask(0o077)
    if payload.parent != ROOT or not re.fullmatch(r'codex-heavy-[a-f0-9]{32}\.json', payload.name):
        raise ValueError('Invalid job payload path')
    descriptor = os.open(payload, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor) as handle:
        info = os.fstat(handle.fileno())
        if info.st_uid != 0 or info.st_mode & 0o077 or not stat.S_ISREG(info.st_mode):
            raise ValueError('Job payload must be private and root-owned')
        job = json.load(handle)
    payload.unlink()
    group = cgroup_path()
    if group != '/system.slice/' + job['unit']:
        raise ValueError('Refusing to run outside the dedicated job cgroup')
    cg = Path('/sys/fs/cgroup') / group.lstrip('/')
    if (cg / 'memory.max').read_text().strip() != str(job['memory_mib'] * 1024 * 1024):
        raise ValueError('Job memory limit was not applied')
    if (cg / 'memory.swap.max').read_text().strip() != '0':
        raise ValueError('Job swap limit was not applied')
    metadata = {key: job[key] for key in ('unit', 'label', 'cwd', 'memory_mib', 'timeout', 'queue_timeout')}
    metadata.update(queued_at=now(), executable=Path(job['command'][0]).name, cgroup=group, phase='queued')
    record = HISTORY / (job['unit'] + '.json')
    write_json(record, metadata)
    cancelled = [False]
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: cancelled.__setitem__(0, True))
    deadline = time.monotonic() + job['queue_timeout']
    child = None
    # The worker and its command retain this descriptor. Killing only the CLI
    # cannot free the slot while its separate service is still doing work.
    with (ROOT / 'queue.lock').open('a') as lock:
        acquired = False
        while not cancelled[0] and time.monotonic() < deadline:
            if not acquired:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    acquired = True
                except BlockingIOError:
                    pass
            if acquired and available_mib() >= max(job['reserve_mib'], job['memory_mib'] + 512):
                break
            time.sleep(0.2)
        else:
            metadata.update(phase='cancelled' if cancelled[0] else 'queue-timeout', finished_at=now())
            write_json(record, metadata)
            return 130 if cancelled[0] else 75
        metadata.update(phase='running', started_at=now())
        write_json(record, metadata)
        code = 127
        try:
            child = subprocess.Popen(job['command'], cwd=job['cwd'], env=job['environment'],
                                     start_new_session=True, pass_fds=(lock.fileno(),))
            metadata['pid'] = child.pid
            deadline = time.monotonic() + job['timeout']
            next_sample = 0
            while child.poll() is None:
                if time.monotonic() >= next_sample:
                    measurements = sample(cg)
                    metadata.update(measurements, sampled_at=now())
                    if measurements.get('memory.current', 0) >= metadata.get('largest_sample_bytes', 0):
                        metadata['largest_sample_bytes'] = measurements.get('memory.current', 0)
                        metadata['peak_processes'] = measurements.get('top_rss', [])
                    write_json(record, metadata)
                    next_sample = time.monotonic() + 2
                if cancelled[0] or time.monotonic() >= deadline:
                    stop_process(child)
                    code = 130 if cancelled[0] else 124
                    metadata['phase'] = 'cancelled' if cancelled[0] else 'timeout'
                    break
                time.sleep(0.2)
            else:
                code = child.returncode if child.returncode >= 0 else 128 - child.returncode
                metadata['phase'] = 'complete' if code == 0 else 'failed'
        except OSError as error:
            # Do not echo command arguments or environment values on launch error.
            print(f'codex-heavy: command could not start (errno {error.errno})', file=sys.stderr)
            code = 127
            metadata['phase'] = 'failed'
        finally:
            if child and child.poll() is None:
                stop_process(child)
            metadata.update(sample(cg), exit_code=code, finished_at=now())
            write_json(record, metadata)
        return code


def launch(args):
    if os.environ.get('CODEX_HEAVY_ACTIVE') or '/codex-heavy-' in cgroup_path():
        raise ValueError('Already inside a bounded job; run its subcommands directly')
    private_directory(ROOT)
    private_directory(HISTORY)
    # Retain at most 200 completed records, with no command lines/env/stdout.
    records = sorted(HISTORY.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True)
    for record in records[199:]:
        if json.loads(record.read_text()).get('finished_at'):
            record.unlink(missing_ok=True)
    unit = 'codex-heavy-' + uuid.uuid4().hex + '.service'
    environment = job_environment(args.env)
    command = list(args.command)
    executable = shutil.which(command[0], path=environment['PATH'])
    if not executable:
        raise ValueError('Executable was not found in PATH')
    command[0] = str(Path(executable).resolve())
    job = dict(unit=unit, label=args.label, cwd=os.getcwd(), command=command,
               environment=environment, memory_mib=args.memory_mib, timeout=args.timeout,
               queue_timeout=args.queue_timeout, reserve_mib=args.reserve_mib)
    payload = ROOT / (unit.removesuffix('.service') + '.json')
    write_json(payload, job)
    cancelled = [False]
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: cancelled.__setitem__(0, True))
    print(f'codex-heavy: {args.label}; {args.memory_mib} MiB; one global build/test slot; {unit}', file=sys.stderr)
    client = None
    try:
        client = subprocess.Popen(systemd_arguments(job, payload))
        while client.poll() is None:
            if cancelled[0]:
                subprocess.run([SYSTEMCTL, 'stop', unit], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=12)
                try:
                    client.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    client.terminate()
                return 130
            time.sleep(0.2)
        return client.returncode
    finally:
        # Failed/OOM units remain inspectable until this explicit cleanup.
        status = subprocess.run([SYSTEMCTL, 'show', unit, '-p', 'Result', '-p', 'ExecMainStatus', '-p', 'MemoryPeak'],
                                capture_output=True, text=True, timeout=5)
        record = HISTORY / (unit + '.json')
        metadata = json.loads(record.read_text()) if record.exists() else dict(unit=unit, label=args.label, cwd=job['cwd'])
        metadata['service_result'] = dict(line.split('=', 1) for line in status.stdout.splitlines() if '=' in line)
        metadata.setdefault('finished_at', now())
        metadata['launcher_exit_code'] = 130 if cancelled[0] else client.returncode if client else 127
        if metadata.get('phase') in ('running', 'queued', None):
            metadata['phase'] = 'cancelled' if cancelled[0] else 'service-ended'
        write_json(record, metadata)
        subprocess.run([SYSTEMCTL, 'stop', unit], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=12)
        subprocess.run([SYSTEMCTL, 'reset-failed', unit], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        payload.unlink(missing_ok=True)


def main():
    os.umask(0o077)
    if os.geteuid() != 0:
        raise ValueError('This host runner requires root/systemd service permission')
    if sys.argv[1:2] == ['--worker']:
        return worker(Path(sys.argv[2]))
    args = arguments(sys.argv[1:])
    if args.status:
        records = sorted(HISTORY.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True)[:20]
        print(json.dumps([json.loads(record.read_text()) for record in records], indent=2))
        return 0
    return launch(args)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(f'codex-heavy: {error}', file=sys.stderr)
        sys.exit(1)
