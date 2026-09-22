# Independent final package and handoff review — 22 September 2026

**Scoped decision: accepted for subsequent final sealing and factual receipt
binding. No new P1/P2 finding in this package/helper review.** This is not an
activation receipt or a claim that security is live. Actual profile/operator
facts and a fresh real network observation remain necessary. Existing rollout
authorization stands; no new generic user approval is requested.

Reviewed delivery HEAD `e9a21aacf8a51b040371871be5027e09eaebf345`, branch
`prepare/security-activation-release`, in NEW worktree
`/root/WORKTREES/cr-security-activation-package-review` on
`review/security-activation-package`. The author checkout and prior releases,
seals and reviews were preserved. Task `fbba9007-2a21-4bb2-b3c8-c469de57e211`
matches native turn `01a0c7f9-ad62-7993-802e-8e50c0f94f70`; read-only inspection
confirmed inherited **gpt-6-astra / max**. No model override or delegation occurred.

## Exact objects and boundary

- Release: `/root/.local/state/codex-remote/releases/secure-api-80843c0-activation-0830369e`.
- Helper/evidence directory: `/root/.local/state/codex-remote/security-activation-preparation-0830369e`.
- Delivery manifest SHA256:
  `79cb9abe68b1a223e868d44930e200db4b8dee739e0f7c26f77a6aca0898ee9d`.
- Prepared tree manifest SHA256:
  `5d5629bc6fd150622bd9cea69537051e028275c0819659d2117ff21565a139aa`.
- Baseline SHA256:
  `e4f6753cd9806ce46e52f8b5d6b72ff7c7965b9b16c97f4142d2b6af1ae294ec`,
  captured `2026-09-22T06:50:18.308Z`.
- Accepted app `80843c0947c5e665a51a6207dbb871bf2c06a421`, future application
  SOURCE `00f9e197285e9c918372367f626c0b744d47d0d6`; builder/runner source
  `7aca8ddb918550a3d565802423965681131e0ac9` (accepted R6 plus W1 preparation).

Delivery adds only the runbook to the accepted preparation source. Leader feature
candidates are absent. The entire current release matches the recorded tree,
including modes, symlinks, sizes and hashes; all40 delivery-bound files and their
source evidence match. No `seal.json`, `.activation` directory or production owner
key exists. There is **no seal SHA to approve** at this stage.

Closure matches46 backend files and33 client files,114 application source-map
sources,14-module client/lazy/SW graph,12 accepted R6 runtime helpers, six original
watcher source files and complete old/operator closure. Backend hashes also match
CR2's independent accepted app build. All11 infra outputs match the accepted W1
inventory, including exact seven-host rejection, Workboardbc66e80, embedding/unit
configuration, Services redirects and36m encrypted tunnel configuration.

Dependencies are the exact sealed allowlist: jose6.2.12 and Vitest4.1.11,
3,371 regular dependency files /3,880 node_modules entries (3,883 with package
manifests). Each dependency copy has a distinct inode from the historical source;
all3,755 regular files across this whole package have link count1. Symlink targets
match the accepted tree. No hidden payload substitution or shared mutable hardlink
was found.

The historical R6 directory has five unsealed `.vite`/`.vite-temp` entries. This
is documented source drift, not a fully seal-matching source directory. Every
sealed entry still matches; those five extra entries were excluded from the new
package. This review neither ran Vitest through that directory nor changed its
cache or any of the12 old seal files. Accepted safe nonroot Nginx evidence is
reused only for the matching W1 bytes; no Nginx fixture was executed.

## Helper review and independent controls

`check-package.mjs --verify-only` uses fixed release/evidence paths and verifies
sealed dependency entries before comparing the new destination. The documented
verify-only invocation neither stages dependencies nor creates package receipts.
The independent wrapper additionally checks the full delivery-bound release tree,
every regular file's link count, source/effective units, Workboard drop-ins,
Nginx temp metadata, process lifetime/cwd/command and remote identities.

`canary-handoff.mjs` is a cooperative root-operator helper, not a sandbox against
malicious root. Creation acquires the shared deployment lock, checks source,
destination/Nginx preimages, process identities and absent key; creates a random,
exclusive anchored file; then checks seven DNS answers,14 normal-trust TLS
connections and seven exact public bodies. It rechecks preimages after waits.
HTTP is intentional for the public ACME canary; separate CA/hostname-verified
HTTPS probes establish edge/origin TLS. There is no TLS-verification downgrade
or credential in the canary. Cleanup requires its own token/path/parent/file
preimages and an absent or terminal attempt; a held/foreign lock, running attempt
or changed token fails closed. Failure can leave owned evidence for inspection.
Unknown crashes/orphaned artifacts still require operator investigation.

The actual challenge directory was read-only checked as root-owned0755, matching
the helper's guard. No canary was created, probed or removed there by this review.

`bind-receipts-handoff.mjs` runs with the exact release/preparation paths in the
runbook. It requires matching app/source/runner, exact-package review and named
operator/private retrieval readiness; rejects missing/future/expired operator
or network dates and missing/future profile history; refuses the new-host choice.
It preserves the supplied actual operator timestamp, binds file SHA256 values and
app/seal/source/production-runner/evidence hashes, and uses exclusive writes.
It never invents a profile creation time, refreshes timestamps or generates a key.
The operator's review is trusted provenance, not mechanically proven human action.
Likewise an old but genuinely unused browser is not expired merely because it was
created earlier; its actual history must be supplied honestly.

Receipt validation is deliberately layered: binding checks structure/provenance;
the sealed runner verifies seal closure, current baseline, authorization, files
and real TLS/canary before any activation. A fake structurally valid fixture record
is not real network/profile evidence. Both active receipts are needed, with exact
hash bindings. A failure after evidence write leaves partial binding; retry refuses
to overwrite it, and missing authorization blocks activation. File withdrawal or
replacement fails subsequent runner validation. No automatic partial-write repair
or receipt re-dating is provided.

Independently executed **31 receipt/helper cases**:

- The delivered eight cases: seven invalid/pending/expired inputs rejected; one
  fake normal binding with replay refusal.
- Fifteen additional exact-binder cases: missing/future profile facts, missing/
  invalid/future review/network time, wrong host/app/source/runner, withdrawn
  evidence, exact hash/time preservation, post-binding file drift, and a dangling
  authorization target causing an explicit partial write that cannot be replayed.
- Eight additional canary cases: success/owned cleanup, foreign lock, active
  attempt, changed token, DNS failure, TLS failure, wrong body and late source
  preimage drift. Failed probes preserve ownership evidence; no false fresh
  network receipt appears. Normal flow requests14 verified TLS connections.

The canary harness explicitly relocates three filesystem roots to an owned
private temporary tree and substitutes DNS/TLS/fetch plus command/service
adapters. That tests helper control flow and cleanup, **not real TLS/Cloudflare**.
It does not transform any published artifact. Binding cases execute the exact
helper bytes with disposable input directories. The first canary run correctly
rejected a fixture directory left0700 by the queue's umask; the fixture explicitly
set only its own directory0755, then all23 added cases passed. No host metadata
was changed to make a test pass.

## Executable sequence and remaining factual gates

The runbook is coherent with the unchanged reviewed runner:

1. Verify delivery/tree hashes and current baseline while main stays BASE. Complete
   the actual browser choice/procedure and named operator's private retrieval
   readiness. Fill only genuine facts, preserving the arbitrary-old-profile risk.
2. For this existing-host candidate, create the private activation/evidence folder,
   conduct the real owned canary/normal-trust TLS observation, review its results,
   then create the first seal and independently verify its closure. A new admin
   hostname requires a new scoped candidate, not silent pin substitution.
3. Bind actual receipts and require sealed `--check` exit0. Authorization lasts
   one hour including idle waiting; evidence lasts24h; binding requires a network
   observation under10minutes. Runner checks perform fresh network probes and
   reject changed/expired bindings rather than silently renewing them.
4. Root may then start the dedicated systemd `--apply` unit under existing user
   authorization. Keep main at BASE during wait. Dual complete ALL-idle with zero
   pending, ingress gating and immediate pre-copy checks precede source transition.
   The original sealed watcher and old auth/env closure remain operational.
5. Guarded nonforce BASE→SOURCE transition, scoped files/dependencies/config,
   original watcher and stop/prove-old-gateway-gone/init-once/bind/start remain
   unchanged. No key is preprovisioned. R6 creation identity remains descriptor
   derived. Ordinary future restarts retain the same key.
6. Actual new backend proof precedes Workboard activation, final index publication,
   ingress opening and postverification. Durable proof precedes Services/Vault
   bookkeeping. Complete requires those confirmations, not just a process restart.
   Private SSH retrieval is a local operator action after required-gateway
   verification; inspected key-created/binding records contain nonsecret identity
   digests/metadata, not the raw key. Never print owner-key.json.

Current real unsealed `runner.mjs --check` was independently executed and gives
**exit1, ENOENT seal.json, before gate evaluation**, as documented. It is neither
an exit0 preflight nor an exit2 gate result. No guard was changed for this outcome.

Full(strict) is **user-confirmed by “Okay done”**, not an API/rule-override audit.
The actual browser/profile-versus-new-host answer, procedure and creation history,
named operator/private SSH readiness and fresh live network record are still
missing. They are factual rollout gates, not newly discovered product defects or
requests for repeat generic deployment permission. No checkbox establishes that
arbitrary old scripts/service workers are absent.

A lost response/SIGTERM/partial Git, key, publication or bookkeeping effect remains
unknown. The runbook preserves attempt/lock/key/state evidence, forbids blanket
rollback/DB restore/plaintext fallback/key regeneration and requires a reviewed
phase-specific recovery. Cleanup does not establish publication success. This
review grants no general recovery override.

## Evidence, freshness and unchanged production

All heavy checks ran sequentially through codex-heavy with Node22,
VITEST_MAX_WORKERS=1 and1024MiB heap. New fixtures use no real model turn, user task,
production session/key or Hours mutation. Lint passed with zero warnings/errors.

- `/tmp/cr2-security-activation-package-final.json`: complete manifest/closure,
  baseline and original eight receipt controls; final observations at
  `2026-09-22T07:28:29.385Z`.
- `/tmp/cr2-security-handoff-final.json`:23 added cases and explicit fixture limits.
- `/tmp/cr2-security-activation-lint-final.log`: focused review-script lint.
- `scripts/security-activation-package-review.mjs` and
  `scripts/security-activation-handoff-review.mjs`: reproducible owned controls.

Broader app/R1–R6/W1 decisions, safe Nginx and Workboard evidence were verified by
source/hash and reused; no full462/527 app suite, all92 old runner controls or new
live canary was run. This is bounded package/handoff review, not another exhaustive
protocol/root/XSS audit.

At verification, local/remote main783b1e3 remains clean, gatewayPID1758426 and its
original lifetime/cwd/command match, Workboard611064 and Nginx284687 identities
match. Hours JS `b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93`
and map `6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8`, actual
generator/template, excluded backend, source/config/dependencies/frontend baseline
remain unchanged. Mutable state/history/data is observation-only and was not read
as test data or restored. No live canary, activation directory, readiness receipt,
seal, production key, Services mutation, arm, merge, deploy or restart occurred.

This acceptance binds only the exact current delivery/tree/helper bytes. Recheck
baseline and actual facts immediately before final preparation/activation. Drift
or a materially delayed decision requires the documented new package/baseline;
never edit an old seal or treat this review time as renewed user/profile evidence.
The application security package remains **NOT LIVE**.
