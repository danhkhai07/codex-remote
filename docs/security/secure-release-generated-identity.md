# R6 generated owner-key identity — implementation, pending independent review

Task9f2ddb00-e72c-4cfe-ab90-46245c4f138a fixes the bounded P2 reported in CR2's
independent reviewd4deeef of runner8b395de. This is implementation evidence by the
fix's author, not independent approval. The actual task/native turn receipt
confirmed gpt-6-astra/max, turn01a0c6db-496e-73a0-bc06-c9337217aae8.

App80843c0 and source target00f9e197 remain unchanged. No application source,
compiled module, client bundle, dependency, old watcher, Nginx, Workboard or live
configuration changes belong to this fix. No production key or model turn is used.

## Before and after

Before, the init CLI returned without retaining generated identity. A subsequent
phase await and binding listener await ran before the first key read. A concurrent
rotation/replacement could therefore become the purported generated key.

The new sealed `runner/key-init.mjs` is an init-only creator. After the actual
adapter proves service/PID/cgroup/TCP isolation and installed required config,
the creator rechecks permit/lifetime/lock/phase, receipt binding/age and the absent
provision destination. It opens the destination exclusively through an anchored
private directory, writes/fsyncs the random key and derives its identity from the
known generated value, exact written bytes and open file/directory descriptors.
It does not reread the key pathname to decide what it generated.

It exclusively creates/fsyncs private `key-created.json` and fsyncs the containing
directory. The receipt contains only app/generation, hashes, filesystem metadata,
release/seal, key path, old process identity and time. No raw key appears in it,
stdout, logs, phase records or this report. The accepted general operator key CLI
is unchanged; this separate creator has no rotation, deletion or adoption mode.

Before the next phase/socket await, `cutoverOps.init()` synchronously retains that
receipt and hash, verifies its scope and compares current key identity with the
generated identity. After the binding socket await it checks again, then records
`key-binding.json` with the creation receipt's hash and original key identity.
Before start, including after the final socket await, receipt and key must still
match. Parent `boundOwner()` validates creation -> binding -> current key before
new authenticated verification. Ordinary future restarts bypass provisioning and
keep the same key bytes.

## Failure and recovery

A concurrent replacement before creation receipt publication still cannot be
adopted: the receipt describes the bytes written through the original descriptor.
A mismatch stops the attempt before new service start. The old gateway remains
gone; the unexpected key, creation/binding receipts and failed phase are preserved.
There is no deletion, implicit rotation, plaintext fallback or database restore.

A crash after key fsync but before creation receipt publication may leave a key
without a complete receipt. A crash after creation receipt but before binding
leaves a created but unbound key. Both remain unknown/interrupted attempts for
operator inspection; neither permits retry/adoption. Exclusive one-use claim and
preflight checks reject replay and prior receipts. No automatic cleanup resolves
an unknown effect. Interrupted keys are never silently deleted.

This is cooperative consistency against accidental concurrent operator actions,
not atomic filesystem CAS against malicious root. Already dispatched native
effects cannot be recalled on parent death. Existing stock-watcher timeout and
no-rollback semantics remain unchanged. Application threat-model limitations
(root, XSS/frontend substitution, arbitrary legacy browser compromise) still apply.

## Acceptance coverage

The former inverse now expects failure, using the actual adapter, sealed accepted
operator CLI, fake credentials/native RPC and real disposable owned old/new HTTP
processes. It covers both rotate and unlink+fresh-init after init and during the
binding listener await: no new start, old gateway unreachable, original receipt
retained, unexpected key preserved, replay rejected without replacing phase evidence.

Additional creator syscall controls import the exact creator source after a
fixture-only `fs.fsyncSync` shim. After the first real key fsync they perform real
CLI rotation/replacement, or SIGKILL the disposable creator before receipt write.
These are explicit fault-injection fixtures, not transformations of deployed app
payloads or evidence that release bytes match. Release closure checks use ordinary
unmodified helpers separately. A final socket-await receipt change also blocks start.

Existing success/ordinary restart, post-binding rotation, parent SIGKILL/lifetime,
parent phase withdrawal, config/receipt drift, cgroup/listener, stopped-old Files,
keepalive/upgraded socket closure and encrypted Knowledge/Services controls remain
required. Only owned fixture children can be stopped; no live service control is
part of these tests. Focused runner/lifecycle/lint/closure results are recorded in
the delivery evidence; the accepted app suite/build is not repeated.

Completed sequential checks through `codex-heavy`, Node22, heap1024MiB and one
test worker (no skipped tests):

- 29/29 actual cutover/owned-process controls, including eight R6 acceptances:
  `/tmp/r6-cutover-acceptance.log`, unit
  `codex-heavy-dfe2ec690d584f599af3167b00018231.service`.
- 63/63 remaining runner/destination/publication/independent/adapter-boundary
  controls: `/tmp/r6-runner-controls.log`, unit
  `codex-heavy-7fb3cce584df49808310ea54522dae3a.service`.
- Same bounded job: `/tmp/r6-lifecycle.log` confirms old sealed authenticated
  readiness, rejection of old plaintext credentials after replacement, new
  encrypted Knowledge revision write/read and Services; zero model turns or
  production restarts. `/tmp/r6-lint.log`: zero warnings/errors for runner files.

Reproduction commands, **inside** a `codex-heavy` job:

```sh
export NODE_OPTIONS=--max-old-space-size=1024
export REVIEW_RELEASE=/root/.local/state/codex-remote/releases/secure-api-80843c0-review-key-cutover-8b395de
node --test --test-concurrency=1 scripts/secure-release/key-preprovision-review.node-test.mjs
node --experimental-vm-modules --test --test-concurrency=1 \
  scripts/secure-release/runner.node-test.mjs \
  scripts/secure-release/destinations.node-test.mjs \
  scripts/secure-release/independent-review.node-test.mjs \
  scripts/secure-release/publication-crash.node-test.mjs \
  scripts/secure-release/key-boundary.node-test.mjs
node scripts/secure-release/lifecycle-fixture.mjs "$REVIEW_RELEASE"
./node_modules/.bin/oxlint scripts/secure-release
```

The fixture uses the accepted immutable operator/dependencies from8b395de but
copies the current creator and helper source into each disposable sealed fixture.
Run the independent artifact verifier on the new review release separately to
verify unmodified helper/payload closure. Safe nonroot Nginx evidence is reusable
only for byte-identical staged infra; this task does not execute an Nginx fixture
or validate the changing live infra baseline.

## Release and remaining gates

Changed deployable helper allowlist: `runner/cutover-ops.mjs`,
`runner/key-state.mjs`, `runner/production.mjs`, plus new `runner/key-init.mjs`.
The build/closure tooling seals twelve helper/executable files instead of eleven.
Tests/docs are source-only. All46 backend files,33 client files, accepted exact
dependencies and old watcher closure must be reused by hash.

Any new candidate here is REVIEW-ONLY and not armed. Its inherited baseline is
historical, not approval of ongoing real TLS/parked-ingress changes. Root must
independently review this focused fix, then final preparation must capture actual
post-infra baseline and create a new immutable activation candidate/seal. Genuine
profile migration and effective Full(strict)/operator access evidence remain root
responsibilities; never invent receipts or treat a checkbox as proof of a clean
browser. Final rollout still requires frozen old ALL-idle gating and fresh guards.

Production main783b1e3, PID1758426 and Hours JS
`b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93` / map
`6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8`
are outside this fix and must remain intact. Prior review checkout/seals are preserved.
