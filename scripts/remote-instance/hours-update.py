#!/usr/bin/env python3
"""Run the unchanged Hours generator against this instance's own native logs/state.

The native paths/output ROOT are isolated. An optional timestamp-only aggregate
baseline preserves historical estimates after an authorized archive purge. The
accepted generator file, pause handling, template and backend stay unchanged.
"""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sys
import types

GENERATOR_SHA = 'c02407485a8459b2f6b66248758cd3881556e307cd5fa1938c98a0713a67b0ae'


def load(generator, native, hours):
    generator, native, hours = (Path(p).resolve(strict=True) for p in (generator, native, hours))
    if hashlib.sha256(generator.read_bytes()).hexdigest() != GENERATOR_SHA:
        raise ValueError('Hours generator hash changed; review the adapter')
    if native == Path('/root/.codex') or hours == Path('/root/VAULTS/Flint-Software/Working-Hours'):
        raise ValueError('New-instance adapter cannot write/use the legacy state')
    if not native.is_dir() or not hours.is_dir():
        raise ValueError('Native and Hours roots must exist')
    spec = importlib.util.spec_from_file_location('isolated_hours_generator', generator)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.ROOT = hours

    def input_path(value):
        # Fail closed if a future generator adds a new input not reviewed here.
        if value == '/root/.codex/sessions':
            return native / 'sessions'
        if value == '/root/.codex/archived_sessions':
            return native / 'archived_sessions'
        raise ValueError('Unexpected native input path')

    original = module.read_activity
    scope = dict(original.__globals__, Path=input_path)
    module.read_activity = types.FunctionType(original.__code__, scope, original.__name__, original.__defaults__, original.__closure__)
    baseline = hours / 'activity-baseline.json'
    if baseline.exists():
        saved = json.loads(baseline.read_text())
        pairs = saved['activityIntervals']
        if saved.get('version') != 1 or len(pairs) > 100_000:
            raise ValueError('Invalid aggregate Hours baseline')
        for pair in pairs:
            if len(pair) != 2 or any(type(v) not in (int, float) or not math.isfinite(v) or v < 0 for v in pair) or pair[1] < pair[0]:
                raise ValueError('Invalid aggregate Hours interval')
        original_read = module.read_activity

        def read_with_baseline(now, idle_minutes=module.DEFAULT_IDLE_MINUTES):
            intervals, observed, count = original_read(now, idle_minutes)
            historical = [(module.datetime.fromtimestamp(a / 1000, module.TZ), module.datetime.fromtimestamp(b / 1000, module.TZ)) for a, b in pairs]
            if any(b > now for _a, b in historical):
                raise ValueError('Future aggregate Hours baseline')
            observed |= {module.date.fromisoformat(day) for day in saved['observedDays']}
            return module.merge(historical + intervals), observed, count

        module.read_activity = read_with_baseline
    return module


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, add_help=False)
    for name in ['generator', 'native', 'hours']:
        parser.add_argument('--' + name, required=True)
    args, remaining = parser.parse_known_args()
    module = load(args.generator, args.native, args.hours)
    sys.argv = [str(args.generator), *remaining]
    module.main()
