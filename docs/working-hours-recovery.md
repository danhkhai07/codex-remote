# Recover verification after publication

`working-hours-recovery.mjs` checks an existing immutable Working Hours release
without installing, building, restarting, or changing working-hours state. It
requires the original marker to say failed/verification, exact source/runtime and
configuration baselines, a newer live gateway PID, expected generated template,
read-only pause schema and preserved state. It verifies complete local/public
response bodies against hashes, including the authenticated dashboard. Only
`--complete` updates Services, checks its readback, preserves the original failed
marker, checks drift again, then atomically writes a complete marker.

Run from the production checkout so existing `.env` configuration can be loaded:

```
/usr/local/bin/node --env-file=.env /path/to/working-hours-recovery.mjs \
  --check /path/to/immutable-release /path/to/private-recovery-evidence
```

After review and authorization, use `--complete` with the same arguments. Never
rerun the original deployment's `--apply` or restore old state to recover a failed
verification. User edits after the activation snapshot cause a guarded failure;
review those separately instead of weakening the check or restoring the snapshot.

Tests (run via codex-heavy):
`node --test scripts/working-hours-recovery.node-test.mjs`.
The fixture includes an actual HTTP response that sends 200 headers then truncates
its body. The verifier reports the path and transport cause and cannot mark it
complete. No production cookie, task, or model turn is used in these tests.

## Incident 2026-09-21

The original release installed/restarted successfully at 16:45–16:46 +07, but
verification failed at 16:46:10 with `terminated`. Read-only reproduction isolated
it to `/assets/index-1uATMRmj.js`: HTTP200 followed by UND_ERR_SOCKET, other side
closed. Nginx's 16:46:09 error names this exact asset and a proxy temporary file
with EACCES. `/var/lib/nginx/proxy` was nobody:root 0700 while the configured and
running host workers use www-data. Child cache directories were already
www-data:www-data. The same failure reproduced on a fresh public GET.

Recovery changed only that parent directory's owner to www-data, retained root
group and mode0700, and left Nginx config/processes and backend PID unchanged.
Complete public bodies then matched local/release SHA256, including the510571byte
entry. The failed marker and original permission metadata remain in private
recovery evidence. Do not claim which earlier process changed that owner without
additional evidence. Isolated Nginx configuration tests must override all temp,
pid and log paths; running as root with host default temp paths can affect owners.

The original seal remains untouched. Main source stays783b1e3. This operational
verifier may be run from a separately reviewed branch/artifact; merging it is not
required to load the already deployed pause feature.
