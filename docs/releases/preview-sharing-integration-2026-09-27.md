# Preview sharing integration and NEW rollout preparation

Status: candidate, not deployed or armed. Task `9ec02251-161d-4493-a48b-4b05ec70327c`.

The exact source pair is backend `5b7f4765a19291640830e7dd443461c53009b3ea`
and UI `a1d6f0f508934d31cfdb502a2e8e0c90b874bb65`, merged without product
edits at `da9c39a60524530114fd4492a42dc6c17cc9c888`, from base
`177e812c2f9b441f201bbdba365a252fdba63cf3`. Branch
`integration/preview-sharing`, worktree `/root/WORKTREES/cr-preview-share-integration`.
Receipt: own-thread metadata `gpt-6-astra/xhigh`. Original checkouts are preserved.

## Implementation and state boundary

See `docs/preview-share-backend.md` and `docs/reviews/preview-share-ui-2026-09-27.md`.
Exactly six backend modules plus maps are published: config, http-app,
localhost-preview, services, preview-shares, preview-share-page. The whole matching
25-file client is published, retaining all older hashed assets. No dependencies,
secure-client.js/map, event-hub.js.map, native process/config, key, Hours, Nginx,
OLD service or unrelated runtime helpers are changed.

The owner explicitly creates a link for one registered allowed service, up to
86400 seconds. The initial path chooses navigation, not directory isolation.
The trusted owner-origin bootstrap exchanges its fragment for a one-use handoff;
recipient cookies do not authorize owner APIs. Owner logout intentionally leaves
explicit grants active. Revoke, expiry and registry-generation changes close them.

Services registry version 1 gains private UUID identities on first startup,
with its exact preimage backed up. No-op registrations retain identity; meaningful
metadata edits rotate it. New grant store version 1 remains absent until its first
write; an absent-store marker is captured. State is bounded to 128 active/512 total
grants; corrupt stores fail closed. Neither registry nor grants are a rollback
payload after startup. A service listener changed outside the registry is not
observable. One share cookie per host means the last opened link controls later
requests in all tabs there; already downloaded/cached content cannot be recalled.

## Check evidence and limits

`npm run check` ran once through codex-heavy, one worker. Its first test phase had
653 passes and 14 Files failures because inherited TMPDIR was under `.local`, a
correctly blocked restricted Files path. No source policy was changed. Rerunning
only the six affected files with TMPDIR=/tmp passed 48/48; all 667 distinct Vitest
cases therefore passed. The remaining 11 Node readiness cases, typecheck, client
build, server build and PWA checks passed. Original and repair logs are retained.

The integrated browser uses the actual built HTTP/secure/share backend, temporary
HTTPS, registry/grants, owner credentials and an owned fake service. Native model
operations are never executed. Chromium1280/390/320 verifies encrypted owner
create/copy/open/revoke, fresh recipient with no owner cookie/key, server expiry,
Lock and retained draft. Separate source-identical UI fixtures cover the held-list
races and StrictMode; their prior evidence is reused, not called an independent
rerun. Initial integrated harness failures were an incomplete fake history-reader
and reusing a deliberately logged-out session between viewports; corrected fixture
uses independent sessions, with failure logs retained.

The bounded WebKit attempt launched its installed browser but failed at an owned
recipient page because WPEWebProcess could not spawn a child (Resource temporarily
unavailable). No WebKit pass or physical iOS/Safari claim is made.

The A01–A26 design controls are mapped below. Coverage is evidence within stated
bounds, not a claim that every adversarial permutation has been executed.

| Cases | Evidence / boundary |
| --- | --- |
| A01 | Real encrypted share HTTP tests: anonymous/cookie-only/wrong key/missing CSRF rejected. Existing secure expiry/revocation tests retained. |
| A02 | Held-probe logout and registry replacement tests; existing transport/native live guards. No claim of every create-body/identity-rotation interleaving. |
| A03 | Store TTL validation and fixed-expiry/restart tests; browser actual expiry. |
| A04 | Store port/path/HTTPS/blocked-port tests and exact configured host intersection. |
| A05–A06 | Multi-recipient/independent revoke and logout-retains-share HTTP tests. |
| A07–A08 | Generation migration/no-op/change/same-tick recreation and HTTP/WS retirement tests. |
| A09–A10 | Store malformed capability, cookie-domain separation, handoff port binding; existing private proxy host/origin tests. Not exhaustive fuzzing. |
| A11 | Reused CR2 owned HTTPS app-worker interception: worker sees handoff only, capability stays on trusted origin. |
| A12–A14 | Public route/body/origin bounds, one-use expiry/replay and upstream credential stripping tests; browser clean navigation. No production-log audit. |
| A15–A17 | Durable revoked/corrupt state, cache304 denial, delayed headers, streaming and late/live WS invalidation tests. |
| A18 | Existing range/private-cache/revalidation tests. Saved/offline bytes remain outside recall guarantees. |
| A19–A20 | Restart/corrupt/failed-persistence/capacity tests; 32 slow anonymous bodies admission/recovery. Not network DDoS certification. |
| A21–A22 | Cookie-selection and list/restart/status tests; backend's exact semantics documented. |
| A23–A24 | Accepted UI browser 1280/390/320, stale-list/StrictMode inverse→acceptance; integrated real owner popup and Lock. |
| A25 | Fresh Chromium recipient in integrated run; bounded WebKit attempt recorded separately; physical Safari/iOS untested. |
| A26 | Combined suite plus Services middle-click/private-preview browser; source equality for Files/history/Hours/table/Push lineage. |

Evidence directory: `/root/.local/state/codex-remote-secure/preview-sharing-20260927/integration/`.
No production shares, model turns, transcripts or mutable runtime state are test inputs.

## Narrow deployment adapter

`scripts/preview-share-release` reuses the reviewed history runner's atomic writes,
cooperative lock and one-restart workflow in a new, separately reviewed package.
It is not a replay or alteration of any historical seal. Changes are the explicit
12-artifact allowlist, exact config append, state preimages, metadata-only readiness,
arm/seal binding and read-only verification mode. `check` does not poll readiness.

Configuration is copied privately and only these absent keys are appended:

```
CODEX_REMOTE_PREVIEW_SHARE_PORTS=2345,5180,5210,5211,5212,5213,5215
CODEX_REMOTE_PREVIEW_SHARE_STATE=/root/.local/state/codex-remote-secure/preview-shares.json
```

The patch preserves original bytes/other parsed values and rejects pre-existing
keys instead of overwriting them. Baseline validates the seven exact Nginx hosts,
NEW5174 route and certificate SANs/expiry, without changing DNS/TLS/Nginx. It binds
complete live backend/client/scripts hashes, config hash, service PID/start time,
unit definitions, dependency paths/manifests, `/etc/hosts`, Hours template/generator
and owner-key file identity/VAPID identity. Owner-key material is neither read nor packaged. Protected config/preimage files
contain the existing config and are root-private; no secrets enter Git or code payload.

`prepare` copies only immutable code payload and a frozen maintenance-client
closure; `baseline` takes the shared publication lock, captures fresh observed
preimages, and seals them. Neither command arms or applies. Package contents are
private. Baseline/manifest/seal are immutable; drift requires a newly named package.
A root-reviewed seal hash is required by `arm`. The actual `apply` must run in a
separate bounded systemd job after this task ends, never from a waiting model turn.

Ordering: payload/seal/source checks → ALL-idle twice → publication lock → fresh
baseline/backup → zero-pending recheck → config/backend/new assets → ALL-idle twice
again → exclusive restart-intent → exactly one NEW restart → health → SW then index
last → local/public complete client byte verification → encrypted GET shares and
owner-full `/etc/hosts` read → Hours/key/config/OLD and new PID checks. Active,
queued/starting/stopping, pending notices/questions and uncertain dispatch all
block. `systemError` and unknown native status conservatively block using metadata;
there is no full-history RPC or own/leader exemption. Root must investigate an
unclear record instead of changing it to force readiness.

Same-name hashed assets cannot be overwritten with different bytes. One exact map,
`assets/docx-preview-ByvNPTF_.js.map`, differed only in build paths preceding
`node_modules/`. Version, file, names, sourcesContent, mappings, ignore list and the
complete normalized source paths match. The candidate retains the existing LIVE
map bytes and records both hashes in artifacts.json; no runtime file was written
and no wildcard exception exists. Old assets remain for existing tabs.

## Concrete commands (root only after source/package review)

Use the final source HEAD and evidence receipt printed in the task delivery.
The prepared package is under the NEW private `releases/preview-sharing-*` directory.

```sh
node scripts/preview-share-release/deploy.mjs prepare "$release" "$worktree" "$evidence"
node "$release/deploy.mjs" baseline "$release"
node "$release/deploy.mjs" check "$release"
# After root reviews exact source, manifest, baseline and seal:
node "$release/deploy.mjs" arm "$release" "$reviewedSealSha256"
# Launch apply detached through the established NEW deployment systemd workflow;
# no request to turn/start, no historical runner invocation, no OLD service.
node "$release/deploy.mjs" apply "$release"
# After a postverification network failure: read-only verification only.
node "$release/deploy.mjs" verify "$release"
```

`apply-attempt.json` and `restart-intent.json` use exclusive/fsynced creation.
An existing attempt is not replayable. Root owns the final systemd launch under
existing user authorization; this task does not arm it.

## Failure recovery and bookkeeping

Before any publication, a drift/readiness failure leaves runtime unchanged. Prepare
a new package after understanding drift; retain the old evidence. After partial
config/code publication but before proven restart, inspect exact PID/markers and
preimages; root may restore only code/config if no candidate startup occurred,
then prepare a new forward attempt. Do not infer that a failed restart command
means startup did not occur.

After restart intent or any possible new startup, registry identities and grants
are mutable. Never restore their earlier snapshot or blanket-roll back state.
Preserve failed/interrupted task evidence. Prefer a reviewed forward correction
or disable future grant admission through a separately reviewed config action;
existing revocation data must survive. `verify` never restarts or finishes partial
publication; incomplete client publication is an explicit recovery condition.
If backend/client publication completed and only public verification timed out,
repeat `verify`, not `apply`. No automatic rollback is performed.

Only after actual LIVE verification should the existing Services app-root entry
summary be updated. Preserve all other entries; do not create Files/Hours records.
Update deployment marker and checked Vault references with actual PID/source/seal;
physical Safari and outside-network behavior must not be claimed without evidence.
