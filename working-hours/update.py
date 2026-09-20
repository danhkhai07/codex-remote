#!/usr/bin/env python3
"""Build a private, standalone work-hours dashboard from timestamp metadata."""
import argparse
import csv
import json
import math
import os
from collections import defaultdict
from datetime import datetime, timedelta, time, date
import fcntl
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
TZ = ZoneInfo('Asia/Ho_Chi_Minh')
DEFAULT_IDLE_MINUTES = 60

def merge(intervals):
    result = []
    for start, end in sorted(intervals):
        if result and start <= result[-1][1]:
            result[-1] = (result[-1][0], max(end, result[-1][1]))
        else:
            result.append((start, end))
    return result

def daily_seconds(intervals):
    totals = defaultdict(float)
    for start, end in merge(intervals):
        while start < end:
            midnight = datetime.combine(start.date() + timedelta(days=1), time(), TZ)
            stop = min(end, midnight)
            totals[start.date().isoformat()] += (stop - start).total_seconds()
            start = stop
    return totals

def activity_intervals(stamps, idle_minutes):
    ordered = sorted(set(stamps))
    return [(a, b) for a, b in zip(ordered, ordered[1:])
            if 0 < (b-a).total_seconds() <= idle_minutes * 60]

def read_activity(now, idle_minutes=DEFAULT_IDLE_MINUTES):
    observed, stamps = set(), set()
    files = set(Path('/root/.codex/sessions').rglob('*.jsonl')) | set(Path('/root/.codex/archived_sessions').rglob('*.jsonl'))
    for path in sorted(files):
        with path.open() as stream:
            for line in stream:
                try:
                    record = json.loads(line)
                    kind, payload = record.get('type'), record.get('payload', {})
                    # Only conversational/tool activity; no token counters or state snapshots.
                    if kind != 'response_item' and not (kind == 'event_msg' and payload.get('type') in {'user_message', 'agent_message', 'task_started', 'task_complete'}):
                        continue
                    stamp = datetime.fromisoformat(record['timestamp'].replace('Z', '+00:00')).astimezone(TZ)
                    if stamp <= now:
                        stamps.add(stamp)
                        observed.add(stamp.date())
                except (ValueError, KeyError, TypeError):
                    continue
    # One timeline across sessions: switching conversations is still continuous work.
    intervals = activity_intervals(stamps, idle_minutes)
    return daily_seconds(intervals), observed, len(files)

def atomic_write(path, content):
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(content)
    os.replace(temp, path)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--set', nargs=2, metavar=('DATE', 'HOURS'), help='Set confirmed daily hours, including 0 for a day off')
    parser.add_argument('--idle-minutes', type=int, help='Set automatic reading/inactivity allowance (1–240 minutes)')
    args = parser.parse_args()
    settings_path = ROOT / 'tracking-settings.json'
    settings = json.loads(settings_path.read_text()) if settings_path.exists() else {'idle_minutes': DEFAULT_IDLE_MINUTES}
    idle_minutes = args.idle_minutes if args.idle_minutes is not None else settings.get('idle_minutes', DEFAULT_IDLE_MINUTES)
    if type(idle_minutes) is not int or not 1 <= idle_minutes <= 240:
        parser.error('idle_minutes must be an integer between 1 and 240')
    settings['idle_minutes'] = idle_minutes
    if args.idle_minutes is not None or not settings_path.exists():
        atomic_write(settings_path, json.dumps(settings, indent=2) + '\n')
    now = datetime.now(TZ)
    manual_path = ROOT / 'confirmed-hours.csv'
    if not manual_path.exists():
        manual_path.write_text('date,hours\n')
    confirmed = {}
    with manual_path.open() as f:
        for row in csv.DictReader(f):
            day, hours = date.fromisoformat(row['date']), float(row['hours'])
            if not math.isfinite(hours) or not 0 <= hours <= 24 or day > now.date():
                raise ValueError('Confirmed hours must be 0–24 and dates cannot be in the future')
            confirmed[day.isoformat()] = hours
    shared_path = ROOT / 'working-hours-state.json'
    if shared_path.exists():
        if args.set:
            parser.error('Shared tracking is enabled; update daily totals through the dashboard to avoid concurrent writes.')
        shared = json.loads(shared_path.read_text())
        confirmed = shared['totals']
        atomic_write(manual_path, 'date,hours\n' + ''.join(f'{d},{h}\n' for d,h in sorted(confirmed.items())))
    revision_path = ROOT / 'confirmed-revisions.json'
    revisions = json.loads(revision_path.read_text()) if revision_path.exists() else {}
    if args.set:
        day, hours = date.fromisoformat(args.set[0]), float(args.set[1])
        if day > now.date() or not math.isfinite(hours) or not 0 <= hours <= 24:
            parser.error('Use a date through today and finite hours between 0 and 24')
        confirmed[day.isoformat()] = hours
        revisions[day.isoformat()] = now.isoformat()
        atomic_write(revision_path, json.dumps(revisions, indent=2) + '\n')
        atomic_write(manual_path, 'date,hours\n' + ''.join(f'{d},{h}\n' for d,h in sorted(confirmed.items())))
    seconds, observed, count = read_activity(now, idle_minutes)
    known = observed | {date.fromisoformat(d) for d in confirmed}
    days = []
    if known:
        cursor = min(known)
        while cursor <= now.date():
            key = cursor.isoformat()
            source = 'recorded' if key in confirmed or cursor in observed else 'unknown'
            hours = confirmed.get(key, seconds.get(key, 0) / 3600) if source != 'unknown' else None
            if key in confirmed:
                baseline = shared.get('estimateBaselines', {}).get(key, seconds.get(key, 0) / 3600) if shared_path.exists() else seconds.get(key, 0) / 3600
                hours = max(0, min(24, hours + max(0, seconds.get(key, 0) / 3600 - baseline)))
            days.append({'date': key, 'hours': hours, 'source': source, 'estimatedHours': seconds.get(key, 0) / 3600 if cursor in observed else None})
            cursor += timedelta(days=1)
    data = {'generated': now.isoformat(), 'today': now.date().isoformat(), 'timezone': str(TZ), 'sourceFiles': count, 'gapMinutes': idle_minutes, 'trackingMethod': 'automatic-reading-allowance', 'days': days, 'confirmedRevisions': {d: f'{revisions.get(d, "csv")}:{h}' for d, h in confirmed.items()}}
    atomic_write(ROOT / 'data.json', json.dumps(data, indent=2) + '\n')
    atomic_write(ROOT / 'daily-hours.csv', 'date,hours\n' + ''.join(f"{d['date']},{'' if d['hours'] is None else format(d['hours'], '.4f')}\n" for d in days))
    template = (ROOT / 'dashboard.template.html').read_text()
    atomic_write(ROOT / 'index.html', template.replace('__WORK_DATA__', json.dumps(data).replace('<', '\\u003c')))
    notes = ['# Daily working hours', '', f'Automatic estimates include gaps of up to {idle_minutes} minutes between activities across all sessions, allowing time for reading. Longer gaps and time after the latest event are excluded. Daily edits adjust the total; subsequent automatic activity continues adding time.', '', '| Date (Vietnam) | Hours |', '| --- | ---: |']
    for d in reversed(days):
        value = 'Unknown' if d['hours'] is None else f"{d['hours']:.2f}"
        notes.append(f"| {d['date']} | {value} |")
    atomic_write(ROOT / 'Daily-Log.md', '\n'.join(notes) + '\n')
    print(json.dumps({'updated': data['generated'], 'days': len(days), 'hours': round(sum(d['hours'] or 0 for d in days), 2)}))

if __name__ == '__main__':
    with (ROOT / '.writer.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        main()
