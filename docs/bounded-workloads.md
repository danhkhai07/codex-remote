# Bounded build and test jobs

Use `codex-heavy` for builds, test suites, type checking, vulnerability scans,
image/PDF rendering and browser automation on the shared VPS. Reading code,
editing files, Git operations and small status queries do not need the runner.
Do not wrap a long-lived preview server: previews have their own service owner
and lifecycle recorded on `/services`.

```sh
codex-heavy --label my-task-check -- npm run check
codex-heavy --label my-task-backend -- go test -p 1 ./...
codex-heavy --label my-task-render --timeout 180 -- node render-check.mjs
codex-heavy --status
```

The command runs in the caller's current directory. Arguments are passed as an
array, not interpreted by a shell. For a sequence, explicitly use `bash -c` and
quote it correctly. Once inside a bounded job, run subcommands normally; nesting
the runner is rejected to prevent waiting for its own queue slot. Keep tool-level
worker concurrency low as well (`vitest --maxWorkers=1`, Go `-p 1`, etc.).

Every job starts a **separate transient systemd service**, outside
`codex-remote.service`. Defaults:

- One global running build/test job, with a 10-minute queue deadline.
- 1,536 MiB `MemoryMax`, 1,228 MiB `MemoryHigh`, no swap, one CPU, 256 tasks.
- 15-minute command timeout, then terminate the command group; systemd also
  bounds total queue/runtime and removes remaining children.
- Start only with at least 2,048 MiB host MemAvailable (and at least the job's
  memory ceiling plus 512 MiB). Otherwise wait within the queue deadline.

`--memory-mib` accepts 128–2,048 and `--timeout`/`--queue-timeout` accept 1–3,600
seconds. A failed job is reported, never retried automatically without limits.
Exhausting the queue/headroom deadline returns 75; command timeout returns 124;
Ctrl-C/SIGTERM returns 130. Normal command exit codes propagate. MemoryHigh can
throttle a leaking process before it reaches MemoryMax; timeout still bounds it.

The **service holds the shared flock**, not just the initiating CLI. If a chat
or CLI is killed, its existing job retains the slot until completion/timeout;
another conversation cannot accidentally start a second heavy job. Normal CLI
cancellation stops only its unique job unit. Workers inherit the lock descriptor.
This is resource containment for cooperative agent commands, not a sandbox for
untrusted root code: raw commands, other runners, root cgroup changes and Docker
daemon work do not inherit these limits. Docker/container builds need their own
limits and must not be assumed contained by this wrapper.

Only basic process environment (`PATH`, `HOME`, `USER`, `LOGNAME`, `LANG`,
`LC_ALL`, `TERM`, `TMPDIR`) is passed by default. Use `--env NAME` to explicitly
pass a needed variable already present in the caller, or let the command load
its local environment file. Do not put credentials in labels or command-line
arguments. The temporary job payload is root-only and removed on worker start.

`/var/log/codex-heavy` retains up to 200 completed JSON records: label, directory,
executable basename, PID, timestamps, cgroup, limits, peak memory and sampled top
RSS processes every two seconds. It stores no command arguments, environment or
command output. This is sufficient to attribute future peaks to a labeled job
without copying credentials into reports. Command stdout/stderr goes back to
the initiating terminal. Records and the queue are root-only.

## Install / update

Requires the existing Python 3 standard library, systemd, cgroup v2 and root.
Install from a reviewed checkout; no package installation or gateway restart:

```sh
install -d -m 755 /usr/local/lib/codex-remote
install -m 755 scripts/codex-heavy.py /usr/local/lib/codex-remote/codex-heavy.py
ln -s /usr/local/lib/codex-remote/codex-heavy.py /usr/local/bin/codex-heavy
```

The installed copy does not depend on a task worktree remaining present. Updating
it does not change gateway configuration or production `dist-server`. For rollback,
restore the previous installed copy; first let existing jobs finish. Do not
delete the queue lock file while any job is running.

## Verification

Run `python3 scripts/codex-heavy-test.py` directly: the fixture creates its own
small separate services, testing exit codes, timeouts, headroom refusal, explicit
environment passing, literal arguments, nesting rejection, serialization after
launcher SIGKILL, queued cancellation and a local 128 MiB cgroup OOM. The test
checks that the gateway PID survives; it does not induce a global OOM or mutate
user conversations. No real model calls, database fixtures or previews are used.

Shared Vault instructions make the runner the standard for all Codex Remote
conversations. This does **not** intercept every arbitrary shell command; agents
must use the entry point. Existing previews may be retired only after checking
their owning task/PR and updating `/services`; pending review alone is not proof
that a preview is no longer needed.
