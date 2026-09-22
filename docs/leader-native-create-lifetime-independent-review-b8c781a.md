# Independent native-create lifetime re-review at b8c781a

Decision: **accepted for the scoped source/feature change** at exact
`b8c781a886017746c0b588ff3290d8df914477d6`. The residual
**L1-admission-lifetime P2 is closed**. No remaining finding or new P1/P2 was found
in this delta. L2/L3 and the accepted app808/R1–R6/W1 scopes remain closed; they
were not reopened. This is not production activation approval.

Base: previous independent review `14cc1893c84a77a1de397c4371f9c1ad65d6e1ba`.
Task: `1e5eefe8-1924-45f6-8ddb-fa1cb120eda0`.
New worktree: `/root/WORKTREES/cr-leader-native-create-lifetime-review`.
Branch: `review/leader-native-create-lifetime`. Author and earlier review trees,
reports and decisions are preserved. Only review tests/report change here.

Read-only native receipt confirms **gpt-6-astra/max**, task-matching turn
`01a0c82c-7c66-7482-8d74-7078ae3eb9b8`. This is actual inherited settings;
no claim is made that model override is live. Author task6505858f implemented
this candidate. The prior failed6beabd71 task is untouched; its runtime failure
cause is not established by these tests.

## Source boundary verified

The small product delta has the required end-to-end callback:

- `server/orchestration.ts:37,:344-352`: the create signature requires a callback
  and receives `checkAdmission`, which captures lifetime and current capability,
  rejects cancelled admission and retains the existing role/membership checks.
- `server/controller.ts:77`: the adapter passes that exact callback as the existing
  fourth `createThread` argument; it does not replace or bypass HTTP authorization.
- `server/controller.ts:281-299`: validation is synchronous; `live` is checked
  before the single native request await and supplied to that request. The new
  check at`:297` runs after the reply, before `#markResumed` or `assignThread`.
- Unchanged `server/codex-app-server.ts:107-112` checks the callback again after
  startup/reconnect and immediately before the synchronous pipe write.
- `#markResumed`/`#cacheThread` at controller`:651-675` perform context export,
  metadata/resumed cache writes synchronously. There is no await between the new
  check and those writes or folder assignment. The adapter's later await only
  unwraps the response; the outer orchestrator still checks lifetime before
  recording the ID, then admission during rename and before queueing.

No rollback, compensating archive, retry or automatic adoption is introduced.
An already accepted native creation remains valid native evidence; a stale reply
does not adopt it into current local state. Normal optional-callback callers,
fullAccess and existing reservation/idempotency/settings behavior remain intact.

## Independent acceptance

**16 unique cases in three files passed**, all acceptance/normal controls (no inverse
defect assertions remain in this run). Executed through codex-heavy sequentially,
Node22.23.2,1024MiB heap and one Vitest worker.109 unrelated cases were deliberately
skipped by name selection. Only owned subprocesses, synthetic credentials and
temporary Vaults were used; no actual model turn or production task mutation.

1. Seven actual controller/orchestrator/request/stdio controls: held pre-pipe
   creation across both same-instance and replacement-instance stop/start emits
   **zero native create effects**, no membership/export, and preserves the newer
   recovery file byte-for-byte. The two held accepted-reply variants retain exactly
   one legitimate native creation, preserve the newer folder and orchestration
   bytes, and cause no stale export, assignment, rename, archive or replay.
   Delayed-startup/delayed-reply normal controls create/name exactly once; direct
   unguarded fullAccess creation still works and exports normally.
2. This review additionally checks the observable metadata cache in all four
   stale-creation variants. A subsequent explicit access must attempt a fresh
   metadata read; it cannot succeed from an adopted stale reply. The test intercepts
   that new read before it can write anything, separately from the native effect log.
3. Three existing encrypted HTTP create/startup cases still block the actual pipe
   after logout, expiry or key rotation. Three new post-reply cases exercise the
   changed `createThread` callback with the real encrypted HTTP router and fake
   native pipe: after a legitimate creation, revocation prevents local adoption,
   preserves newer membership and leaves the cache cold. It returns no successful
   creation response and does not undo or repeat the accepted native effect.
4. Three targeted admission controls preserve ordinary grouped creation, rejection
   after demotion, and task settings/idempotent concurrent retry with leader settings
   unchanged. Other L1/L2/L3/capacity/selector controls use the verified prior results.

Review test changes are limited to the cache assertions in
`server/orchestration-lifecycle-retention.review.test.ts` and three create-specific
HTTP post-reply cases in `server/secure-independent-review.test.ts`.
Lint of both files passes with zero warnings/errors.

The two accepted-reply variants were rerun after strengthening the fixture with an
explicit newer recovery record: its summary/evidence and the full persisted file
survive unchanged. This yields18 passing case executions,16 unique cases.

Private logs: `acceptance.log` (13 cases), `admission-controls.log` (3 cases),
`recovery-record-controls.log` (2 strengthened repeats), `lint-final.log`, under
the evidence directory below. Reproduction in this checkout:

```sh
codex-heavy --label cr3-native-create-acceptance --timeout 180 -- \
  env VITEST_MAX_WORKERS=1 NODE_OPTIONS=--max-old-space-size=1024 \
  node node_modules/vitest/vitest.mjs run \
  server/orchestration-lifecycle-retention.review.test.ts \
  server/secure-independent-review.test.ts --maxWorkers=1 --reporter=verbose \
  -t 'L1 |actual fake-native pipe'

codex-heavy --label cr3-native-create-controls --timeout 180 -- \
  env VITEST_MAX_WORKERS=1 NODE_OPTIONS=--max-old-space-size=1024 \
  node node_modules/vitest/vitest.mjs run server/orchestration.test.ts \
  --maxWorkers=1 --reporter=verbose \
  -t 'creates a normal grouped|pins overridden task|checks role again'
```

## Reused checks and artifact boundary

Author delivery SHA256
`fbe719183638a0ebbcb22793762ddb85e8b5a271b7ebd69f01a06ee8552ecd52` and artifact
manifest SHA256`a56af4f751b9fd3bf651f591f38ef2c7e29ca42846387fb3581239ec5c725fab`
match the supplied receipts. Seven author evidence files are hash-verified.
Author171 affected cases, lint and server build are reused, not claimed as new
independent execution. The previous four-viewport/31-screenshot evidence and
527+11 full-suite evidence retain their verified hashes. No new browser, full
app build, broad test suite or security audit was needed for this narrow delta.

Copied verified build artifacts only into this owned review checkout, then ran the
read-only provenance verifier independently through codex-heavy. No rebuild or
publication is claimed.90 backend/46 accepted-security entries,25 matching client
files,9 reachable JS/CSS entries and58 application map sources pass; JS/map emission
matches current product source. Dependency hashes and SW remain unchanged.

Incremental82b4367/review14cc189 boundary is exactly four files:

| Artifact in dist-server | SHA256 |
| --- | --- |
| controller.js | f7e041f6a7a12bfe789f3e4fd52f3e6b88d45ee167a93713907415baa2ed793d |
| controller.js.map | 79a0483d59bf77b43ebb3e7862a3e2c1ab7d2882e89bf7cc563fcbcc7361694f |
| orchestration.js | b26415e206cbea0e987c5d5615a718b2ceb3bef9e0edb00f904fc5e6ff2115c5 |
| orchestration.js.map | d3a02f276d0e1356d0cb37ef14c71b1b4e954c0d47c7f2535b55f96105a52c55 |

Combined app808/source00f9 boundary remains controller/http-app/orchestration
JS+maps and the whole matching25-file client. Unchanged HTTP JS
`1a3e4d21e0f5154a746ded3d3a9440493d60618ded2ce1b742cfa60db99342f0`, map
`e55e6b39060d87f8bd7445e3c9d6dbd102f52d9100a22b2fe684668a35e4e19f`.
Client entry`assets/index-BssRLWrJ.js`; HTML SHA256
`554846255773e35b4dd367413481e1ffc8839a3940dad68f2948c6447e7b9d20`.

Hours JS`b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93`,
map`6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8`, source,
generator and template match. Read-only runtime check confirms main783b1e3,
gatewayPID1758426 and those same Hours hashes. No main/runtime/Services/config/key,
real task state, release/seal/activation-package mutation, merge, arm or restart.

## Decision and limits

Close the single residual **L1-admission-lifetime P2** at b8c781a. The historical
82b4367 decision remains unchanged as evidence of the earlier defect. L1/L2/L3
are now accepted within the accumulated review scopes; no further review loop is
requested for this scoped fix. Integration/activation is separate and remains the
leader's responsibility. This task does not block or change the independently
reviewed security package awaiting actual profile/operator readiness.

Accepted native creations can remain outside local adoption when their reply
becomes stale; no automatic adoption/rollback/replay is promised. Existing unknown
settlement/delivery and retention limits remain. Fake process/class interleavings
do not establish a production overlap incident or explain task6beabd71's failure.
No real-browser/device verification is newly claimed.

Root-private evidence:
`/root/.local/state/codex-remote/reviews/leader-native-create-lifetime-b8c781a-cr3`.
`review-decision.json` binds product hash, this report, review tests and evidence;
`delivery.json` records the pushed review commit, matching remote and clean tree.
Keep all worktrees and the separate security artifacts unchanged.
