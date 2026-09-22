# Independent key cutover review — 8b395de, 2026-09-22

Historical review of exact8b395de follows unchanged. The later R6 implementation
converts its inverse probe into rejecting acceptance tests; that change is
[documented separately](secure-release-generated-identity.md) and awaits independent/root
review. It does not retroactively approve 8b395de or its seal.

**Decision: R5's legacy key-exposure boundary is addressed; one new P2 (R6)
requires a focused runner correction before activation.** Application acceptance
at 80843c0 is unchanged. R1–R4 corrections remain intact in the reviewed code and
focused controls. This is a bounded runner review, not an application re-audit or
approval of a future infrastructure baseline.

Exact scope:

- Runner `8b395def751810d8c26a51c0811d0d803447ebbf`.
- App `80843c0947c5e665a51a6207dbb871bf2c06a421`; target source
  `00f9e197285e9c918372367f626c0b744d47d0d6` (independent tests/report only).
- Release `/root/.local/state/codex-remote/releases/secure-api-80843c0-review-key-cutover-8b395de`.
- Seal `4e31991586331b8999911f3540dc85f688ba3fdea9bbf272107493013b293106`.
- Task `7587f54b-cb80-413b-8e84-d13458e93a39`, native turn
  `01a0c6cf-c554-7a52-92bb-fa488ab5ce2b`. Read-only task/thread evidence confirmed
  `gpt-6-astra`, reasoning effort `max`. Earlier v1 was cancelled by the leader
  for effort mismatch, not a user cancellation of security scope.
- Fresh review worktree `/root/WORKTREES/cr-secure-key-cutover-final`, branch
  `review/secure-key-cutover-final`. Only review fixtures/report changed.

## R6 — P2: bind adopts a replacement key after successful init

Locations: `scripts/secure-release/cutover-ops.mjs:94-105`,
`scripts/secure-release/key-cutover.mjs:13-14`.

The init CLI creates and fsyncs a new key, but the adapter retains no identity of
that generated key when the CLI returns. It transitions through a separate
awaited phase/journal write and another asynchronous listener proof. Only then
does `bind()` call `ownerIdentity()` for the first time. Whatever valid key is
currently at the path is accepted as the generated key.

A concurrent operator rotation in that interval therefore bypasses the claimed
cutover key-drift protection. Subsequent `beforeStart()`/`start()` checks compare
against the replacement identity, so they pass. The runner starts the required
backend rather than reporting changed key material. Rotation **after** binding
is already correctly rejected; this finding concerns the unbound interval only.

This is a cooperative operational consistency defect, not a demonstrated remote
key leak or an attempt to defend against malicious root. The old process is
already gone, so R5's old-file-API exposure does not recur. The problem is the
false provenance of the binding and silently accepting an intervening key
change despite the documented drift policy. The regular rotation CLI does not
participate in the deployment lock, so an accidental concurrent operator action
does not need to bypass a lock to hit this interval.

Independent reproduction uses the unchanged actual `cutoverOps` adapter, the
sealed real key CLI and owned old/new HTTP processes. At the persisted
`bind-owner-key` phase, the fixture records the just-generated key's hash, runs
the regular sealed `rotate` command on that **disposable fixture key**, then lets
the adapter proceed. Assertions confirm:

1. The key hash changed after successful init.
2. Cutover exits successfully and starts the new required gateway.
3. `key-binding.json` names the replacement hash, not the initial generated hash.
4. The old process remains gone and the old cookie is rejected by the new gateway.

Test: `CR2 inverse: key replaced after init but before binding is adopted without
a drift rejection` in `scripts/secure-release/key-preprovision-review.node-test.mjs`.
Its green result demonstrates this defect; it is **not** an acceptance test.

Minimal correction: retain the generated identity immediately on successful
init, before the next phase/socket await, and compare against that exact
identity before writing binding and before start. For a stronger provenance
contract, let the creating operation durably return/write nonsecret identity
alongside its successful creation. Never silently accept a later valid key as
the original. Keep the existing no-retry/no-adoption recovery for interrupted
unbound creation. This can be a focused tooling change; no app rebuild or
protocol redesign is required. It does not claim atomic CAS against hostile root.

Acceptance: rotate or replace the key after init and during the binding listener
await; both must abort without starting, leave old processes gone and preserve
the unexpected key/phase for operator recovery. The unchanged successful path,
post-binding rotation rejection, parent-death cases, ordinary restart preserving
key bytes, and crash recovery controls must remain green. Seal a NEW candidate;
never edit the reviewed immutable release.

## R5 boundary and reviewed integration

- Preflight now requires an absent destination and prior binding, validates
  structural required config/provision path and records parent identities.
  It neither creates nor requires a reusable key during idle waiting. DNS/TLS
  checks are independent of key material. An existing key blocks before stop;
  there is no adoption/deletion/implicit rotation path.
- BASE source remains active while the frozen old authenticated CLI/watcher
  operates. Source transition remains gated after complete dual ALL-idle and
  final readiness. The old watcher is the exact six-file import closure. Its
  invocation alone gets the sealed executable in PATH; that executable accepts
  only `restart codex-remote.service`, and its production service commands use
  absolute `/usr/bin/systemctl`. No live unit hook or general systemctl replacement
  is installed. The artifact verifies all eleven runner/helper/executable bytes.
- Adapter claim uses exclusive creation and file/directory fsync. Permit is
  bound to app/seal, the runner PID/start lifetime, parent running phase, shared
  lock owner, exact receipt bytes/ages and expected source/config/module/dependency
  state. Key-related effects are guarded again after asynchronous socket probes.
- Stop requires Type=simple, KillMode=control-group, SendSIGKILL=yes and no
  activation triggers, plus unchanged effective units. The adapter requires
  inactive/dead, MainPID=0, ControlPID=0, original lifetime gone, recursive cgroup
  empty and loopback refusal before generating any key. TCP timeout/error is not
  accepted as refusal. Unit stop success alone is not treated as isolation.
- Exact BASE root Files handler with fake auth sees 404 while the key is absent.
  Owned keepalive/upgraded connections close with the old process. Only afterward
  does the real init CLI run. New exact APP rejects old cookie-only private reads;
  encrypted Knowledge checked write/read and Services CLI work. Ordinary restart
  retains the same key and one-use cutover cannot repeat it.
- Four extra independent acceptance controls kill an actual separate process
  named by the permit as runner before stop, during the generation listener
  await and during the start listener await, or withdraw its marker phase during
  the final start await. All prevent the next effect. Before stop the old service
  stays alive/key absent; after stop it stays unreachable. Generated but unstarted
  key evidence remains for recovery, with no implicit retry or rotation.
- SIGKILL/SIGTERM at the existing phase boundaries, failed stop/start, surviving
  cgroup members, mode/removal/post-binding rotation, config drift during awaits,
  expired receipts and repeated claims all retain appropriate failure/unknown
  state. New process health/proof is a separate parent-runner obligation; the
  adapter's `started` journal is not deployment completion.

## Timeout and failure limits

The stock watcher still gives its synchronous service invocation 40 seconds;
the helper's individual command bound is 60 seconds. A slow cutover can therefore
end with a stopped gateway or unknown dispatched effect. Do not infer rollback
or safe replay from timeout, SIGTERM, a claimed file, or a running phase. Parent
death/phase loss is checked before later effects; an already dispatched native
stop/start or key-init child is not a transactional operation that can be recalled.
The stopped-old boundary keeps such an interrupted init from re-exposing its key
through the legacy process. Inspect receipts, actual lifetime/listener/key state
before any scoped recovery; never start old code or auto-rotate/adopt the key.

These semantics are consistent with upstream systemd's explicit-stop behavior
and control-group termination, and Node's synchronous child timeout behavior:
[systemd service](https://raw.githubusercontent.com/systemd/systemd/v252/man/systemd.service.xml),
[systemd kill](https://raw.githubusercontent.com/systemd/systemd/v252/man/systemd.kill.xml),
[Node22 child processes](https://raw.githubusercontent.com/nodejs/node/v22.23.0/doc/api/child_process.md).
Service policy is not a substitute for the measured process/cgroup/TCP boundary.
The fixtures substitute service-manager/Git I/O, controlling real owned children;
they do not claim a production systemd restart or benchmark its duration. No
host service control was executed. Arbitrary privileged manual starts, detached
old code outside the captured unit, malicious root and frontend substitution
remain outside this cooperative rollout contract.

## Independent checks and unchanged artifacts

All checks ran sequentially via `codex-heavy`, one worker, Node22 heap1024MiB:

- `/tmp/r5-independent-80-controls.log`, unit
  `codex-heavy-e6f22e0eb34d4d769d713aed108a7665.service`: **80/80 controls,
  zero skipped**, old/new real fake-process CLI lifecycle, exact seal/artifacts.
- `/tmp/r5-independent-boundary-probes.log`, unit
  `codex-heavy-e6e3518e17a24587b8654cd1aacdde88.service`: **four new acceptance
  controls + one inverse R6 reproduction**, lint zero warnings/errors.
- `/tmp/r5-sealed-unchanged-infra.log`: sealed infra, payload and dependencies
  match the previously reviewed 37d8d5d release, so its safe nonroot Nginx fixture
  evidence is reused. No Nginx fixture or host metadata/config command was run.

Artifact checks confirm 46 backend JS/maps against the prior independent build,
33 client files, 114 application sources in maps, fourteen graph entries, exact
SW, package/lock, jose6.2.12, Vitest4.1.11 and Workboardbc66e80. No app rebuild or
full app test suite was repeated. Source00f9e197 adds only the accepted report
and two controls relative to APP80843c0. Hours JS remains
`b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93`, map
`6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8`; generator,
history/session/data files stay outside the replacement allowlist.

Focused independent probe command (inside a bounded job):

```sh
REVIEW_RELEASE=/root/.local/state/codex-remote/releases/secure-api-80843c0-review-key-cutover-8b395de \
node --test --test-concurrency=1 --test-name-pattern=CR2 \
  scripts/secure-release/key-preprovision-review.node-test.mjs
```

## Infrastructure and handoff

The user already authorized deployment. No new user permission is requested by
this review. Leader reports the user-created proxied wildcard now resolves the
seven preview names; CR3 separately prepares exact-host TLS/parked ingress.
Those authorized changes can invalidate the old live Nginx baseline. This review
checked the **immutable** release and intentionally did not run its live
`--check` against concurrent infra mutations. Neither DNS failure from yesterday
nor expected baseline drift is being reported as a new runner failure.

This review-only seal is not activation eligible. After R6 is corrected, create
and review a NEW final baseline/seal with actual cert/SAN/renewal/canary/strict-mode,
Workboard and genuine clean-profile/operator readiness evidence. Do not fabricate
receipts, provision early, or treat browser cleanup as proof against arbitrary
legacy compromise. App acceptance remains scoped and unchanged.

At final read-only check, production main is clean at783b1e3, gateway PID1758426
active and Hours hash unchanged. No merge/push-main, deployment/arm/restart,
production key creation/rotation, model turn or real Hours mutation was performed.
All fixture children/listeners were owned and cleaned; other checkouts and all
old seals remain untouched.
