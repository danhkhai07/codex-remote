# Final preparation source review — 2026-09-22

The leader accepts the scoped Workboard/preview preparation delta at
`1227214d700a7993f580973a397d68ebae2da526` for final release preparation.
W1 (the exact preview Host boundary) is closed within this reviewed scope.
No additional P1/P2 finding was identified in the small builder/config delta.
This is not an application deployment or approval to arm an earlier release.

The final preparation checkout contains both the accepted R6 implementation
`dc9ee2062e1fd87d86b024f0e95076286b6e692d` and the new builder plus
`proxy-configs.mjs`. The independent R6 report is also included. Accepted
application80843c0, future source00f9e197, Workboardbc66e80 and Working Hours
remain unchanged. The separate Leader feature candidates are outside this payload.

## Review and verification

Reviewed the builder extraction, exact-host renderer, unit controls, scoped
Nginx fixture and Workboard/readiness report. Verified remote source HEAD and
all20 evidence hashes plus8 source hashes in the worker manifest. The new
server-level guard applies to both active HTTP/HTTPS preview blocks; the map
contains only seven exact host strings and a rejecting default. It leaves
unrelated vhosts unchanged. Workboard and maintenance transforms retain their
previous behavior and the encrypted tunnel's36m limit.

Independently ran through `codex-heavy`:

- 3/3 proxy/config controls.
- All3 restricted nonroot Nginx combinations, including actual35,063,561-byte
  upload,413 above36MiB and untrusted forwarding-header removal.

Unit: `codex-heavy-f06a715436b04bea8d171b9307f2ecaa.service`.
The worker's real-gateway IPv4/IPv6 HTTP/upgrade rejection, Workboard10 tests,
synthetic database upgrade, browser/cache/HMR/revocation and lint evidence is
reused by verified hash; these are not represented as newly rerun independent
browser checks. The W1 reproduction requires an authorized parent grant for an
unlisted port. No unauthenticated admin API bypass was demonstrated.

Decision and logs:
`/root/.local/state/codex-remote/reviews/workboard-preview-1227214/review-decision.json`.
Source and artifact inventory:
[Workboard and preview readiness](workboard-preview-readiness-2026-09-22.md).

## Operational state and remaining work

Live TLS is still parked503. A final activation release/baseline/seal has not
been created by this review. Actual effective Full(strict), clean-profile or
new-admin-address choice and operator readiness are still required. A new public
canary must remain available through final preflight. Do not invent those
receipts or mutate an old seal to bypass them. Once ready, use this checkout's
builder, compare rendered infra hashes and run the reviewed ALL-idle cutover.

During checkout preparation, one documentation-only commit was accidentally
created in local main. It was not pushed. After verifying the exact single-file
delta and clean working tree, the leader removed only that own commit using
`git reset --keep` and applied the report in this separate worktree. Local and
remote main remain783b1e3. Runtime, production configs, keys and service PIDs
were not changed by that mistake or correction; source main was briefly moved.
No production key, app restart, Workboard mutation or task-resolution mutation
occurred. All runtime/payload changes remain staged candidates.
