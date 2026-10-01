# Independent review: share continuity and registered preview hosts

Task `f2855a6f-d9cc-4fc1-a6f0-10e5aa70fb3d`; exact candidate
`cf292a496b6652cce378a75f9f7f4d98b9b7e69e`, base
`5378c9330a2711c0e52a86ee6b44698b93fda38a`, product `f78f2eb`.
Review branch `review/share-service-continuity`, separate worktree
`/root/WORKTREES/cr-share-service-continuity-review`. No product/runtime edits.
Actual own-thread metadata: gpt-6-astra / xhigh, read-only query.

## Decision

**Product source accepted within the stated continuity boundary. Activation
preparation needs the P2 correction below; exact package is not ready to arm.**
Nine independent controls, lint and a fresh server compile passed. No other
reproducible P1/P2 finding was established in the product delta.

The exact staged Nginx/bootstrap/certbot plan preserves isolated authenticated
preview access. The review-only package is correctly marked non-armable and must
not be treated as an activation runner. One **P2 preparation defect** must be
resolved in the fresh activation baseline: R1 below. This does not invalidate the
service continuity implementation or the explicit infrastructure expansion.
There is no new user authorization requirement.

## R1 — P2: post-TLS stage still seals the superseded certificate

`share-continuity-stage.mjs:48` unconditionally captures
`/etc/letsencrypt/live/codex-preview-ports/fullchain.pem`. The accepted active
Nginx candidate serves `/etc/letsencrypt/live/codex-preview-ports-v2/fullchain.pem`.
The documented activation step 5 explicitly says to rerun this stage helper after
infrastructure. That rerun still hashes the old seven-host certificate. Changing,
removing or mispointing the ten-host certificate can leave this `baseline.cert`
unchanged; it is not a binding to the certificate actually serving preview.

Deterministic inverse probe in `scripts/share-continuity-review.test.ts` extracts
the exact stage-selected path and staged `ssl_certificate` path, verifies both
expected values and demonstrates that they differ. This is a real planned-flow
mismatch, not a hypothetical malformed Nginx input. Read-only current observation
also confirmed the live Nginx now matches the staged active bytes and references
v2, while stage still selects the older lineage.

Minimum fix for the activation package: derive the certificate target(s) from the
validated exact active vhost/plan, require the expected lineage, and seal the
active symlink target plus certificate bytes/identity and relevant TLS config.
Root's final adapter must enforce that binding immediately before publication and
verification. It can supply this corrected capture instead of changing runtime
code. A corrected stage helper should follow the next version on future exact
host expansions too. Do not read/emit private-key contents or restore old mutable
grant/registry state as a certificate rollback strategy.

Acceptance: active-v2 capture selects v2; a v2 cert/symlink/config drift aborts,
while an unrelated old-v1 certificate change is not mistaken for active drift.
Prove the same for the next v3 plan. Keep missing lineage/SAN/trust verification
closed, and bind the result to the fresh NEW-only activation seal. No apply runner
exists in this candidate, so this review finds no current unsafe restart or
production credential exposure.

## Product security assessment

`server/services.ts:118–129` retains omitted directory/kind, compares explicit
`expectedIdentity`, and preserves UUID only for the current registration. A normal
metadata update (name, summary, PR, branch, initial path) does not rewrite grant
records or change signed URL/token. A same-app move to another worktree needs the
current generation explicitly. Directory/kind change without that assertion,
`replace: true`, or removal/re-registration rotates UUID. Supplied `identity` or
`registrationId` cannot manufacture a chosen generation; stale expected identity
returns 409 before save. The generation is cooperative owner intent, not proof of
which program currently listens on a port.

The existing version-1 migration remains one-time and durable. Missing identities
receive fresh UUIDs; no old grants are reassigned. Replacements cannot adopt a
stale URL/cookie/handoff, including a same-tick recreation. Existing current UUIDs
survive reload. Metadata updates do not modify creation time, grant expiry or the
24-hour ceiling. Existing signed name and initial path remain the original values;
this feature does not redirect routes that an app removes.

The unchanged share authority checks current identity and status on access,
rechecks after awaited probes/HTTP headers/hash/WS upgrade and uses watchers for
active connections. A metadata save reschedules existing expiry timers but does
not extend the authority deadline; replacement closes old access. Held list
results never re-emit revoked URLs or stale service metadata. Owner API still
requires encrypted owner proof/session/CSRF/live authority. The new nonsecret
registrationId is exposed through the existing owner Services API, not accepted
as a bearer credential.

New allowed ports still require both durable registration and explicit operator
HTTPS inventory. Nginx proxies all ten exact hosts to NEW 5174, never directly to
the app port. Unknown hosts remain denied; preview host cannot become the owner
API origin, and cookies/tickets cannot authenticate another port. No wildcard,
new arbitrary target parser, auth bypass or owner-secret transfer is introduced.

## Infrastructure and rollback

The bootstrap appends only the three ACME HTTP hosts; all other new-host requests
are 503 and new HTTPS handshakes are rejected until cert verification. Existing
seven hosts/config remain intact. Certbot uses the explicit ten SAN list and a
new v2 lineage, with a nginx-test/reload deploy hook; active config keeps the
existing exact-host gate, forwarding-header sanitation and gateway upstream.
The planner requires registered durable identities for additions and rejects
gateway ports; generated bytes reproduce the sealed staging artifacts.

At 2026-10-01 14:26 Asia/Ho_Chi_Minh, read-only observation found NEW PID1923100
active/enabled, OLD PID0 inactive/disabled. Live Nginx matched the active ten-host
candidate, and the v2 certificate file had exactly those ten SANs. The old v1
certificate remained unchanged with seven SANs. Thus the author's preparation
snapshot predates concurrent infrastructure work. No public DNS/TLS chain/ACME
renewal validation was independently performed here; this is not a trust-readiness
claim. Runtime services.js still differed from candidate at that observation.

Actual publication remains restricted to services.js/map, Services CLI, and one
preview-port environment field; no frontend/Hours/key/native/Vault/grant rewrite.
The existing frozen workflow enforces two complete idle samples, final checks,
publication lock and NEW-only adapter targeting. Readiness includes queued work,
undelivered reports and native uncertainty, without worker/leader exceptions.
But this package contains only helpers and read-only observation, **no activation
adapter**. Its node_modules is a symlink to live runtime dependencies, not an
immutable dependency seal. Final root preparation must bind its actual dependency
closure, active TLS (R1), fresh code/config/identity baseline and intended service.
Do not infer those missing checks merely from the helper names in the manifest.

Before writes, drift should abort and produce a fresh baseline. After ambiguous
publication/restart, use verify-only and forward fixes; never replay apply or
restore registry/grants/keys/user data. An infra-only vhost rollback is possible
only against checked current bytes and with matching old-port configuration; it
must preserve other sites and avoid silently leaving newly issued links advertised
on unreachable hosts. Keep certificate lineages for diagnosis/renewal; do not
overwrite the old lineage or turn an infra rollback into data restoration.

## Verification and artifacts

Nine focused independent tests passed: exact grant-byte/URL/cookie continuity
through metadata changes and restart with the 24h boundary; same-tick re-registration
and forged/stale identity rejection; missing-generation migration without grant
adoption; held list during continuity move; real HTTP stream surviving metadata
update then closing on replacement with old cookie/handoff denied; concurrent
list/revoke without a stale URL; cross-port/owner-origin denial; byte-exact staged
infra regeneration; and R1's mismatched certificate-path inverse control. The
inverse is expected evidence of the finding, not evidence that R1 is fixed.

Focused lint had zero warnings/errors. Fresh `tsc -p tsconfig.server.json` passed;
both independently emitted services.js/map bytes and Services CLI match the sealed
payload hashes. This is an independent artifact comparison, not only trust in the
author's build receipt. No full application/browser/Nginx rerun was needed.

Checks executed sequentially in one successful 640 MiB codex-heavy job, with
448 MiB Node heap: `codex-heavy-0d5da985c9c4420595b60173601b761d.service`, exit 0.
Peak memory was 225103872 bytes, with zero OOM events. An earlier default-memory
attempt stayed queued and was cancelled without running. The first smaller attempt
later entered the slot but failed before checks because its dependency link pointed
to the author's already-cleaned worktree. A local package-link farm with lock-matched
dependencies and local cache paths corrected that fixture setup. The successful job
did not bypass the global queue, change foreign workloads, install packages, or
write runtime dependencies. Initial receipt inspection also corrected a mistaken
assumption about embedded map source; a fresh independent compile was performed.

Verified 10 author evidence-file hashes, the manifest/baseline/review seal, and
all 22 sealed payload/infrastructure/frozen files. Product source hashes:

- services.ts `8e122552b3918a21b77ca955318bd8ac3f42f47d33b3c4e9004cb5513656f86f`
- services.mjs `16a649a8e0d82ceecfb4445e1c6dbc7813848b09f1bd2bcae4ff8f880c8a3b78`

Author evidence reused: 66 unique focused tests, typecheck/lint/server build,
encrypted Chromium 1280/390/320, and non-root restricted Nginx exact ten-host plus
unknown-host controls. No repeated browser/Nginx/full application suite. The
historical browser same-document and synthetic certificate fixture failures were
corrected by the author; final receipt hashes match. This review does not claim
physical iOS coverage.

Source maps omit sourcesContent; the independent compile and byte comparison
above establish linkage instead. The package remains review-only, with the R1
certificate binding and actual activation adapter requiring root follow-up.

Private evidence:
`/root/.local/state/codex-remote-secure/reviews/share-continuity-review-f2855a6f/`.
Review adds only report/tests; candidate and production checkouts remain untouched.
No model turn, real share, arm/deploy/restart or recursive delegation. Checked
reference and own-handoff maintenance only.
