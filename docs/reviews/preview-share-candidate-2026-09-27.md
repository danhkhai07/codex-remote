# Independent preview sharing candidate review

Task `099394e2-91a8-4c47-97d2-d152cc74fd66`. **Accept the exact source pair below
within this review scope; no reproducible P1/P2 findings remain.** This is not a
runner approval, a claim of deployment or a replacement for CR4's combined check.
The user's feature/deployment authorization already exists.

- Base: `177e812c2f9b441f201bbdba365a252fdba63cf3`.
- Backend: `5b7f4765a19291640830e7dd443461c53009b3ea`.
- Popup: `a1d6f0f508934d31cfdb502a2e8e0c90b874bb65`.
- Independent merged source: `bad178de4abb98da0be1e6166894670ff29ad538`.
- Branch/worktree: `review/preview-share-candidate`,
  `/root/WORKTREES/cr-preview-share-candidate-review`.
- Both merges were clean. Every changed source file matches its original commit
  byte-for-byte. No product edits, conflict resolution or semantic merge delta.
- `preview-share-candidate-2026-09-27.files.json` binds acceptance to 11 changed
  product file hashes and unchanged critical guards/PWA/Hours/Browser/Files/history
  files. Integrators can compare these without rerunning this whole review.

Criteria: independent design review `192e22d`, S1–S4 and A01–A26, plus the shared
contract and backend documentation. Actual own-thread metadata confirms
**gpt-6-astra / xhigh** (read-only query; no transcript or credential read).

## Closure of the four design findings

**S1 closed for the stated reusable-capability boundary.**
`server/preview-share-page.ts:8` captures and synchronously removes the fragment,
posts the capability only to the trusted admin exchange with credentials omitted,
and submits a distinct random one-use handoff to preview. Exact static routes
are dispatched after host validation (`server/http-app.ts:715`), outside the
private encrypted API; bootstrap CSP denies framing and limits form targets to
configured origins. The existing PWA fetch handler (`public/sw.js:151`) bypasses
`/preview/` and non-GET requests. No new SW bypass or generalized anonymous API
was introduced.

Independent actual HTTPS browser controls passed with the unchanged real admin
PWA installed in Chromium. The app's malicious root worker intercepted the
preview handoff, but saw no reusable capability in URL, body or referrer. Only
the trusted admin exchange received that capability. Fresh Linux WebKit also
completed external-origin bootstrap, form POST, 303, cookie and reload without
an owner session. Both runs had zero page errors. WebKit was tested without an
installed admin/app SW; the two SW boundaries were exercised in Chromium.

`SameSite=Lax` on the host-only Secure HttpOnly share cookie and `strict-origin`
on the bootstrap are intentional and acceptable here. The origin sent to redeem
is the exact admin origin; a null/foreign origin is denied, even with forwarded
headers. Cookie signatures, durable grants, port binding and origin checks remain
mandatory. `strict-origin` sends no bootstrap path/query/capability; preview
responses use no-referrer. Changing these headers blindly would break the tested
cross-site handoff. An app worker can still observe the one-use handoff or retain
received app data; that documented limitation is not reusable-link disclosure.

**S2 closed.** `server/services.ts:77` durably migrates random UUID identities
before grants can bind; `:115` retains identity for exact normalized no-op updates
and rotates it on meaningful metadata edits. Retirement/recreation always rotates,
including identical records within one millisecond. `server/preview-shares.ts:52`
checks current identity for every usable grant. Watchers propagate retirement or
persistence failure to live transports. Author tests cover migration/restart,
no-op versus edits, same-tick recreation during held probes and failed registry
writes. They were read and reused against hash-matched source/artifacts. Silent
external listener replacement without a registry change remains unobservable.

**S3 closed.** Owner management remains behind encrypted transport, session,
request lifetime, origin and CSRF (`server/http-app.ts:293`, `:359`;
`server/secure-api.ts:157`). Creation reads its bounded JSON, checks `live()`, then
selects current service identity and persists synchronously. It never authorizes
from a probed snapshot. List checks live authority and current identity/metadata
after its probe (`server/preview-shares.ts:86`). Independent held-body redemption
was denied after retirement; hash-bound author controls deny a held owner list
after logout and omit a removed/recreated service.

**S4 closed in source, with explicit rollout configuration.**
`server/config.ts:93` accepts exact numeric ports; `PreviewShares` intersects them
with registered port services and blocked gateway/listener ports. List and POST
both enforce the intersection, require HTTPS and have no arbitrary-target fallback.
Internal path-only registrations cannot be shared. The default allowlist is empty;
root must bind the deployment input to the seven existing exact hosts, as documented
by CR2. This source review does not silently populate or approve a changed live
allowlist.

## Additional independent controls

`codex-heavy-25d733fa01b3417fb7e8c5fa8eb09a21.service`, one sequential job,
Node 22 and heap capped at 1024 MiB:

- Focused lint: zero warnings/errors.
- Six tests in `scripts/preview-share-candidate-review.test.ts`: expiry and
  retirement immediately after real body hashing prevent 304/body; invalid,
  duplicated or revoked share cookie cannot fall back to valid owner preview;
  foreign/null origin plus forwarded fields cannot redeem or upgrade WS;
  retirement during an incomplete handoff body denies redemption; max-24h grant
  is expired at its exact durable restart boundary.
- `scripts/preview-share-candidate-browser.mjs`: actual owned HTTPS gateway,
  cross-site synthetic admin/preview hosts through a fixture-only CONNECT proxy,
  Chromium and Linux WebKit at 390×700, no owner session. Actual admin PWA and
  malicious app SW tested in Chromium; fragment clearing, capability confinement,
  host-only cookie, 303, reload and invalid-link response passed in both engines.
- No test failure occurred in this review job. No real model turn, public share,
  production preview/runtime request or mutation, package, arm, restart or deployment.
  Checked Vault reference/handoff maintenance is separate and authorized.

The HTTP fixture setup is copied from the exact author candidate; new assertions
are independent boundary probes. The hash validator invokes the real hashing
implementation and changes authority immediately afterward, before expiry timers
can run. Auth, grants, persistence and upstream HTTP are real fixture components.
All temporary sockets/servers/browsers are closed by the fixtures.

## Reused evidence and acceptance map

Verified all 10 CR2 delivery evidence hashes, 102 compiled backend file hashes,
all 25 UI artifact hashes and 4 UI screenshot hashes. Exact source comparison
covers both candidate commits. Reuse 92 unique backend controls, author Chromium
1280/390, UI 13 focused tests/typecheck/lint/client build/PWA and encrypted popup
browser 1280/390/320 plus development StrictMode. Earlier author harness failures
are retained in their logs; final corrected controls/browser receipts passed.
No broad suite was repeated by this reviewer.

Legend: **I** = new independent runtime probe; **B** = hash-verified backend
controls/source review; **U** = hash-verified popup evidence/source review.
A criterion row can combine exercised paths and inspected invariants; this is not
a claim that every combinatorial variant was executed independently.

| Criteria | Evidence and conclusion |
| --- | --- |
| A01 owner/auth/CSRF | B: encrypted proof, cookie-only/anonymous denial, missing CSRF, logout; unchanged secure transport guards. |
| A02 awaited authority | B held owner probe/logout and same-tick replacement; I held public body/retirement; synchronous creation after live check. |
| A03 maximum lifetime | B invalid types/ranges and expiry; I exact 86400-second boundary after restart. |
| A04 scope/path | B registered/allowlisted/gateway/HTTPS/path denial; path is service navigation, not directory isolation. |
| A05 independent recipients | B two recipients, independent grants/revoke, idempotent retry. |
| A06 owner logout | B owner API revoked while intentional public access/exchange remains. |
| A07 incarnation | B migration/restart, metadata edit, no-op and identical same-tick recreation. |
| A08 active identity change | B established HTTP/WS retirement; I held body and after-hash retirement. |
| A09 forged credentials | B cookie/capability/handoff tamper/replay/port checks; I duplicate/invalid/revoked cookie plus valid private cookie. |
| A10 origin/host | B port-bound handoff/access and host parser; I foreign/null origin, spoofed forwarding, denied WS, no upstream hit. |
| A11 worker interception | I actual installed admin PWA plus root app-worker handoff interception; reusable bearer confined to admin. |
| A12 bootstrap input/redirect | B exact routes/origin/JSON/body bound, static CSP page, trusted configured form targets; no attacker return URL. |
| A13 replay/timeout | B 60-second one-use handoff, wrong port/replay/timeout; never extends grant TTL. |
| A14 credential filtering | B reserved Cookie/Set-Cookie/forwarding/header filters and preserved app auth; I browser request/upstream/referrer confinement. |
| A15 durable authority | B every signed cookie checks current grant/status/identity; corrupt file startup fails; unknown/pruned cannot authorize. |
| A16 HTTP/cache race | B revoke/expire/retire streams and delayed headers/304; I exact after-hash expiry/retirement before 304/body. |
| A17 WS race | B late upgrade denied, established revoke/expire/retire close sockets; I origin denial. |
| A18 cache | B existing private-cache controls unchanged; I PWA bypass and post-hash guard. Saved/offline app bytes cannot be recalled. |
| A19 durability/write failure | B restart/revoke, malformed state, grant/registry failure disables access and closes watchers; source bounds/atomic writer reviewed. |
| A20 capacity | B 128 active/512 records/1024 handoffs/2048 watchers, 32 parser slots, 2 KiB/10s body; active grants not evicted. No network-DDoS claim. |
| A21 same-host cookie choice | B launch clears other credential and last explicit launch wins; I invalid share never uses valid owner fallback. |
| A22 owner list/copy | B active-only URL generation and restart; U escaped text, server clock, closed history and copy/open. |
| A23 responsive/lifecycle | U encrypted 320/390/1280, Escape/focus, abort/unmount/draft/scroll, actual StrictMode; App Lock unmounts popup via session gate. |
| A24 async mutations | U held GET before create/revoke, mutation revision/lifetime checks, double-submit locks, retry/offline/no polling. |
| A25 fresh recipient | I Chromium + Linux WebKit external-site bootstrap/reload without owner cookie/key; physical Safari/iOS not tested. |
| A26 preserved flows | Product hashes preserve Browser/PWA/Files/history/Hours and private-preview backend tests; full integrated suite remains CR4's responsibility. |

## Integration and rollout limits

Backend runtime delta remains exactly the six JS/map pairs from CR2: config,
http-app, localhost-preview, services, preview-shares, preview-share-page. Popup
requires the matching client; SW source is unchanged. No review-specific product
or runtime artifact needs publication.

Runner was not available and was not reviewed. Final packaging still needs the
fresh observed baseline, exact seven-port config input, private NEW grant path,
registry migration preimage and established ALL-idle NEW-only guards. Preserve
Hours JS/map/templates, keys/state/VAPID/subscriptions and OLD disabled. Grant and
registry data must never be restored as code rollback after activation. The old
history-specific runner is incompatible unchanged; root reviews the new runner
separately. These are remaining integration checks, not a new user approval flow.

Private evidence:
`/root/.local/state/codex-remote-secure/reviews/preview-share-candidate-099394e2/`.
Review fixtures/reports only; other authors' checkouts and runtime were not edited.
