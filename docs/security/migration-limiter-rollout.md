# Migration and bounded login admission — foundation candidate, not live

Base `9151e6746e56687b0bdac896ce9b36726f8a71b6` already contains security + preview
cache. This follow-up changes migration readiness and login admission only.
It does not include CR3's encrypted API transport, change the administrative
hostname, reduce root/fullAccess, or authorize a production restart in this task.

## Threat model and enforced behavior

The new page must not restore cached sessions, fetch /api/session, submit a
password, or unlock new credentials before the known legacy cleanup finishes.
`PreviewMigrationGate` blocks child mount, the API awaits readiness, and each new
login rechecks. Own legacy iframes close; preview/workboard SW unregister resolves
and a second enumeration verifies absence. The dedicated inspector counts known
same-origin window paths, including uncontrolled windows. Existing user tabs are
reported, never forcibly navigated. Only known legacy CacheStorage URL entries
are removed, including those left in the app cache; drafts and other storage are
preserved. The root worker no longer caches /workboard paths. Errors/timeouts stay
blocked with retry and there is no persistent ready/acknowledgement flag.

The browser proof retains a genuinely old SW/tab before cutover, including an
offline cached document, then runs actual helper AND production-built app UI.
It checks blocked initial restore and late-tab login, delayed cleanup/password
ordering, retry, scoped cache deletion, preserved draft/root worker, and fresh
legacy URL503 after closure. It also deliberately proves the limit: an old
same-origin worker can persist under an unrelated scope and still read a NEW fake session. This
cannot be fixed by a client-side checkbox, URL scan, unregister or encryption
whose keys/passwords are entered into that same compromised environment.

P1 enforced: ordering and detection/removal of known legacy residue in the current
storage partition under trustworthy new code. P1 operational requirement remains:
**preserve URL => NEW browser profile before entering new credentials**, with no
old tabs/extensions/site data imported. Close old installed PWA windows too.
Other browser profiles/devices must migrate independently. If the user chooses a
new admin origin, parameterize PUBLIC_ORIGIN and Workboard frame ancestor/Nginx,
review DNS/TLS and origin-specific auth again; don't change domains implicitly.
No claim that this script proves every browser is clean. Client guards do not
prevent an already hostile same-origin script from calling the server directly.

A user draft may be retained in the old profile, but don't open/log into that
profile after cutover merely to copy it. Preserve it as user text through a trusted
migration procedure before entering new credentials; do not import full old site
storage, cached app code or a browser-profile backup into the clean profile.
Server history/state remains intact. No blanket cache/storage clearing or purge.

## Rate-limit admission and resource limits

Per process defaults: 4096 identities, 8 attempts/failure timestamps per identity,
15-minute sliding failures/fixed lockout. beginAttempt synchronously reserves a
slot before readJson/password verification; finish is idempotent and always runs
in finally, including aborted/malformed bodies. No eviction of live identities.
Blocked requests do not extend lockout. A full map returns503 with Retry-After1
for UNKNOWN identities; known admitted identities retain their failure history
and can still authenticate within their remaining budget. A blocked/pending-full
identity returns429 with Retry-After (remaining lockout, or1 for in-flight slots).
No password verification or cookie issue occurs after admission rejection.

Each admission/completion scans at most32 map entries with a rotating iterator;
each entry has at most8 timestamps. This globally reclaims cold expired entries
under traffic without full-map scans or an unbounded queue/timer per IP. An idle
map may retain expired entries until traffic resumes but never exceeds capacity.
A large number of still-valid identities can deny admission to a new legitimate
client until capacity recovers: explicit overload, not silently forgotten blocks.
In-flight requests retain reservations until completion/abort; Node HTTP request
timeouts remain responsible for a stalled socket. One-process memory state resets
on process restart as before; durable cross-instance brute-force accounting is
not claimed. Exact trusted-proxy IP parsing is unchanged.

Regression evidence includes tens of thousands of synthetic identities/blocked
queries, cold-key expiry driven only by a hot key, simultaneous reservations,
idempotent late completion, HTTP4096 distinct validated proxy IPs, overflow/retry,
known user admission, time expiry/recovery, and slow/aborted body handling.

## New release manifest and remaining infrastructure gates

Delta versus9151e67 backend: http-app.js/.map, login-rate-limit.js/.map (four files).
Full foundation delta versus current runtime includes modules/maps:
`auth`, `config`, `directory-listing`, `file-policy`, `http-app`,
`localhost-preview`, `pptx-preview`, `request-ip`, `server-files`,
`session-registry`, `preview-cache`, **`login-rate-limit`** (24 files total).
Client includes migration-check-sw.js and updated sw.js + built app/assets/maps.
Do not include controller/orchestration/work-hours; preserve production
work-hours.js SHA256 a9a74ac46cd4c72b5ff350188d3edf648d8b4ffe2a5fbf4a494f68fab691bd91.
The final encrypted candidate may add modules: leader must recompute/check its
allowlist, build and baseline rather than reuse this list as a complete release.

Infrastructure handoff remains
/root/.local/state/codex-remote/security-infra-20260921/README.md:
seven exact A records p2345, p5180, p5210, p5211, p5212, p5213, p5215 under
danhkhai.io.vn ->103.195.237.172, SAN cert codex-preview-ports + targeted webroot
renewal dry-run; Cloudflare edge cert/Full(strict) verified by zone admin; reviewed
trusted-IP snippet and exact-host Nginx gates; four nonsecret gateway env settings;
Workboard bc66e80 patch + canonical Origin/HTTPS frame ancestor and Secure cookie.
Workboard has no remote; bundle/patch exists, do not invent a repository.
No DNS API mechanism was found in configured references at the prior inventory.
Recheck inventory/source/runtime before acting; no DNS/cert/Nginx mutation here.

Before idle, only after configuration approval: back up exact existing config and
private .env/unit/server paths; install bootstrap exact-host ACME/TLS reject, DNS,
issue/verify cert, then leave new hosts parked503. No new origin points at old
backend. Keep old admin routing until the reviewed maintenance window.

At cutover: require operator-reviewed clean-profile migration procedure AND
ALL native turns idle/pending0 twice, then recheck pinned runtime/config hashes.
Gate legacy routes503; merge env settings preserving secrets/fullAccess; install
ONLY final reviewed modules/maps, use scripts/restart-when-idle.mjs with candidate
auth bridge and its final idle check. Verify new PID/auth/health, apply reviewed
Workboard patch/env safely, then enable isolated routes. Publish all client assets
(including inspector worker) before atomic index switch; retain old hashed assets.
Verify local/public HTML/assets, TLS, auth/preview/WS, excluded modules/work-hours
and own fake/maintenance checks without any native model turn or real task edit.
Only then mark live/update Services and checked Vault notes.

Do not flip seal app-security-2fd0cff or arm its runner. Create a new immutable
release for the FINAL integrated hash after leader review; pin exact DNS/SAN/host
allowlist instead of its earlier regex check. This task stages a manifest only.
On failure keep previews/Workboard503; rollback must use expected PID/baseline and
fresh ALL-idle gates, and explicit security review before old vulnerable modules.
Never restore unsafe same-origin previews just to make the UI work, never overwrite
SQLite/session revocation state/history, and never perform a full dist-server copy.

## Verification of this candidate

`codex-heavy`, sequential, Node22, heap1024MiB, VITEST_MAX_WORKERS=1:
`npm run check` passed395 Vitest tests/70files,11 Node readiness tests, lint,
typecheck, client/server builds and PWA checks. The existing >500kB bundle advisory
remains; no test/build failure. Browser migration proof passed with0modelCalls,
including the deliberately demonstrated arbitrary-scope residual. Plan full flow
(custom/Skip/retry/IME/reload/reconnect/Stop), Files desktop/mobile, logo reload
(selected convo/draft preserved), and team panel at1280x900/320x600/390x844/390x600
all passed with real service workers enabled. No real conversations/model turns.

Logs: /tmp/security-migration-limiter-check.log. Screenshots and machine-readable
migration result: /tmp/security-migration-limiter-browser/. These are copied to
this candidate's prepared review artifact; exact manifest/hashes are emitted after
commit. No production service restarted, no source/main merge, no DNS/TLS/Nginx
change, and no release runner armed. Browser proof is Chromium; not Safari or a
claim about every user's existing browser profile.
