# Security activation package — prepared, unsealed, not armed

Task `0830369e-fe62-4bd7-840b-89052c585643`, 2026-09-22. This is packaging and
operator handoff, not a new application change or deployment. Astra/max is
inherited from the assignment; no worker override or delegation was used.

The user replied **“Okay done”** to the leader's Full(strict) instructions on
2026-09-22. Record that as **user confirmation**, not a Cloudflare API audit or
independent inspection of rule overrides. Existing deployment authorization
continues. The separate current-URL/fresh-browser versus new-admin-hostname
question remains unanswered in this task. No profile/operator readiness is inferred.

## Prepared objects and checks

| Object | Exact value |
| --- | --- |
| New private release | `/root/.local/state/codex-remote/releases/secure-api-80843c0-activation-0830369e` |
| Preparation evidence/runbook helpers | `/root/.local/state/codex-remote/security-activation-preparation-0830369e` |
| Retained worktree / branch | `/root/WORKTREES/cr-security-activation-release` / `prepare/security-activation-release` |
| Builder and deployed runner source | `7aca8ddb918550a3d565802423965681131e0ac9` |
| Accepted application | `80843c0947c5e665a51a6207dbb871bf2c06a421` |
| Future application source | `00f9e197285e9c918372367f626c0b744d47d0d6` |
| Current local/remote main | `783b1e3ae0efd683458c9fa0b3518b2e476b06a9` |
| Fresh baseline captured | `2026-09-22T06:50:18.308Z` |
| Baseline SHA256 | `e4f6753cd9806ce46e52f8b5d6b72ff7c7965b9b16c97f4142d2b6af1ae294ec` |
| Application inventory SHA256 | `7c2dc4169e65f6a21ae1a4d13aff21b423fc0ba7bf5d37e9fa8920a68dbf71bf` |
| Prepared package tree SHA256 | `5d5629bc6fd150622bd9cea69537051e028275c0819659d2117ff21565a139aa` |

The delivery HEAD adds this runbook only. Application, builder and runner bytes
remain the accepted preparation source. Leader feature candidates are excluded.
The outer delivery manifest binds that final HEAD, package tree, evidence and
operator-helper hashes. It is **not** `seal.json` or an approval receipt.

The reviewed builder ran with `activation-candidate`; its metadata correctly
describes the intended package kind. It has **no seal, authorization, active
receipts, attempt or production key**. Its `.activation` directory has not been
created. Drafts live separately in the preparation evidence directory.

Sequential `codex-heavy`, one worker, verified:

- 46 backend files against the accepted inventory and CR2's independently built
  bytes; 33 client files, 114 application source-map sources, 14-module graph,
  entry/lazy imports and service worker. No application rebuild/test suite.
- All 12 R6 runtime helpers, including the descriptor-derived creator, match the
  accepted runner exactly. Six old watcher source files and the full old/operator
  closure match the reviewed release and original live interface.
- Exact dependencies: jose6.2.12, Vitest4.1.11; 3,371 regular files, 3,880 entries
  inside node_modules (3,883 entries including the dependency directory/manifests).
  Copies have distinct inodes and no hardlinks. No npm command ran in live.
- All 11 staged infra files match the accepted W1 inventory, including Host421,
  `/services` bookmark redirects, tunnel36m, exact seven hosts, CF forwarding and
  Workboardbc66e80 server/drop-in. Accepted independent three-config safe Nginx
  evidence is reused by exact hash; no additional Nginx run is needed for these
  identical bytes. No old unsafe Nginx fixture ran.
- Operator helper syntax passed. Eight isolated receipt-binding cases passed:
  seven reject pending/unsafe/expired facts without writing receipts, and one
  normal fake binding rejects a replay without overwriting evidence. These use
  fake observations in owned temporary directories, not actual browser/TLS proof.
- Fresh live destinations, stable config hashes, Nginx tree, client/backend/deps,
  main/remote and gateway/Workboard/Nginx identities matched after packaging.
  Hours JS `b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93`, map
  `6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8` and actual
  generator/template are retained. Gateway PID1758426, Workboard611064,
  Nginx284687; TLS remains parked503. Real Workboard data was not read or copied.

**Observed dependency-source drift:** the existing R6 review release has five
unsealed additions under `dependencies/node_modules/.vite` and `.vite-temp`,
including one Vitest results file. Initial full-tree verification rejected that
source. Every sealed entry still matches. Preparation subsequently copied **only
the sealed dependency allowlist**, verified the destination exactly and omitted
those additions. The original review directory and all 12 existing seal files
were left untouched. Details are in `dependency-source-drift.log` and
`package-check.json`; do not describe the old directory as wholly seal-matching.

The real command `node RELEASE/runner/runner.mjs --check` was run. It returns
**exit1 / ENOENT seal.json**, before gate evaluation, because the reviewed runner
constructs its publication object from the seal. There is no JSON gate result yet.
This is intentionally blocked preparation, not a reported successful preflight.
After a genuine final seal, missing/expired receipts yield the normal exit2 /
`preparationblocked`. No guard was changed to make a check pass.

## Receipt drafts and factual gaps

`drafts/evidence.json`, `drafts/authorization.json`, `drafts/profile-readiness.json`
and `drafts/operator-readiness.json` contain null/pending fields. The first two
are not copied into active receipt filenames by this task. Nonsecret accepted
reports, decisions, tests, TLS history and the user-confirmation record are in
`receipt-evidence/`, with provenance in `evidence-sources.json`.

| Record | Complete or missing |
| --- | --- |
| Existing user deployment authorization | Recorded; no new general permission required |
| App / R6 / W1 decisions | Exact accepted decisions retained; root still reviews this package |
| Full(strict) | User-confirmed22Sep; no API/rule-override audit claim |
| Browser choice | Missing; current package is for the existing codex hostname |
| Migration | Actual `procedure`, `freshProfileCreatedAt`, `profileEvidenceId`, `oldProfileCredentialsUsed:false`, source evidence missing |
| Operator | Named operator, actual final-review time, exact-package review and private SSH/password-manager retrieval readiness missing |
| Infrastructure | New live `canaryPath`, digest, current origin/edge fingerprints and fresh network record missing |
| Final binding | Seal, receipt result/at, evidence digest and execution authorization binding missing |

Every evidence record needs exact app/seal, `result:approved`, actual review/binding
time and nonempty referenced files with SHA256. Source reports retain their
original dates: recording a later actual review of unchanged artifacts does not
claim a new test run. The migration residual remains
`arbitrary-old-profile-not-attestable`; a checkbox, unregister call or screenshot
does not attest absence of malicious old code.

Authorization binds app/source/seal, production.mjs hash, evidence.json hash,
`action:publish-reviewed-release`, actual operator, existing-user-authorization
reference and actual readiness time. Its lifetime is **one hour including idle
waiting**; evidence records last **24 hours**. Canary and TLS must still validate
at every runner check. Receipt/file withdrawal or change aborts; timestamps are
never auto-refreshed. The baseline has no automatic age waiver: any pinned drift
requires a new capture/package, not editing this baseline. For a significantly
delayed decision, make a new package from current observations before sealing.

If the user chooses a **new admin hostname**, stop using this candidate for
activation. The runner pins `https://codex.danhkhai.io.vn`, Workboard ancestor and
admin vhost; a new address needs scoped configuration/runner review, actual TLS,
fresh evidence and a new package. Do not translate those pins silently.

## Executable operator sequence — not executed here

These commands are for the root/leader after the actual pending reply and procedure
have been completed. The three task-local helpers are supplied as concrete reviewable
operator artifacts, hash-bound by the delivery manifest; they are not new app
modules or part of the accepted cutover runner. Review them before use. Only syntax
and rejection controls were run during preparation; no live helper mutation ran.

Set paths in the operator shell:

```sh
export CR_RELEASE=/root/.local/state/codex-remote/releases/secure-api-80843c0-activation-0830369e
export CR_PREP=/root/.local/state/codex-remote/security-activation-preparation-0830369e
cd /root/WORKTREES/cr-security-activation-release
```

Verify the delivery manifest's file hashes, then recheck this still-unsealed package
and baseline without changing it. The retained verifier reuses only sealed entries;
unexpected additional drift fails. It prints nonsecret results and creates no new
receipt with `--verify-only`:

```sh
codex-heavy --label security-final-package-recheck -- env VITEST_MAX_WORKERS=1 \
  NODE_OPTIONS=--max-old-space-size=1024 \
  node "$CR_PREP/check-package.mjs" --verify-only
```

If that fails, stop and report the exact differences. Do not edit old seals or
force a new seal over drift. A replacement needs a NEW directory and the same
reviewed builder, accepting no app/Leader-feature substitutions:

```sh
# Only if a new baseline is actually needed; choose a nonexistent private child.
codex-heavy --label security-new-baseline -- env VITEST_MAX_WORKERS=1 \
  node scripts/secure-release/build.mjs NEW_PRIVATE_RELEASE \
  /tmp/cr-secure-api-review-fixes-candidate-manifest.json activation-candidate
```

Complete the real browser procedure first. For the existing address, use a fresh
profile/browser never used for this app, close old app/PWA tabs, do not import site
storage or enter credentials/key into an old profile. Record actual procedure and
profile history in a private file; retain the residual risk. Do not manufacture a
creation date for a previously existing profile whose history is unknown.

For this exact candidate only, prepare the external receipt directory:

```sh
umask 077
mkdir -m 700 "$CR_RELEASE.activation"
cp -a "$CR_PREP/receipt-evidence" "$CR_RELEASE.activation/evidence"
cp "$CR_PREP/drafts/profile-readiness.json" "$CR_RELEASE.activation/evidence/profile-readiness.json"
cp "$CR_PREP/drafts/operator-readiness.json" "$CR_RELEASE.activation/evidence/operator-readiness.json"
# Edit ONLY these two new factual records using the real completed procedure.
# Null values must remain until known; their source/provenance is required.
```

`profile-readiness.json` must use the actual choice
`keep-codex-with-fresh-profile` or `keep-codex-with-unused-browser` and fill the
named migration fields. The operator file records the real named reviewer,
actual final-review UTC time, exact-package review and readiness to retrieve/store
the key privately. `exactPackageReviewed:true` records root's review, not a new
user permission request. These records alone are not browser integrity attestation.

When ready for imminent preflight, create a new public nonsecret canary and probe
all seven hosts. This helper acquires/releases the reviewed shared deployment
lock; checks main/remote, destination and Nginx preimages, service identity and key
absence; creates one exclusive anchored file; verifies DNS, 14 normal-trust TLS
connections and seven byte-exact public HTTP bodies; rechecks preimages afterward.
It never changes Nginx or deletes another token. Failed probes leave owned evidence
for inspection. Do not rerun the old TLS operator session.

```sh
codex-heavy --label security-fresh-public-canary --env CR_RELEASE -- \
  env VITEST_MAX_WORKERS=1 node "$CR_PREP/canary-handoff.mjs" create
```

The new `evidence/canary.json` and `fresh-network.json` are observations, not approval.
Leave the canary present through preflight, idle waiting, final-precopy and cutover.
The old task's deleted canary is never reused. The helper's binding step requires
network evidence under10minutes; if it expires, conduct an actual new probe with
new owned evidence rather than changing a timestamp. No new renewal run is needed
merely to reuse the unchanged successfully tested lineage; the referenced targeted
dry-run remains historical evidence with its original time.

Only after root has reviewed this exact package, all factual fields and current
baseline, create the first and only seal:

```sh
codex-heavy --label security-final-seal -- env VITEST_MAX_WORKERS=1 \
  node scripts/secure-release/seal.mjs "$CR_RELEASE"
CR_SEAL_SHA=$(sha256sum "$CR_RELEASE/seal.json" | cut -d ' ' -f1)
codex-heavy --label security-final-sealed-closure -- env VITEST_MAX_WORKERS=1 \
  node scripts/secure-release/independent-artifacts.mjs "$CR_RELEASE" \
  /root/WORKTREES/cr-secure-api-fixes-review "$CR_SEAL_SHA"
```

No further file may be written inside the sealed release. The binding helper reads
actual profile/operator/network records, rejects null/pending/new-host data, uses
the operator's supplied actual timestamp, validates the five evidence records and
exclusively creates `evidence.json` followed by `authorization.json`. It does not
generate profile history, a key, or an automatic replacement timestamp. Failure
after its first write leaves explicit partial binding; inspect it, do not retry
blindly or overwrite it.

```sh
codex-heavy --label security-bind-current-readiness --env CR_RELEASE --env CR_PREP -- \
  env VITEST_MAX_WORKERS=1 node "$CR_PREP/bind-receipts-handoff.mjs"
codex-heavy --label security-final-preflight -- env VITEST_MAX_WORKERS=1 \
  node "$CR_RELEASE/runner/runner.mjs" --check
```

Require exit0/status `activation-candidate-not-armed`, then inspect the actual
recorded hashes and remaining lifetime. Exit2 is blocked, never an override. The
read-only check does not authorize a later changed receipt or replace the runner's
fresh ALL-idle checks. Expiration before mutation requires actual renewed review;
any attempt/unknown side effect requires phase-specific investigation and a new
reviewed recovery plan, not timestamp replacement.

**Arming/starting, only by root when ready:** this is the first action that starts
the live mutation sequence. There is no `--arm` flag. Use a unique service outside
the gateway and outside the heavy-test queue; do not launch it as a gateway child.
The live main must still be BASE; do not fast-forward it manually.

```sh
systemd-run --unit=codex-secure-activation-0830369e --service-type=exec \
  --property=User=root --property=UMask=0077 --property=Restart=no \
  --property=KillMode=control-group --property=TimeoutStopSec=60 \
  --property=WorkingDirectory=/root/RUNNING-SERVICES/codex-remote \
  /usr/local/bin/node "$CR_RELEASE/runner/runner.mjs" --apply
systemctl show codex-secure-activation-0830369e.service \
  -p MainPID -p ActiveState -p SubState -p Result
```

The runner retains original authenticated Knowledge/Services/ALL-idle behavior
while waiting. Only after gates, dual ALL-idle/zero-pending, ingress gate and final
readiness does it perform the guarded BASE→SOURCE fast-forward/nonforce push,
scoped copy, dependency/config activation and sealed old watcher. Cutover remains
stop→prove old PID/cgroup/listener gone→init once→descriptor-derived creation
receipt→bind/recheck→required encrypted start. No key exists while the old root
Files gateway can read it. Normal later restarts keep the same key.

## Postverify, private key retrieval and uncertain outcomes

The runner performs actual fresh-PID/module checks, required encrypted proof,
legacy rejection, full local/public client hashes, read-only Files/Services/Hours,
encrypted stream, Workboard headers and preserved Hours/excluded backend/old assets.
Preview ticket/logout/revocation mutations remain accepted isolated fixture
evidence, not production tests. It durably writes `postverify.json` before Services
and checked Vault bookkeeping. No real model turn or Hours pause is needed.

Inspect only nonsecret phase/proof records; never cat the owner-key file:

```sh
node --input-type=module - "$CR_RELEASE" <<'JS'
import fs from 'node:fs'; import { createHash } from 'node:crypto';
const r=process.argv[2], a=r+'.activation';
for(const name of ['attempt.json','source-transition.json','key-cutover-state.json',
  'key-created.json','key-binding.json','postverify.json','services.json','vault.json',
  'publication-receipt.json']) {
  const p=a+'/'+name;
  if(!fs.existsSync(p)){console.log(name+': absent');continue}
  const body=fs.readFileSync(p);
  console.log(name, createHash('sha256').update(body).digest('hex'), JSON.parse(body));
}
JS
systemctl show codex-remote.service workboard.service nginx.service \
  -p MainPID -p InvocationID -p ActiveState
sha256sum /root/RUNNING-SERVICES/codex-remote/dist-server/work-hours.js \
  /root/RUNNING-SERVICES/codex-remote/dist-server/work-hours.js.map
```

Success requires `attempt.status/phase=complete`, matching durable postverify
proof, both bookkeeping results confirmed, actual new gateway PID and preserved
Hours. The final source commit is SOURCE, not the preparation branch. Update any
additional operator notes only from observed publication, not these drafts.

Retrieve the generated key **after successful required-gateway verification**, on
the operator's private local machine, over their existing verified SSH connection.
This is a local-machine example, never a tool command executed by this worker:

```sh
umask 077
CR_LOCAL_KEY_DIR=$(mktemp -d)
scp -- CODEX_VPS_SSH_ALIAS:/root/.local/state/codex-remote/secure-owner/owner-key.json \
  "$CR_LOCAL_KEY_DIR/owner-key.json"
chmod 600 "$CR_LOCAL_KEY_DIR/owner-key.json"
```

Use that machine's private password-manager workflow to import the `key` field
without printing it to terminal, chat, logs, URL or Vault. The random owner key is
separate from the login password. Enter it only in the selected clean browser's
unlock field. Delete the temporary local file after secure storage using the
operator's ordinary procedure; do not claim filesystem/JavaScript zeroization.
Never run the general `secure-key.mjs init/rotate` as a preparation or recovery step.

On an error, SIGTERM, crash or partial Git/network outcome, inspect the same records
and the deployment lock's owner before doing anything else:

```sh
systemctl show codex-secure-activation-0830369e.service \
  -p MainPID -p ActiveState -p SubState -p Result -p ExecMainStatus
journalctl -u codex-secure-activation-0830369e.service --no-pager -n 100
git -C /root/RUNNING-SERVICES/codex-remote rev-parse HEAD
git -C /root/RUNNING-SERVICES/codex-remote ls-remote origin refs/heads/main
test ! -f /root/.local/state/codex-remote/deployment.lock/owner.json || \
  cat /root/.local/state/codex-remote/deployment.lock/owner.json
```

Do not rerun `--apply`, remove the attempt/lock/key, adopt an interrupted generated
key, restore the DB, downgrade modules, or start a plaintext backend. Before a new
effect the root must classify whether source push, copy, stop, creation, binding,
start or bookkeeping actually happened. A missing receipt after a dispatched
effect is unknown, not proof it did not happen. A crash after key fsync can leave
an unbound key; keep it and the stopped old-runtime boundary intact. An existing
key cannot pass the first-activation absent-key gate in a newly built normal runner.
Recovery therefore needs its own explicitly reviewed phase-specific plan; this
task does not provide a generic destructive recovery command.

If failure occurs after ingress opened, explicit containment must guard the actual
current config before installing maintenance/parked files and reloading. Never
blindly overwrite a concurrent configuration from this old baseline. A complete
postverify receipt with unfinished bookkeeping proves publication occurred; inspect
unknown Services/Vault mutations before retrying only a separately authorized
remaining action. No automatic rollback or deduction from a lost response.

After completion or a confirmed stopped/failed attempt, remove only this helper's
owned public canary. Its shared lock and target/parent preimages are checked;
running/unknown attempts or changed files fail closed:

```sh
codex-heavy --label security-owned-canary-cleanup --env CR_RELEASE -- \
  env VITEST_MAX_WORKERS=1 node "$CR_PREP/canary-handoff.mjs" remove
```

No command in the activation/canary/seal/binding/retrieval sections was executed
during preparation. The retained execution logs list only builder, dependency
copy/closure, syntax/rejection checks and the intentionally failing unsealed
`--check`. Production main/runtime/config/Services/keys and old seals remain intact.
