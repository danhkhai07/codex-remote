# Leader second rollout — prepared, not armable

Task `eaed96a1-7b48-4a31-8e7c-dbcb0853bd06`. Preparation branch
`prepare/leader-post-security-release`, worktree
`/root/WORKTREES/cr-leader-post-security-release`, created from exact pushed
review `10f52e9410dd593e9182483701f043b43338ccf1`.
Actual task receipt: **gpt-6-astra / max**, turn
`01a0c83c-1af3-7821-9b55-e081930d9133`. No delegated agents or test model turns.

**This document prepares a SECOND rollout. It does not authorize arming now.**
At preparation, security has not gone live: main `783b1e3`, PID `1758426`.
Actual security profile/operator facts and owner-key provisioning are still the
first rollout's responsibility. This package cannot establish those facts.
No post-security observation, backup, activation record, key or state is staged.
No first-rollout file/seal has been changed. Root reviews this bounded package;
there is no further autonomous source-review loop.

## Accepted source and exact payload

- Expected prerequisite source: `00f9e197285e9c918372367f626c0b744d47d0d6`,
  app `80843c0947c5e665a51a6207dbb871bf2c06a421`.
- Target source: `10f52e9410dd593e9182483701f043b43338ccf1`; product
  `b8c781a886017746c0b588ff3290d8df914477d6`. Security source is an ancestor.
  The b8→10f delta contains only independent tests/report.
- CR3 decision SHA256:
  `ce29b540bd2db93b82a4dfed0219dfd53c226f5d509ca581002347facd8e31c6`.
  L1 closed; L2/L3 remain closed. Source acceptance is not live activation.
- Accepted artifact manifest `/tmp/cr-native-create-artifacts.json`, SHA256
  `a56af4f751b9fd3bf651f591f38ef2c7e29ca42846387fb3581239ec5c725fab`.
- Root-private stage:
  `/root/.local/state/codex-remote/releases/leader-post-security-10f52e9-eaed96a1`.
  `payload/` has **6 backend artifacts + the whole matching 25-file client**.
  Directories 0700, files 0600, ordinary independent files, no links or state.
  `contract.json` and `prepared.json` are the only additional files.
- [Machine-readable source contract](leader-post-security-source.json) records
  every target SHA, old→new backend SHA, dependencies via expectedRuntime,
  source-map/client graph provenance and evidence hashes. It is explicitly
  **EXPECTED-POST-SECURITY-CONTRACT**, `observedPostSecurity:false`, `armable:false`.
  Its projected runtime is never a claim of an observed post-security baseline.

| Backend path under dist-server | Security SHA256 → Leader SHA256 |
| --- | --- |
| controller.js | `244dcd2b28642aeaaef629150e3041193c5bd7af8663731b993f7e0971dd133f` → `f7e041f6a7a12bfe789f3e4fd52f3e6b88d45ee167a93713907415baa2ed793d` |
| controller.js.map | `f2975e5eed18740ec4d68ad39ba220691e42f5e98664a4206b09c9a62845a77d` → `79a0483d59bf77b43ebb3e7862a3e2c1ab7d2882e89bf7cc563fcbcc7361694f` |
| http-app.js | `5c718756d635515ee4402af48141a6fe840f69f5c0fa25d922dbf8808af1fc14` → `1a3e4d21e0f5154a746ded3d3a9440493d60618ded2ce1b742cfa60db99342f0` |
| http-app.js.map | `e6a80445340c8fb1d80d6d75c0ffe4d0139d55c7f8b5742e2c9ac1b80c924286` → `e55e6b39060d87f8bd7445e3c9d6dbd102f52d9100a22b2fe684668a35e4e19f` |
| orchestration.js | `3e56e26620dba7a024826a756fc99fb506fc52b78b80f2fb5efbff22f6135dda` → `b26415e206cbea0e987c5d5615a718b2ceb3bef9e0edb00f904fc5e6ff2115c5` |
| orchestration.js.map | `c8c5c2006a41a3159fff2acd80719c34e03442720c180616bbff1d6153318540` → `d3a02f276d0e1356d0cb37ef14c71b1b4e954c0d47c7f2535b55f96105a52c55` |

Client index: `554846255773e35b4dd367413481e1ffc8839a3940dad68f2948c6447e7b9d20`.
Entry `assets/index-BssRLWrJ.js`; CSS `assets/index-3gFugtZF.css`; runtime
`assets/rolldown-runtime-aKtaBQYM.js`. Publish all 25 matching files, retain old
hashed assets, **index last**. Do not copy the whole dist-server tree.

No new dependencies. Package SHA `3607fc96d0f9a8a0b8f6d0a9a73d2ccb2d78a8458508e88bdf21e8710564e93f`;
lock SHA `69edca67f6da0ca9c5c52a75c9000be52fed0b1b69e49ca8275b7e6e0db8d7a4`.
Leave node_modules, native binary, native driver, secure transport, auth/session
modules, operator scripts, config, systemd, Cloudflare/IP snippet and Workboard
unchanged. The only temporary infrastructure action later is the reviewed ingress
gate, followed by restoration of the exact observed active Nginx bytes.

Security intentionally preserves **event-hub.js.map** SHA
`a9f820a365e6cca09a1cbce123381795f1eba328b6f5572b70a6503c64f08c33`.
The candidate's differently mapped byte is excluded. Every other excluded backend
artifact also keeps its expected/then freshly observed hash.

Hours stay unchanged:

| File | SHA256 |
| --- | --- |
| dist-server/work-hours.js | `b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93` |
| dist-server/work-hours.js.map | `6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8` |
| /root/VAULTS/Flint-Software/Working-Hours/update.py | `c02407485a8459b2f6b66248758cd3881556e307cd5fa1938c98a0713a67b0ae` |
| /root/VAULTS/Flint-Software/Working-Hours/dashboard.template.html | `a6f80820e4a9c7c3a8034913b9aefacba03586144081451a9e6a30be4a31e1fe` |

Do not replace generated index/data, timer, totals, pause state or cron, or use a
real pause/resume/resolve/dispatch to verify the package.

## Checks reused and preparation checks

Reused unchanged bytes: 90 backend files, 46 original security entries, 25 client
files, 9 reachable client entries and 58 source-map sources. Source/map emission
was checked in the accepted manifest. Source equality from b8 to10f binds those
checks to the stage; every staged byte matches both preserved author and reviewer
outputs. This preparation verified 65 referenced evidence/support files, including
31 screenshot files and prior full527+11 checks, author171 checks/server build,
and independent16 unique cases/18 executions. No application rebuild, broad suite,
browser or crypto audit rerun is justified by a documentation/packaging change.

The preparation-only helper has `stage`, `verify`, `observe`; **no arm/apply/restart
verb**. 28 Node fixture cases verify private/exact staging, tampering/links,
no-overwrite, wrong/incomplete/unbound security proof, wrong source/PID/config,
backend drift, absence of activation verbs, runbook syntax/hash consistency, and refusal before reading config or creating an observation on
old source. Lint passes. Evidence:
`/root/.local/state/codex-remote/leader-post-security-preparation-eaed96a1/`.
All checks use codex-heavy sequentially, one test worker, 1024MiB Node heap.

Safe next command now (does not arm):

```sh
cd /root/WORKTREES/cr-leader-post-security-release
codex-heavy --label leader-package-verify --timeout 180 -- \
  env NODE_OPTIONS=--max-old-space-size=1024 node scripts/leader-post-security-package.mjs verify \
  /root/.local/state/codex-remote/releases/leader-post-security-10f52e9-eaed96a1
```

## Future prerequisite: actual security completion

Only root proceeds after the independent initial security activation completes.
Do not execute its init-key runner, `productionOps`, `--apply`, a PATH shim, key
provisioning, key rotation or Workboard activation as part of this second rollout.
No overlay onto old783 is permitted. Do not reseal or add this payload to the first
package. Its actual `.activation/attempt.json` must be complete, with a publication
reference whose path/hash matches `.activation/postverify.json` for app808/source00f9.
Root also checks actual profile/operator readiness from that completed activation;
this helper cannot infer those user actions from hashes.

Capture a **new actual observation**, not a copy of the first package's old baseline:

```sh
umask 077
PREP=/root/WORKTREES/cr-leader-post-security-release
STAGE=/root/.local/state/codex-remote/releases/leader-post-security-10f52e9-eaed96a1
ATTEMPT=/root/.local/state/codex-remote/leader-post-security-10f52e9.activation-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -m 700 "$ATTEMPT"
cd "$PREP"
codex-heavy --label leader-post-security-observe --timeout 180 -- \
  env NODE_OPTIONS=--max-old-space-size=1024 node scripts/leader-post-security-package.mjs observe \
  "$STAGE" "$ATTEMPT/observed.json"
```

On current783 this fails before config/proof reads and writes **no observation**.
After security it checks clean main/local+remote00f9, completed bound security
proof, required encryption, replacement PID, all expected bytes and exact backend
file set. It records actual complete retained client/backend hashes, config/unit
hashes, process identity/cwd, command hash and remote URL hashes. Output remains
`armable:false`, `allIdleProven:false`, `backupTaken:false`. It does not read an owner
key or write production. Extra retained client assets are captured as actual facts,
not invented from a projection. A source/runtime discrepancy blocks this package;
root must reconcile a changed prerequisite instead of replacing the contract silently.

Root reviews the actual observation and records this second activation decision
under existing deployment consent in the new private attempt directory, binding
contract SHA, target10f, actual observation SHA, operator and timestamp. That is the
last operational decision before arming. No such authorization is recorded now.

## Future execution order and narrow operator commands

These are **future root commands**, not a new deploy runner. Use one persistent
operator Node session outside the gateway service; hold the existing shared lock
through publication/bookkeeping. An interrupted session leaves its lock/evidence for
inspection; never automatically delete a stale/foreign lock. The first package's
reviewed utilities are reused read-only, with their hashes pinned in the contract.
Do not import its runner/production/cutover modules.

Start in main after root has reviewed and bound the actual observation:

```sh
cd /root/RUNNING-SERVICES/codex-remote
umask 077
NODE_REPL_HISTORY=/dev/null node --env-file=.env
```

In that session use the actual `ATTEMPT` path just created. Declarations do not
print credentials; never print config, sessions, decrypted responses or raw state.

```js
const PREP = '/root/WORKTREES/cr-leader-post-security-release'
const STAGE = '/root/.local/state/codex-remote/releases/leader-post-security-10f52e9-eaed96a1'
const ATTEMPT = '/replace-with-the-actual-new-attempt-directory'
const { readFileSync, mkdirSync, realpathSync } = await import('node:fs')
const { join } = await import('node:path')
const C = JSON.parse(readFileSync(STAGE + '/contract.json'))
const FIRST = C.securityPackage, MAIN = C.main
const { createHash } = await import('node:crypto')
for (const name of ['common.mjs','lock.mjs','destinations.mjs']) { const p = FIRST + '/runner/' + name; if (createHash('sha256').update(readFileSync(p)).digest('hex') !== C.provenance.reusedEvidence[p]) throw Error('reviewed-utility-drift') }
const { assert, command, atomicBytes, record, fileHash, hash, same, serviceIdentity } = await import(FIRST + '/runner/common.mjs')
const { DeploymentLock } = await import(FIRST + '/runner/lock.mjs')
const { Destinations, destinationSnapshot } = await import(FIRST + '/runner/destinations.mjs')
const lock = new DeploymentLock('/root/.local/state/codex-remote/deployment.lock', { task: C.taskId, source: C.targetSource, attempt: ATTEMPT, pid: process.pid })
lock.acquire()
const { loadConfig } = await import(MAIN + '/dist-server/config.js')
const { maintenanceClient } = await import(MAIN + '/scripts/secure-maintenance.mjs')
const { restartReadiness } = await import(MAIN + '/scripts/restart-readiness.mjs')
const config = loadConfig()
assert(config.secureApiRequired, 'required-encryption-only')
const git = (...args) => command('git', args)
const phase = (name, details = {}) => atomicBytes(ATTEMPT + '/progress.json', JSON.stringify({ phase: name, at: new Date().toISOString(), ...details }) + '\n', 0o600)
```

The imports above verify their pinned bytes first; verify the package using the
command above. Before
any mutation, compare main+remote/source/config/PID to `observed.json`, run `observe`
again under the held lock into a fresh `pre-copy-observed.json`, and bind that hash
in the attempt. Keep the observed dependency pointer/realpath/version and Nginx
preimages in the private attempt too. No npm install/build in main.

1. **Wait for ALL idle, zero pending, and orchestration drain.** All conversations,
   not only Leader folder or worker slots, must be idle; the operator pauses their
   own activity. Use the encrypted maintenance client only after security is live.
   Poll read-only; no release/cancel/acknowledge or scheduler stop to force readiness.
   A pending manually controlled job blocks; it is not permission to override it.
   Check twice five seconds apart, then again after ingress gating and immediately
   before source/copy/restart. Keep receipts private, storing counts/hashes only.

```js
const statePath = join(config.contextVaultPath, '.state/Orchestration.json')
async function idle() {
  const client = await maintenanceClient(config)
  try {
    const readiness = await restartReadiness(async path => {
      const r = await client.fetch(path, { signal: AbortSignal.timeout(10000) })
      assert(r.ok, 'encrypted-idle-read'); return r.json()
    })
    const state = JSON.parse(readFileSync(statePath))
    assert(state.version === 1 && Array.isArray(state.tasks) && Array.isArray(state.notices), 'state-schema')
    const busy = state.tasks.filter(t => ['creating','queued','starting','running','stopping'].includes(t.status) || t.dispatchPending === true)
    const sending = state.notices.filter(n => ['pending','sending'].includes(n.status))
    assert(readiness.ready && !busy.length && !sending.length, 'not-fully-drained')
    return { ...readiness, busyTasks: busy.length, sendableNotices: sending.length, stateSha256: fileHash(statePath) }
  } finally { client.close() }
}
const firstIdle = await idle()
await new Promise(resolve => setTimeout(resolve, 5000))
const secondIdle = await idle()
```

`review`/`unknown` report delivery and inactive failure are preserved evidence, not
acknowledgements or queued sends. Do not require resolving historical errors for
release. A true `dispatchPending` is still a blocker. Legacy missing dispatch
markers are left for the accepted startup reconciliation; no guessed settlement.

2. **Capture preimages and gate ingress using the reviewed files.** Record exact
   active config bytes and dependency pointer, check they match the completed
   security publication. Guard every destination using `Destinations`. Reuse only
   the reviewed admin-maintenance/preview-parked files; do not rewrite CF or TLS.
   Check nginx syntax before reload. Keep all old clients/assets until success.
   If gate reload fails, stop and use the phase-specific recovery below.

```js
const sites = { admin: '/etc/nginx/sites-available/codex.danhkhai.io.vn', preview: '/etc/nginx/sites-available/codex-preview-ports' }
const paths = Object.keys(C.payload).map(p => join(MAIN, p)).concat(Object.values(sites))
const snap = destinationSnapshot(paths)
const dest = new Destinations(snap.entries, snap.parents)
const activeNginx = Object.fromEntries(Object.entries(sites).map(([n,p]) => [n, readFileSync(p)]))
for (const [name, bytes] of Object.entries(activeNginx)) assert(hash(bytes) === C.provenance.reusedEvidence[FIRST + '/infra/' + name + '-active.conf'], 'unexpected-active-ingress')
const stable = { env: record(MAIN + '/.env'), unit: hash(command('systemctl',['cat','codex-remote.service'])), dependencies: record(MAIN + '/node_modules'), dependencyPath: realpathSync(MAIN + '/node_modules'), process: serviceIdentity('codex-remote.service') }
atomicBytes(ATTEMPT + '/preimages.json', JSON.stringify({ snap, stable }) + '\n', 0o600)
for (const [name, bytes] of Object.entries(activeNginx)) atomicBytes(ATTEMPT + '/nginx-' + name + '.before', bytes, 0o600)
phase('gate-ingress-before-dispatch')
for (const [name, file] of [['admin','admin-maintenance.conf'],['preview','preview-parked.conf']]) { const bytes = readFileSync(FIRST + '/infra/' + file); assert(hash(bytes) === C.provenance.reusedEvidence[FIRST + '/infra/' + file], 'gate-drift'); dest.write(sites[name], bytes, snap.entries[sites[name]].mode) }
command('/usr/sbin/nginx', ['-t'])
command('/usr/bin/systemctl', ['reload','nginx'])
await idle()
```

3. **Fresh private backup after gate/drain, before source or artifact changes.**
   Create `ATTEMPT/backup` exclusively, mode0700. For the 31 payload destinations,
   back up every existing preimage (including index) as ordinary600 files with
   path/mode/hash; record absent targets explicitly. Also preserve the current
   `.env` privately for incident evidence, not for routine replacement, and the
   exact Orchestration.json / Groups.json / Conversations.json state files. Check
   state hashes before/after this capture; any change aborts and requires a new
   observation after quiescence. No key copy, whole DB/WAL copy or Workboard backup.
   No backup exists yet at preparation. Example uses the reviewed atomic writer:

```js
mkdirSync(ATTEMPT + '/backup', { mode: 0o700 })
const stateFiles = ['Orchestration.json','Groups.json','Conversations.json'].map(n => join(config.contextVaultPath, '.state', n))
const stateBefore = Object.fromEntries(stateFiles.map(p => [p, fileHash(p)]))
const backupManifest = {}
for (const p of Object.keys(C.payload)) { dest.check(join(MAIN,p)); const before = record(join(MAIN,p)); backupManifest[p] = before; if (!before.absent) { const bytes = readFileSync(join(MAIN,p)); assert(hash(bytes) === before.sha256, 'backup-source-drift'); atomicBytes(join(ATTEMPT,'backup',p), bytes, 0o600) } }
const envBytes = readFileSync(MAIN + '/.env')
assert(hash(envBytes) === stable.env.sha256, 'config-drift-before-backup')
atomicBytes(ATTEMPT + '/backup/original.env', envBytes, 0o600)
for (const p of stateFiles) { const bytes = readFileSync(p); assert(hash(bytes) === stateBefore[p], 'backup-state-drift'); atomicBytes(ATTEMPT + '/backup/state/' + p.split('/').at(-1), bytes, 0o600) }
same(Object.fromEntries(stateFiles.map(p => [p,fileHash(p)])), stateBefore, 'state-changed-during-backup')
atomicBytes(ATTEMPT + '/state-before.json', JSON.stringify(stateBefore) + '\n', 0o600)
atomicBytes(ATTEMPT + '/backup-manifest.json', JSON.stringify({ artifacts: backupManifest, state: stateBefore, configSha256: hash(envBytes) }) + '\n', 0o600)
await idle()
dest.all()
```

4. **Guarded source transition, then matching artifacts.** Recheck unchanged PID,
   config/unit/dependencies, expected runtime, clean main, remote URLs and remote
   main00f9 after the final HTTP await. No source drift is silently incorporated.
   Record each outcome before dispatch. Fast-forward **only to target10f**, not the
   preparation branch; verify push outcome explicitly. No force push/reset.

```js
assert(git('branch','--show-current') === 'main' && git('status','--porcelain','--untracked-files=all') === '', 'dirty-or-wrong-main')
assert(git('rev-parse','HEAD') === C.securitySource && git('ls-remote','origin','refs/heads/main').split(/\s+/)[0] === C.securitySource, 'source-preimage')
git('merge-base','--is-ancestor',C.securitySource,C.targetSource)
phase('source-local-dispatching-outcome-unknown')
git('-c','core.hooksPath=/dev/null','merge','--ff-only','--no-edit',C.targetSource)
phase('source-local-confirmed-remote-pending')
assert(git('rev-parse','HEAD') === C.targetSource && git('status','--porcelain','--untracked-files=all') === '', 'source-after-ff')
assert(git('ls-remote','origin','refs/heads/main').split(/\s+/)[0] === C.securitySource, 'remote-drift-before-push')
phase('source-push-dispatching-outcome-unknown')
git('-c','core.hooksPath=/dev/null','push','--porcelain','origin',C.targetSource + ':refs/heads/main')
assert(git('ls-remote','origin','refs/heads/main').split(/\s+/)[0] === C.targetSource, 'push-not-confirmed')
phase('source-confirmed')
function publish(p) { const bytes = readFileSync(join(STAGE,'payload',p)); assert(hash(bytes) === C.payload[p], 'staged-drift'); dest.check(join(MAIN,p)); if (record(join(MAIN,p)).sha256 !== C.payload[p]) dest.write(join(MAIN,p), bytes, snap.entries[join(MAIN,p)].mode ?? 0o644) }
await idle()
for (const p of Object.keys(C.payload).filter(p => p.startsWith('dist/') && p !== 'dist/index.html')) publish(p)
phase('assets-staged-index-unchanged')
for (const p of Object.keys(C.payload).filter(p => p.startsWith('dist-server/'))) { phase('backend-copy', { path: p }); publish(p) }
```

Check all six new backend hashes, all excluded old hashes, dependency/config/unit
preimages and old index before restarting. Old loaded modules are not proof that
an accidental service restart has not occurred: require the exact old PID/start
identity and no other deployment owner. Abort if that identity changes.

5. **Ordinary ALL-idle restart outside gateway**, after root arms this attempt.
   Use the existing source-identical encrypted watcher. It rechecks every listed
   conversation and pending request twice; the additional orchestration drain
   above is required because the watcher alone does not cover queued work.
   No first-cutover init-key adapter, PATH shim, owner provisioning or config change.

```sh
# FUTURE ONLY; run from main, after guarded copy and final drain checks above.
systemd-run --unit=codex-remote-leader-post-security-10f52e9 --collect \
  --property=WorkingDirectory=/root/RUNNING-SERVICES/codex-remote \
  --setenv=NODE_ENV=production --setenv=PATH=/usr/local/bin:/usr/bin:/bin \
  /usr/bin/node --env-file=.env scripts/restart-when-idle.mjs
```

Wait for that specific unit and `/root/.local/state/codex-remote/restart-when-idle.json`
to report completion. Do not arm another watcher on timeout. The shared lock stays
with the operator session. Require a **new PID, InvocationID and later monotonic
start**, same entry cmdline hash/cwd, active service and local health. A hash on disk
alone does not prove the new process loaded the new modules.

6. **Verify new backend through encrypted reads before publishing index.** Create
   a fresh maintenance client/session after restart (close the old one). Require
   `/api/session`, `/api/pending`, `/api/working-hours` success; pending must be zero.
   `/api/conversation-groups` and each folder's accessible member
   `/api/threads/<id>/orchestration` must expose `limits.concurrent === 8`, retained
   task original statuses/results, safe model/effort settings and per-task delivery
   metadata. Disk remains schema version1. Resolution metadata, manual pauses,
   epoch, existing failed/interrupted receipts and newer recovery must remain;
   constructor reconciliation can legitimately update delivery/dispatch metadata,
   so do not demand whole-state byte equality or restore its old snapshot.
   Catalog GET can confirm available Astra/Sol efforts without dispatching a turn.
   Do not exercise resolve/spawn/cancel or provoke a real error as a smoke test.

7. **Publish index last, restore exact observed ingress, postverify and record.**

```js
publish('dist/index.html')
phase('index-published')
for (const [name, bytes] of Object.entries(activeNginx)) dest.write(sites[name], bytes, snap.entries[sites[name]].mode)
command('/usr/sbin/nginx', ['-t'])
command('/usr/bin/systemctl', ['reload','nginx'])
phase('ingress-restored-postverify-pending')
```

Postverify local `http://127.0.0.1:5173` and actual public origin: fresh health and
full response-body hash of index and **every non-map file of the matching25** with
cache bypass, all25 filesystem hashes including maps, old hashed assets retained,
six new backend and every excluded module unchanged. Check cookie-only authenticated
`GET /api/threads` still returns403 in required mode; encrypted reads and an encrypted
SSE initial event work. Close the test session/stream. No logout, tickets, rotation
or replay mutation probes on live; their accepted isolated evidence is unchanged.
Check Hours JS/map/generator/template hashes above, config/unit/dependency pointer
and source local+remote10f. Preserve Workboard and secure transport untouched.

Write a new private `postverify.json` (not the security proof), binding contract,
actual baseline/backup hashes, source/product, new process identity, artifact/network
hashes and successful encrypted read checks. Do not store token/CSRF/plaintext task
contents. Only then update `/services` and Vault using existing encrypted CLIs;
this preparation did neither. Preserve the existing security release description,
append Leader8/model/history/recovery publication and exact10f/hash proof. Use
`npm run services -- list` then `register --path / --name 'Codex Remote' --branch main
--directory /root/RUNNING-SERVICES/codex-remote --pr 'No PR · Leader 10f52e9' --summary
'<preserved security summary plus verified Leader publication>'`. Vault writes use
fresh checked revisions. Bookkeeping failure after publication is retryable by
reading actual registry/note state and reusing the proof; do not redeploy. Record
completion, close owned clients, and `lock.release()` only after assessing the final
state. Keep backup/proof private, update root's deployment handoff and runtime SHA
baseline so later releases cannot overwrite these six modules with old security bytes.

## Failure recovery depends on the completed phase

| Last phase reached | Required action |
| --- | --- |
| Observation only / waiting idle | No product mutation. Retain evidence, abort or obtain a fresh actual observation. Never fabricate readiness or force turns to stop. |
| Gate only, source/artifacts untouched | Guarded restore of the two exact active Nginx preimages, syntax check/reload; verify old source/runtime. Do not touch state/key/Workboard. |
| Source FF/push outcome unknown | Inspect both local HEAD and remote main first. Record the actual outcome; no blind reset, repeat push or force. Runtime may still be security even though source advanced. Keep ingress gated until a coherent decision. |
| Assets/backend partly copied, no replacement PID | Keep gate; compare per-file journal/preimages and all PID/start evidence. Complete the exact accepted set, or root may restore only changed artifact preimages if the old process definitely stayed alive and no new version started. Source/remote must be reconciled explicitly; never pretend a file restore also rolled back Git. |
| New process started or could have started | Treat newer orchestration writes as possible. **No automatic downgrade or whole-state restore.** Keep gate as appropriate, preserve evidence, prefer a reviewed forward fix. Any older-binary recovery requires explicit schema/unknown-settlement analysis against current state, not an old backup. |
| Backend verified but index/ingress/postverify incomplete | Finish only the missing verified publication steps after comparing actual destinations; don't rerun the restart/init-key sequence. Retain old hashed assets and current state. |
| Publication verified, bookkeeping failed | Reconcile Services/Vault using the recorded proof and checked revisions. Do not mark product activation failed merely because a note failed. |

No command restores a whole state DB, clears failure receipts, fakes delivered
reports/recovery, changes manual control, grows budgets, or rolls back native effects.
Unknown task creation/settlement remains unknown until exact evidence settles it.

## Optional post-live task reconciliation — separate work

- `c83e1387-d98b-4f20-a669-5a0fcecd108a` (Rename/Archive): only after this feature
  is live, recheck prior deployment/rename/archive evidence, exact original native
  settlement, current same-folder Code leader and epoch. Then, if authorized and
  justified, use the encrypted `POST /api/threads/<leaderId>/orchestration` with
  `{action:'resolve', leaderEpoch, taskId, summary, evidence}`. A409 is a guard to
  investigate, not permission to patch `.state`. Original failed/interrupted status
  and result remain; metadata describes a verified takeover outcome.
- `6beabd71-702f-42fd-aac2-dd7c7d36e572`: retain the failed historical receipt.
  Reassignment and subsequent implementation do not themselves prove the original
  task fully fixed, user Stop, or the production cause. Root found no native turn for
  that assignment; the admission race was plausible, not traced proof. Separately
  establish the scope/outcome and settlement before considering authorized API
  resolution. Do not resolve it during rollout or this preparation.
