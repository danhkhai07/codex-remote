# Public preview links: independent design review and acceptance

Task `10f9dcb1-608b-4232-aa42-0565cd0c6dba`. Exact base
`177e812c2f9b441f201bbdba365a252fdba63cf3` (readable-table product `7649f0ce`;
unchanged backend since live `d6990d3`). Worktree
`/root/WORKTREES/cr-preview-share-review`, branch `review/preview-share-security`.
Contract read first: private `preview-sharing-20260927/contract.md`.

The bounded design review is complete. **This is not acceptance of an integrated
implementation or a deployment package.** The user has already authorized the
feature and deployment; the checks below are technical acceptance, not new user
approval requests. Public links do not exist in the reviewed baseline.

## Concrete design findings

Priorities describe the impact if the new implementation crosses these boundaries;
they are not claims that today's private preview already exposes public shares.

### S1 — P1 if a reusable capability is delivered to the app's own bootstrap origin

The current proxy allows upstream service workers and their root scope
(`localhost-preview.ts:203` preserves Service-Worker-Allowed). A reserved server
path alone does not isolate a bootstrap page from a previously installed app
worker. The independent Chromium proof installs a worker through the actual proxy,
then navigates to `/__codex_preview__/share#FAKE_CAPABILITY`. The app worker supplies
its own document, reads the fragment, and forwards the fake capability to its
owned upstream. **Zero bootstrap requests reach the gateway**, so even a gateway
CSP or nonce on that route would not execute. A separate trusted-origin control
is not intercepted. No real link, credential or user app was used.

Required design: keep the reusable link capability on a trusted bootstrap origin
outside app-worker scope. Exchange it only with that trusted origin, remove it
from the address before loading/navigating any untrusted app code, and return a
distinct, short-lived one-use handoff rather than forwarding the original bearer
to the preview origin. The existing admin origin can host a narrowly scoped,
anonymous, static bootstrap without adding DNS, provided it never serves arbitrary
HTML, accepts arbitrary redirect targets, or runs the full owner app shell.
That public exchange needs its own exact route/origin/body/rate bounds; it must
not weaken the general encrypted `/api/*` guard.

A one-use preview handoff is still visible to a controlling app worker, like an
existing private launch ticket. Do not promise that untrusted app code can never
observe that handoff or retain already delivered data. The reusable share bearer
must remain unavailable to it, and handoff lifetime/replay/port binding must be
tested separately. If stronger protection of every handoff against app workers
is required, it needs an additional browser-origin boundary, not a header tweak.
The app's own authentication and CSP remain intact.

### S2 — P1 if service identity uses only port, metadata or updatedAt

`services.ts:23` keys by port/path; `services.ts:96` sets a millisecond timestamp,
with no incarnation identifier. A focused fake-clock test removes a service and
recreates identical metadata in the same millisecond: the entire returned/stored
record is identical. A content hash including updatedAt therefore cannot prove
that an old grant belongs to the new registration.

Use a durable, unpredictable incarnation/revision identity, assigned and persisted
for the registration and changed on retirement/recreation or relevant service
replacement. Bind each grant to it, recheck it on every authorization, and notify
in-flight watchers on registry changes. Migration must assign identity once and
preserve it across restart. Ordinary metadata-edit invalidation semantics must be
explicit. An external process silently replacing the listener without any registry
change is not observable from this store; do not claim to detect it.

### S3 — P2 if a probed service snapshot authorizes creation after an await

`ServicesStore.snapshot()` at `services.ts:104` captures entries, then awaits TCP
probes. A focused test removes the service while the probe is held: the snapshot
still reports it running while the authoritative list is empty. It is appropriate
display data, not authorization. Recheck owner live guard and current service
incarnation synchronously immediately before durable grant creation. Recheck grant
and service after every async boundary before content, 304, redirect or WS upgrade.

### S4 — P2 if registry membership is treated as the public-host allowlist

The registry accepts port 65000 and internal `/files` entries in a focused control.
The current preview template accepts a broad numeric-host pattern; Nginx actually
allows only seven exact preview hosts. Shareable services must be the intersection
of registered port services, configured routable preview ports and gateway-port
exclusions. Validate POST independently of the UI list; do not parse arbitrary
URLs, follow redirects to choose a target, or expose internal path entries.

## Existing guards that must remain effective

- `http-app.ts:695` dispatches isolated hosts before admin routing; lines 704–707
  require encryption for private API paths. Owner management belongs behind that
  guard, session validity, CSRF/origin checks at 287–300 and request-lifetime checks.
  The secure transport binds a live guard after decryption (`secure-api.ts:157`).
- Private launch tickets are one-use, at most 60s, and cookies inherit a parent
  session (`localhost-preview.ts:133`, 239–259). Public grants cannot reuse that
  session identity: intentional links must survive owner Lock/logout, while
  private previews keep their current parent-session revocation behavior.
- HTTP authorization precedes upstream access and cache validation. The existing
  session guard rechecks before headers and after hashing (258–313); watchers
  close streaming responses. WS checks both before and after upstream upgrade
  (324–357), then watches expiry/revoke. Shared grants need equivalent watchers
  keyed by grant and service identity, not just a one-time cookie signature check.
- Reserved credential cookies are stripped upstream and cannot be set by upstream
  (`localhost-preview.ts:43–62`). Add share-cookie names within that protected
  namespace; retain hop/forwarding/header filtering, loopback-only target selection,
  origin checks and upstream app cookies/authentication.
- `preview-cache.ts` only permits private revalidation, excluding auth/API/reserved
  endpoints. Bootstrap/exchange responses require no-store; never cache a grant
  exchange, signature-only authorization, or a response after revocation.
- `public/sw.js:150` has general navigation handling. A trusted bootstrap must be
  explicitly kept out of app-shell/offline navigation fallback and must scrub its
  fragment before other scripts. Do not place reusable links in screenState,
  error text, exports, analytics, request URLs, referrers, Vault or plaintext logs.

## Adversarial acceptance for the integrated candidate

All grants below belong to isolated fake services. Count upstream hits and bytes,
not just status codes. Freeze/advance time and hold upstream/probe/upgrade responses
to make races reproducible. These are required future cases, not claimed passes.

| ID | Control | Required observable result |
| --- | --- | --- |
| A01 | Anonymous, cookie-only, revoked/expired owner, wrong/missing CSRF create/delete/list | No management data or mutation; encrypted unlocked owner succeeds. |
| A02 | Hold body/probe; logout, disconnect, rotate identity or retire service before save | No new durable grant or late URL response after withdrawn authority. |
| A03 | TTL 0, negative, fractional, string, NaN/null, >86400; exact 86400 | Invalid rejected server-side; accepted expiry is fixed from server creation, no extension on redeem/restart. |
| A04 | Arbitrary/unregistered/disallowed/admin port, internal page, external URL, encoded path escape/reserved path | Rejected before upstream or grant creation; list only eligible services. |
| A05 | Multiple recipients redeem one link; two links for same service | Multi-use link works until expiry; revoking A leaves B and private owner preview valid. |
| A06 | Owner Lock/logout while intentional share is active | Share remains usable; private preview still follows its parent-session policy. |
| A07 | Remove/recreate identical service, same tick and across restart | Old link and cookie fail; new registration never inherits old grants. |
| A08 | Meaningful registry change while HTTP or WS waits/runs | Bound grant becomes unavailable and active transport closes; no later upgrade/data/304. |
| A09 | Forge/truncate/oversize capability, tamper ID/expiry/port/MAC, substitute private/admin cookie | Denied with bounded work, no upstream hit and no privilege conversion. |
| A10 | Correct capability at wrong preview host/port; forged Host/Origin/X-Forwarded headers | Host/port binding wins; no cross-port or control-origin access. |
| A11 | App-worker bootstrap substitution and fragment capture from S1 | Reusable share capability never reaches app worker/upstream; trusted bootstrap and clean target verified. |
| A12 | Unknown token, malformed bootstrap POST, guessed ID, malicious return URL | No open redirect, arbitrary fetch/SSRF, script injection or owner-session exposure. |
| A13 | Replay/expire the one-use handoff independently of reusable link | Handoff replay/timeout denied; fresh authorized exchange works without extending grant expiry. |
| A14 | Request/API/upstream/exception/referrer/cache inspection | No reusable capability, owner secret or reserved cookie in forbidden outputs; upstream app auth remains usable. |
| A15 | Signed share cookie for a removed/revoked/expired durable grant | Denied despite a valid signature; unknown/corrupt state fails closed. |
| A16 | Expiry/revoke during buffer, after hash, before 304, after streaming starts | No newly authorized body/304 after invalidation; active HTTP is closed. Already delivered bytes cannot be recalled. |
| A17 | Expiry/revoke during upgrade and after WS connects | No late 101; open socket closes; other independent links/owner connections remain valid. |
| A18 | HEAD/range/conditional/cache hit/SW cache/offline | Server checks remain mandatory; no shared-CDN bypass. Locally saved/cached bytes are explicitly outside recall guarantee. |
| A19 | Restart with active/expired/revoked grants; duplicate IDs, malformed/oversize state, failed atomic write | No resurrection, auto-extension or accidental default-public fallback; failed persistence cannot report successful revoke/create. |
| A20 | Cap full active/history records; repeated invalid anonymous exchanges | Bounded memory/disk/body/rate work; never evict a live grant or tombstone in a way that revives authority. |
| A21 | Cookie overwrite A→B on same host, separate contexts, private+share credentials together | Documented deterministic authority selection. Revocation results tested in recipient context without valid owner fallback. |
| A22 | Owner list/copy after restart, expired/unavailable rows, labels containing markup | Only active permitted URLs exposed through encrypted owner response; text escaped, correct server-time status. |
| A23 | Gear menu/modal at 320/390/desktop; keyboard/Escape/focus return | Reachable actions, no clipping; lock/unmount cancels stale list/create/copy/open updates, draft/scroll preserved. |
| A24 | Double submit, stale list, offline/retry, expiry while modal open | No unintended duplicate creation; useful errors; bounded refresh; revoke confirmation reflects server result. |
| A25 | Fresh Chromium/WebKit recipient with no owner cookie/key; external entry | Public link usable without owner unlock; own app login still applies; real Safari limits stated. |
| A26 | Owner Browser/Services middle-click, private auth/revocation, Files/history/Hours/table lineage | Existing flows preserved; no new public route reaches owner Files or private APIs. |

UI copy should state once that sharing opens the service, not a directory, and its
own login still applies. Revoke does not erase downloaded data. Choose explicit
same-host cookie behavior (for example, most recently opened link wins); a tab's
initial path must not be represented as per-tab authorization isolation.

## Read-only rollout preflight and requirements

Observed **27 September 02:09:19 Asia/Ho_Chi_Minh**: NEW active PID 2937958 on 5174,
local health `{status:ok}`; OLD inactive/disabled PID 0. Nginx exact-host map routes
only p2345, p5180, p5210, p5211, p5212, p5213 and p5215.danhkhai.io.vn to 5174.
NEW config requires secure API and uses its own Services state path. The receipt
contains only whitelisted routing/path metadata and code/config hashes, no secrets.
No fresh public DNS/TLS or encrypted readiness request was made in this phase.

1. Integrate against exact 177e812 lineage and capture the new candidate hash.
   Source/runtime publication directories are distinct; preserve the shipped table
   frontend and existing history/TECH/tool, owner Files, Push and PWA behavior.
2. Prepare a **new** package with exact observed backend/client/config baselines.
   `scripts/history-release/plan.mjs` is specialized to history-json/rollout-history
   and old be0dcbc baseline: it is incompatible unchanged. Do not edit/reuse a sealed
   historical package or broaden publication to all dist-server files. Enumerate
   only actual share delta JS/maps plus matching client/SW and any explicitly
   required non-secret config addition; final list requires integrated-source review.
3. The new durable grant file belongs under NEW private state, not a repo-relative
   or OLD default. Initialize/migrate once, fail closed, and preserve registry
   identities through restart. Bind allowlist/config to the actual seven hosts;
   no DNS/TLS expansion is part of this feature.
4. Preserve Hours JS `b763a0f7…`, map `6a76da38…` and corrected 703ad317 template,
   all owner/VAPID identities, subscriptions, Hours/user/native/Vault data and OLD
   disabled. New grant/registry state is mutable data, never a code rollback payload.
   State/schema rollback must not restore revoked grants or obsolete incarnations.
5. Reuse reviewed NEW-only workflow with payload/drift checks, private code backup,
   publication lock and durable attempt/restart markers. ALL-idle includes active,
   queued/starting work and pending reports/questions; no worker/leader exemption
   or waiting in a turn for its own idle. Exactly one NEW restart; no automatic
   replay, state restore or rollback after an ambiguous partial attempt.
6. Verify backend health before publishing SW/index last. Final verify checks PID,
   local/public client and routes, immutable identities, Hours, OLD disabled, and
   harmless encrypted owner Files read. Share lifecycle/expiry/revoke/WS tests use
   fixtures; do not silently create a real share for an existing service as smoke.
   Candidate records must say prepared/armed/live according to durable evidence.

## Completed checks and boundaries

Eight focused tests passed (three new design controls plus five existing real
session/cache-race controls); fixture lint zero warnings/errors. Chromium
app-worker substitution and separate-origin positive control passed using copied,
hash-matched live proxy/auth/session/cache modules. First browser attempts already
proved fragment interception but timed out on a resource-timing assertion; waiting
for actual fetch completion fixed that harness and confirmed upstream receipt.
No full suite, app build, edits to other checkouts, real model turn, public share,
production mutation, arm/restart/deploy or recursive delegation.

Actual own-thread model/effort read from the native metadata database through a
read-only query: **gpt-6-astra / xhigh**. No transcript or credentials were read.
Private evidence: `/root/.local/state/codex-remote-secure/reviews/preview-share-10f9dcb1`.
The exact integrated implementation review follows separately; none of A01–A26 is
claimed implemented merely because the contract requires it.
