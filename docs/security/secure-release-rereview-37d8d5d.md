# Independent re-review: runner 37d8d5d

Application: `80843c0947c5e665a51a6207dbb871bf2c06a421`.
Runner: `37d8d5d492890fa31b135c37eae87a420119bdfc`.
Review seal: `55fe4fef2f3d6459c47b394cc7de00d95a318868fce91d0fc5952b866018bb82`.

Decision: **R1–R4 addressed; one additional P1 blocks activation.** The application
acceptance remains unchanged. This review neither approves a final production seal
nor claims that the running app has been compromised.

## R1–R4

The leader independently read the changed runner, destination guards, lock,
publication records, builder and verifier. The original four findings are closed
within their stated cooperative-operator scope:

- Main/remote stay at BASE while waiting. Source transition follows ingress gating,
  final idle/readiness checks; partial Git outcomes are retained without force/reset.
- Receipt ages and bound content/key identity are rechecked after waiting and
  asynchronous readiness checks. Changed or withdrawn records abort.
- Destination/parent preimages and full config inventories are checked at writes,
  dependency swaps and reloads. The shared lock does not claim atomic CAS against root.
- Fsynced independent publication proof survives bookkeeping failures and an owned
  child SIGKILL; Services/Vault outcomes remain separate and can be unknown.

Independent execution: **59/59 acceptance tests, zero skipped**, including actual
old CLI checked writes during a fake busy wait and child-crash/fresh-reader tests.
Artifact verification matched 46 backend files against the prior independent build,
33 client entries, 114 application source-map sources, 14 graph entries and exact
dependencies. Runner modules match the reviewed Git commit; Hours remains pinned
to `b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93`.

The review-only `--check` correctly returns preparationblocked. Its missing receipts
must not be replaced with invented infrastructure/profile readiness.

## P1 — owner key is required before the old file API is isolated

`production.mjs:119` loads the owner key in `gates()`, and `:187` requires that in
preflight. `runner.mjs:17–38` performs preflight and potentially waits before gating
public ingress. The provisioning recipe in `secure-release-preparation.md:134–147`
therefore puts the plaintext owner key on disk while the old gateway is reachable.

The production configuration inspected for this review has `fileRoots: ['/']` and
`workspaceRoots: ['/root']`. The BASE file handler accepts a real absolute path
under `/` (`server/server-files.ts:88–105`) and serves it through authenticated
`GET /api/files/content` (`server/http-app.ts:410–413`). It runs as root. Directory
0700 and file 0600 permissions, and being outside the *new* file roots, do not stop
this *old* handler from reading the key.

This is relevant to the already established legacy same-origin preview/SW threat:
code running in an old authenticated admin-origin context can make that file GET.
It is **not an unauthenticated-read finding**, and no production exploit was run.

### Reproduction

`scripts/secure-release/key-preprovision-review.node-test.mjs` starts a loopback-only
HTTP server from the exact baseline compiled HTTP module with entirely fake config
and sessions. The sealed new key CLI creates a disposable 0700/0600 owner-key file
outside the fake new file roots. An unauthenticated GET returns 401; the old session
GET returns 200 and bytes identical to that fake key. No native controller/model is
started. All generated secrets remain in memory/temp files and are removed; no key
or session token appears in output. A second control confirms key-requiring preflight
precedes ingress gating. **2/2 green inverse tests mean the defect was reproduced.**

### Required correction and acceptance

Do not provision a real reusable owner key while the old unrestricted gateway can
serve it. Establish and verify the old exposure boundary first, then generate/bind
the key and start the required-encryption backend. One robust option is generating
the key only after the old gateway process is gone, before the new process starts;
another needs equivalent measured isolation, including surviving old connections.
An operator checkbox, private Unix modes, or an unverified Nginx reload is insufficient.

Remove the preflight/key-provision ordering dependency without weakening later key
identity/rotation checks. Preserve ALL-idle, old authenticated maintenance access
until cutover, exact app bytes, no plaintext recovery, current Hours and immutable
old seals. Test the fake key's absence/unreadability throughout old-runtime waiting,
at the cutover boundary and on failure; then prove the new encrypted CLI works.
Prove interruption cannot leave a reusable key accessible through the old runtime.
Do not generate a production key as a test.

## Evidence and remaining rollout conditions

Evidence: `/root/.local/state/codex-remote/reviews/secure-release-fixes-37d8d5d/`:
`acceptance.log`, `artifacts.json`, `readiness.json`, `key-preprovision.log`.

No main merge, arm, deployment, restart or production key was performed. At review,
main remains `783b1e3`, gateway PID 1758426, and all seven preview DNS names still
lack resolver answers. DNS/TLS, Workboard activation, genuine fresh-profile/operator
readiness and a new final baseline/seal remain necessary after this correction.
