# Independent runner review: dffb132 (2026-09-21)

**Decision: changes required; do not arm this release.** One P1 and three P2
findings below concern the deployment runner. The bounded application acceptance
of `80843c0947c5e665a51a6207dbb871bf2c06a421` remains separate and unchanged.
No production mutation, key provisioning, main integration, unit arming or restart
was performed. The user has already authorized the security deployment; missing
technical readiness is not a request for another user authorization.

Reviewed exactly:

- Runner source: `dffb1326c1fca11868ecff739f7b7f189befc62e`.
- Release: `/root/.local/state/codex-remote/releases/secure-api-80843c0-review-dffb132`.
- Seal SHA256: `056e3973514e26126c2801db84c5a3d5a21cd3dfa48a92634f9242549e181b69`.
- Sealed `runner/production.mjs`: `c1eb34543168e59f07d47db2537020b62daa82a20fff3f704db36db7bd45d628`.
- Sealed `runner/runner.mjs`: `7e1880186cc0cdb2fb418aae96077ec97ad56d8c4076d4c5ffdf28ceb1f49050`.
- Review worktree: `/root/WORKTREES/cr-secure-release-review`, branch
  `review/secure-release-dffb132`. Added tests/report only; original runner and
  immutable release remain unchanged.

## R1 — P1: source integration breaks live maintenance before idle

Locations: `docs/security/secure-release-preparation.md:147-151`,
`scripts/secure-release/production.mjs:43-48,95-100,138-140`,
`scripts/secure-release/build.mjs:73-80`.

Activation requires local and remote main to be the new app **before** the runner
waits for idle (up to twelve hours). The new Knowledge, Services and restart CLI
import `secure-maintenance.mjs`, which imports new compiled modules absent from
the still-old live `dist-server`. Commands fail with `ERR_MODULE_NOT_FOUND` for
`secure-client.js` immediately, even without attempting HTTP. The sealed `old/`
closure contains the watcher and its dependencies, not Knowledge/Services CLI.
Thus preserving the runner's watcher does not preserve the maintenance commands
used by conversations still active during the wait.

Using the sealed NEW operator commands is not a workaround: their complete
closure calls `/api/secure/setup`, which the old gateway does not implement. The
isolated HTTP reproduction returns 404 and the actual new CLI fails with
`Secure setup unavailable`. No plaintext fallback should be added to solve this.

Reproduction: inverse test R1 builds a private source/runtime transition from the
release snapshots; old Knowledge/Services/watcher are successful controls against
a cookie-authenticated fake old HTTP service. Replacing only scripts with actual
new versions breaks all three. Actual sealed NEW Knowledge/Services commands
also fail against that old service. No production credentials or requests used.

Minimal fix: keep production main at BASE during the wait; perform the verified
fast-forward/source-and-remote transition as an explicit runner phase **after**
ALL-idle, ingress gating and the final readiness check. Guard both expected
BASE and target APP, dirty source, remote movement and concurrent integration.
Alternatively deliver and document a complete frozen OLD maintenance interface
usable by every active caller until cutover; freezing only the watcher is not
sufficient. Do not ask the user to reauthorize the already authorized deployment.

Acceptance: continuously run actual Knowledge/Services reads and representative
checked writes against a fake old gateway while the fake turn stays busy; all
must succeed throughout the waiting phase. No source switch while busy. After
gating/idle and replacement, normal new CLI must succeed using the required
tunnel, and old cookie-only private requests must fail. Include idle becoming
busy again and remote/source drift controls.

## R2 — P2: activation receipts and key/infra readiness go stale during wait

Locations: `scripts/secure-release/production.mjs:85-103,138-146` and
`scripts/secure-release/runner.mjs:15-31`.

`gates(true)` verifies authority age (<1 hour), evidence references/age (<24
hours), remote main, owner-key readiness and actual DNS/TLS/canaries only in
preflight. The subsequent twelve-hour wait checks stable files and the immutable
seal. `preCopy()` does not revalidate these external gates either. Expired or
replaced/withdrawn authority and evidence can therefore pass through to mutation.
Likewise key readiness and certificate evidence are not refreshed at that point.
The new-backend key read happens after file replacement/restart, too late to
serve as a precondition on mutation.

Reproduction: inverse R2 evaluates the **unchanged production adapter** in a VM
whose filesystem, commands, time, key module, DNS/TLS and canary fetch are all
synthetic. Valid preflight performs fourteen TLS checks and one key read. Advance
time two hours and replace both external receipts with withdrawn records:
`drift()` and `preCopy()` still succeed and do not recheck key/TLS. This is not a
claim of resistance to malicious root; it is an operational stale-gate failure.

Minimal fix: bind the accepted evidence/authority bytes and relevant nonsecret
key identity/metadata at arming, then recheck references, freshness, source/remote,
key validity and infrastructure immediately before the **first** mutation and
again at the final pre-copy boundary as appropriate. Define whether authority
expires at arming or execution; enforce that same policy in docs and code.
If a long wait outlasts the chosen execution lifetime, abort without mutation or
require a freshly recorded leader readiness receipt under the existing user
authorization. Do not manufacture a human profile receipt automatically.

Acceptance: fake long idle waits, evidence withdrawal/file change, authority
expiry, key removal/rotation and DNS/certificate drift must prevent writes;
fresh unchanged gates must still allow the sequence. Revalidation must not create
a circular requirement that DNS/TLS preparation wait for a provisioned app key.

## R3 — P2: config replacement overwrites intervening drift undetected

Locations: `scripts/secure-release/production.mjs:58-62,119,141-146,204-206`;
also apply the same discipline to dependency/env and Workboard drop-in writes
at lines 170-179 and 192-198.

The last pre-gating stable check precedes the second readiness HTTP call and
private backups. `installConfig()` checks only for a symlink, writes the new file
and records **its own replacement** as expected. A legitimate operator change
after the last check is overwritten. `preCopy()` cannot detect that loss: it
excludes those Nginx paths from baseline comparison and checks the newly written
digest instead. The same helper is used when opening ingress.

Reproduction: inverse R3 runs actual adapter preflight/drift, changes the fake
admin vhost, then calls actual `gateIngress()` and `preCopy()`. Both succeed;
the intervening bytes are gone and the fake Nginx reload was called. No host
metadata/config was used or modified by this test.

Minimal fix: compare each destination's full expected preimage immediately
before writing (baseline for first install, previous owned digest/metadata for
later stages). Coordinate concurrent deployment writers with a shared lock;
per-release locks alone do not serialize unrelated deployments. Check absence
before creating new snippets/drop-ins and track new/excluded config entries.
Repeat relevant dependency pointer/env preimage checks at their actual swap.
These checks are for cooperative operational concurrency, not an atomic CAS
against arbitrary privileged attackers.

Acceptance: inject changes after readiness/backup and before each config swap,
including opening ingress; abort without overwriting the intervening file or
reloading a conflicting config. Unchanged controls complete normally.

## R4 — P2: bookkeeping clears durable publication evidence during OOM/crash

Locations: `scripts/secure-release/runner.mjs:9,49-53` and
`scripts/secure-release/production.mjs:137`.

The runner writes `postverify-complete` with evidence, then `step('bookkeeping')`
immediately replaces the marker with a record that omits evidence. Successful
completion, a caught exception or SIGTERM restores it from memory. SIGKILL/OOM
or power loss during a Services/Vault request cannot do so; disk retains a
bookkeeping marker without the already established live publication proof.
`publication-receipt.json` is only written at the end of bookkeeping.

Reproduction: inverse R4 captures the marker from inside the unresolved
bookkeeping step: no evidence remains. A graceful-success control does retain
it. The test does not induce OOM or kill any real process.

Minimal fix: have every state transition preserve established verification
evidence, or durably write an independent immutable postverify receipt before
bookkeeping and reference it from all later phases. Record Services and Vault
outcomes separately so recovery never reruns deployment or guesses that a
mutation did not happen. Never mark complete before all required checks finish.

Acceptance: an isolated child paused at bookkeeping can be killed and a fresh
reader still sees the verified PID/hashes/time/seal and incomplete bookkeeping;
SIGTERM, failure and success controls should retain that same evidence.

## Positively verified scope

- Exact immutable seal and runner bytes match dffb132. All 46 backend files
  match CR2's prior fresh independent 80843c0 server build, including maps; no
  rebuild/full app suite was repeated. All 33 client entries match inventory;
  114 embedded application source-map entries match Git blobs at APP. Module/
  lazy graph has fourteen entries and SW bytes match APP `public/sw.js`.
- Package and lock bytes match APP; staged jose 6.2.12 and Vitest 4.1.11 match
  the lock. The old watcher has six files and no new auth/config/dependency
  imports. The real fake lifecycle proves old auth works before replacement,
  fails against the required tunnel afterward, and the new encrypted adapter
  obtains complete idle readiness. This does not cure R1 for other CLI callers.
- Allowlist excludes Hours JS/map, generator/template, databases, history and
  session state. Hours JS stays
  `b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93`;
  map stays `6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8`.
  Excluded executable modules match candidate; existing event-hub debug map is
  deliberately preserved and its difference is recorded.
- Dual complete ALL-idle/zero-pending checks separated by five seconds, third
  pre-copy check and the stock old watcher's own dual checks exist. Unknown,
  busy, pending and incomplete states fail closed in focused tests. No new
  agent turns, real pause/resume, session revocation or preview ticket mutation
  was tested in production. Gating is an ingress boundary, not a global lock
  against unrelated privileged local clients; the final watcher remains needed.
- Private backup uses SQLite's backup API, not raw live DB/WAL copying. The
  activation root is 0700 and secret backups are 0600. Six nonsecret env fields
  are merged; login secrets/workspaces/fullAccess are retained. Key CLI stays
  outside File roots with 0700/0600 and emits no key. No key was provisioned.
- Assets precede index; old hashes remain. Backend swap/dependencies/env are
  gated, then fresh PID/cwd/entry/encrypted proof, Workboard, index, ingress,
  complete body verification, Services and checked Vault publication. No
  automatic rollback/plaintext downgrade/database restore exists. Partial
  publication and failures require scoped operator recovery; see R4.
- Workboard payload equals `bc66e80daf1d548900a8f532151d1bff932c1623` header-only
  patch. Drop-in keeps loopback canonical upstream Origin, Secure cookie,
  existing data directory and exact admin frame ancestor; preview proxy handles
  upstream Origin rewriting. Legacy admin `/workboard` paths redirect to
  `/services`, with no same-origin content or plaintext ticket exception.
- Three staged Nginx combinations syntax/start and legacy redirects passed via
  the safe nonroot fixture with all five private temp paths, startup log, strict
  filesystem and loopback restrictions. Host Nginx process identity and temp
  inode/ownership/mode were unchanged. Never ran old `check-nginx.py`.

## Remaining operator gates and trust limits

DNS/TLS/profile/Workboard receipts and a new reviewed runner/seal remain required.
Do not arm dffb132 even if DNS becomes ready. Actual exact-host public canaries,
normal origin and edge certificate validation, exact-SAN provisioning/renewal,
effective trusted-proxy config and Full (strict) evidence must be real. Existing
zone Full (strict), with no overriding hostname rule, can satisfy the effective
policy; no unnecessary global or per-host change is mandated. Certificate
hostname verification alone does not prove the Cloudflare policy or exact SAN
scope, so those remain operator evidence, not automated claims.

Complete DNS/cert/parked-vhost preparation before a NEW baseline/seal. The current
seal captures bootstrap Nginx; legitimate TLS changes should invalidate it, not
be bypassed. Key provisioning is independently authorized but not needed merely
to prepare DNS/TLS. Record actual readiness afterward; do not fabricate approved
booleans, profile timestamps, fingerprints or evidence reports. Replace README's
ambiguous “separate authorization” wording with recording the existing user
authorization and current technical readiness by the leader.

A fresh-profile procedure is a human migration gate, not proof that arbitrary
old tabs/service workers/extensions are uncompromised. Keep credentials/owner key
out of retired profiles. Read-only live verification can prove loaded code,
health, assets, encrypted proof and legacy rejection; it cannot prove live
mutation/revocation/ticket lifecycle. Those remain exact-app isolated fixture
evidence. Root/XSS/frontend substitution and hostile privileged filesystem writes
are not solved by this runner review.

## Reproduce checks

All ran sequentially in `codex-heavy`, one worker, Node22 heap1024MiB:

```sh
REVIEW_RELEASE=/root/.local/state/codex-remote/releases/secure-api-80843c0-review-dffb132 \
node --experimental-vm-modules --test --test-concurrency=1 \
  scripts/secure-release/runner.node-test.mjs \
  scripts/secure-release/independent-review.node-test.mjs
node scripts/secure-release/independent-artifacts.mjs RELEASE PRIOR_CR2_BUILD_WORKTREE
node scripts/secure-release/lifecycle-fixture.mjs RELEASE
node scripts/secure-release/nginx-stage-fixture.mjs RELEASE
oxlint scripts/secure-release
```

**32 tests passed: 28 existing controls plus four inverse defect reproductions.**
Green inverse tests assert the defects above, not a passing release verdict.
Artifact/lifecycle/safe-Nginx checks passed; lint zero warnings/errors. Logs:
`/tmp/secure-release-independent-review.log` and
`/tmp/secure-release-artifacts-lifecycle.log`. Heavy units
`codex-heavy-9111c66c33f04fe89d3892aece1bd7c6.service` and
`codex-heavy-338cfba65e2a492b82cfb8e9f78487c7.service` ended inactive/exit0.
The VM harness evaluates unchanged production adapter source with synthetic
I/O; it is not an end-to-end production deployment simulation. No claim is made
that these cases exhaust failure or race schedules.
