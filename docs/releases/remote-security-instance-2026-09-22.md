# Independent remote instance — TLS live, application not activated

Task `79b51874-b784-4171-85d1-30d8ff21f35f`. Actual native receipt is
`gpt-6-astra/max`, turn `01a0c9ef-3eee-75f0-b1ea-872508a02dc0`. No delegation.
Existing deployment consent applies. The user selected `remote.danhkhai.io.vn`,
can use SSH, and confirmed Cloudflare Full(strict). This records user confirmation,
not a Cloudflare API audit. The old `codex.danhkhai.io.vn` must remain available.

The interrupted predecessor produced no completed delivery consumed by this task.
Its worktree was left alone. This NEW worktree was created from accepted security
source `00f9e197285e9c918372367f626c0b744d47d0d6`, then fast-forwarded to accepted
Leader review/source `10f52e9410dd593e9182483701f043b43338ccf1`. No product source,
compiled app bytes, old release, main checkout or old runtime was edited.

## Concrete result

| Item | Result |
| --- | --- |
| Worktree / branch | `/root/WORKTREES/cr-remote-security-instance` / `prepare/remote-security-instance` |
| Private evidence | `/root/.local/state/codex-remote/remote-instance-79b51874` |
| New payload | `/root/.local/state/codex-remote/releases/remote-security-79b51874` |
| Payload manifest SHA256 | `88f43bd538941920120a7d98612e84ed5866ffb019049a14782510f414b5d536` |
| Application bytes | Security `80843c0` plus the accepted six-file Leader backend delta and matching 25-file client |
| Package checks | 90 backend files, 25 client files, 58 mapped client sources, 3,880 dependency entries; independent copies, no hardlinks |
| New instance port | `127.0.0.1:5174`, observed free; service not installed or started |
| Source/runtime destination | `/root/RUNNING-SERVICES/codex-remote-secure`, not installed |
| Independent state snapshot | `/root/.local/state/codex-remote-secure`, 73 native threads, 948,124,418 copied bytes; not active |
| Encryption owner key | Absent; not generated, rotated or retrieved |

`package.mjs` verifies the accepted Leader contract and security dependency tree
by their exact hashes, copies the complete new-instance executable closure, uses
the accepted six-file overlay, and checks client maps against accepted source.
This is a new destination. It never copies the entire backend over the old app.
The preserved `event-hub.js.map` remains the accepted live-map byte. Dependencies
remain jose6.2.12 / Vitest4.1.11. No rebuild/full suite was needed.

The source archive in `app/` is exact10f52e9; task-local installation helpers are
delivered separately in the evidence directory's `operator/` with their own manifest. They are not mixed
into the accepted application hash. The package has no activation/seal/approval
receipt, and its manifest explicitly says `activationReady:false`.

## Real infrastructure changes

Only a NEW exact-host site and a NEW named certificate were installed. The old
admin site, seven preview sites, Workboard, firewall and Cloudflare settings did
not change. `remote` is **parked503**, with no proxy route to either gateway.

- `/etc/nginx/sites-available/codex-remote-secure`, root:root0600,
  SHA256 `78b46e29ba7bd5982c6bc0826b4004c5b7b714b8f0974377fd69ef81c9413db7`.
- `/etc/nginx/sites-enabled/codex-remote-secure` links only to that file.
- Certificate lineage `/etc/letsencrypt/live/codex-remote-secure/`, exact single
  SAN `remote.danhkhai.io.vn`; no wildcard certificate/vhost/port authorization.
- Renewal file SHA256 `2889c096f06a61efab0afe328f36345500903802c45d23c8fc44263300cb81e5`.
  Retain `tls-recovery-1/certbot-work` and `certbot-logs`: renewal references them.
- Certificate valid `2026-09-22T15:36:28Z` to `2026-12-21T15:36:27Z`;
  SHA256 fingerprint `4A:14:EC:48:CD:BD:F1:A3:C1:E1:39:40:13:F3:CB:AB:F1:D9:96:76:0D:44:71:60:10:58:2B:EA:BE:54:60:05`.

DNS resolved to Cloudflare A104.21.79.246/172.67.150.82 and IPv6 addresses;
these are edge addresses, not the origin. A new public HTTP ACME canary was
verified byte-for-byte before Certbot used the existing registered account.
No new email/ToS consent was invented. The canary was removed in the owned
operator's finally block and cannot be reused as fresh rollout proof.

Normal-trust HTTPS origin (`curl --resolve`, 103.195.237.172) and public edge
returned503/no-store/no-Set-Cookie for `/` and `/api/session`: four checks,
206 bytes each. Targeted `certbot renew --cert-name codex-remote-secure --dry-run
--run-deploy-hooks --no-directory-hooks --no-random-sleep-on-renew
--non-interactive` passed. Deploy hook is the scoped existing pattern
`nginx -t && systemctl reload nginx`. No global renewal or gateway restart ran.

The cooperative shared deployment lock guarded preimages, parent identities,
legacy process/config/module hashes, and all five host Nginx temp directories.
The first operator stopped before Certbot because its own canary changed the
challenge directory mtime. Evidence was retained. Recovery separately verified
the owned bootstrap bytes, absent cert, removed canary, and used stable directory
inode/owner/mode while allowing ACME child entries to change. It did not adopt
foreign drift or replay an unknown certificate operation. Both attempt logs are
retained; `tls-recovery-1/tls-phase.json` is complete.

## State ownership and freshness

Supported native home and SQLite overrides are documented in
[official OpenAI configuration guidance](https://developers.openai.com/codex/config-advanced/).
The live native config had no explicit `sqlite_home`. The snapshot uses SQLite's
read-only source/backup API, rewrites copied rollout paths to the new native home,
copies complete JSONL prefixes with bounded buffers, and gives the new instance
its own config/auth file, DBs, logs, plugins/skills, Vault and Hours state. It does
not run another controller against original mutable state.

The native authentication file was copied only into the new root-private state
directory, never into Git, the application payload, reports or tool output.
No independent-account login/refresh behavior is claimed yet. `snapshot.json`
records individual capture times and copied-source hashes; this is not an atomic
whole-app snapshot. Later old-app changes are not synchronized. Both versions can
diverge after capture. This task did not start the copied native home.

Original orchestration evidence is retained byte-for-byte in
`archive/Orchestration.json`. Native queues/goals/log DBs are copied into an
archive, not the active home. Mailboxes/socket/capabilities are not copied.
The new orchestrator starts with an empty scheduler; original jobs continue and
remain managed on the old app. No copied job/result is automatically dispatched,
acknowledged, replayed, cancelled or declared delivered. Historical conversation
and Vault notes remain in the snapshot; the old task panel remains authoritative
for pre-snapshot running work.

Hours backend JS/map remain
`b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93` /
`6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8`.
Generator/template are unchanged. The new `hours-update.py` adapter checks the
exact generator hash and rebinds only its two native input paths and output ROOT
to this instance. It executes the original read/activity/pause algorithm, with
an isolated fixture proving it reads only that fixture's native log. Staged new
Hours timer/service are not installed. No real pause/timer mutation/generator run
occurred; old totals, timer, pause state and cron remain untouched.

The staged env and service pin each mutable path to the independent state root,
keep root/fullAccess, host-only cookies, new session secret and required encryption.
The prestart helper validates the actual TOML SQLite override, state directory
identities, origin/port and key format **before native startup**. It is not proof
that the old API cannot read the key.

## Blocking boundary — precise decision needed from leader/CR2

The unchanged legacy gateway still runs root with `fileRoots=["/"]`. Its
`server-files.ts:95` resolves a requested path and the content route serves that
regular file. The accepted new loader needs a readable0600 regular key file and
refreshes it. A different hostname, session secret, directory or chmod cannot
prevent the old authenticated API from reading a new plain owner-key file on this
same host. R5/R6 remain closed for their original stop-old cutover flow, which is
not applicable to this user-selected dual-version deployment.

**No reusable production key may be provisioned and no active new ingress may be
opened until a concrete old-API/key boundary has been independently checked.**
This is a technical prerequisite, not a request for general deployment consent.
During the checked-revision Vault merge, revision
`fef7b9df829c108e73db59da1eb51d0ee9bc4d33460d98a0aaa5f1fee06f63ce`
reported root's accepted boundary direction and CR2's staged prerequisite
**7b8c20a74aef1bd37d92eb807e640615bd72974c**, release
`/root/.local/state/codex-remote/releases/legacy-files-7b8c20a`. That scoped
backport restricts legacy Files roots and descriptor access while retaining old
UI/native root/fullAccess. This task did not independently review that patch;
the note says root review/ALL-idle activation remain. Actual observed old runtime
was783b1e3/PID1758426 during preparation. The final handoff read subsequently
observed main fast-forwarded to7b8c20a while gateway PID1758426 and Hours hashes
were unchanged. This worker made no main change. Source publication alone is not
proof of the live Files boundary; root must finish and verify its runtime install.

This worker must finish its current turn so it does not itself prevent ALL-idle
legacy publication. Root owns the legacy install and must verify its actual live
canary denial before creating the new key. This task does not restart/replace
that old gateway. Intentional native root compromise is outside the accepted
security target; the demonstrated ordinary Files API read is inside it.

Additional activation integration: preview7hosts remain parked by instruction.
Their active upstream must be explicitly assigned to the new gateway. Workboard's
accepted ancestor currently names only `codex`, so remote framing requires an
explicit matching Workboard decision/config, not an unreviewed blanket CSP change.
Do not claim preview/Workboard live merely because the remote admin TLS is ready.

The reviewed Cloudflare real-IP snippet is staged at
`operator/infra/cloudflare-real-ip.conf`. Its intended include
`/etc/nginx/snippets/codex-cloudflare-real-ip.conf` is currently absent; installing
that exact file with an absence/preimage guard is also required before testing
the active remote site. No existing vhost needs to be edited for this include.

## Checks run and limits

All heavy checks were sequential through `codex-heavy`, one worker, 1024 MiB Node
heap where relevant. Evidence lives in the private task directory.

- Six renderer cases; two independent-copy/path cases.
- Three real Nginx fixture configurations, nonroot/restricted filesystem and all
  five owned temp paths. Actual TLS hostname validation; unknown Host421, parked503,
  bootstrap TLS rejection, forwarding spoof removal, `/services` redirects,
  35,063,561-byte tunnel upload, >36MiB413 and WebSocket101. Host owners/modes/inodes
  and service identity unchanged.
- Two isolated SQLite/JSONL/Vault cases (plus a repeat after report-field change):
  source unchanged, new inode/path, no partial final line, queue/mailbox not resumed,
  original orchestration evidence retained, existing target/symlink/overlap rejected.
- Two isolated Hours adapter controls. No production Hours action.
- Actual packaged encrypted maintenance fixture: fake key init/rotation,
  root-only file checks, encrypted Knowledge checked write/read, Services,
  readiness, old-channel rejection, zero model turns. All fixture data removed.
- Final lint0 and syntax checks. Accepted app/protocol/Leader/browser evidence
  reused by hash, not rerun or expanded into a new protocol audit.

The new active service, real owner key, real new browser login/unlock/cache,
native account refresh, live preview tickets/Workboard and real new-instance SSE
are **not verified live**. Production state was copied, not activated. The copied
state remains private and must not be exposed via the old Files API after a new
key is created. No Services registry was falsely updated to claim the new app live.

## Next commands and ownership

No initial-cutover runner may be armed: it would stop the old gateway. No old seal
may be translated to this new architecture. This worker leaves main to root's
separate legacy-prerequisite task (observed783b1e3 →7b8c20a during this handoff).

Read-only package recheck:

```sh
cd /root/WORKTREES/cr-remote-security-instance
codex-heavy --label remote-package-verify -- env VITEST_MAX_WORKERS=1 \
  NODE_OPTIONS=--max-old-space-size=1024 node scripts/remote-instance/verify.mjs \
  /root/.local/state/codex-remote/releases/remote-security-79b51874
```

After the actual boundary decision, root reviews the new state ownership/freshness
and the staged service/env/Hours adapter. If a fresher snapshot is needed, use a
NEW output directory and update all corresponding new-instance paths together;
do not overwrite originals or overlay into the existing snapshot. The executed
snapshot command was:

```sh
codex-heavy --label remote-isolated-state-snapshot -- python3 -B \
  scripts/remote-instance/snapshot.py --native /root/.codex \
  --vault /root/VAULTS/Codex-Context \
  --hours /root/VAULTS/Flint-Software/Working-Hours \
  --output /root/.local/state/codex-remote-secure
```

That output now exists; rerunning the command intentionally rejects. It has no
owner key or instance.env. Private config must retain the selected login password
as approved and generate a new independent session secret without outputting it.
The owner-key provisioning/retrieval command is intentionally not executed or
offered as safe before the old API boundary is established. The proposed retrieval
location is `.../codex-remote-secure/secure-owner/owner-key.json`; the **actual**
location and SSH-only retrieval command must be sent after live verification.

Root's remaining ordered steps are: accept the concrete boundary; verify copied
native/config/state ownership; bind exact payload/operator hashes and fresh live
preimages; install only the new app/service; initialize the owner key under the
accepted boundary; start and prove required encrypted maintenance/legacy rejection
on loopback; verify new browser login/unlock/cache without a model turn; decide
preview/Workboard integration; acquire the shared deployment lock, recheck the
owned parked site and all old invariants, install only the reviewed new active
site and reload Nginx; public/localhost encrypted checks; register the new live
service and update actual publication notes. On any unknown failure retain phase
evidence and parked ingress. Never stop/downgrade the old app or replay a mutation.
