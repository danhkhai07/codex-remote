# Trusted browser for up to seven days

Task e3f8188a-cceb-4068-a29b-490bad242ee6. User explicitly approved “Đồng ý lựa chọn
nhớ 7 ngày”; this supersedes the pending choice in remote-session-return.md.
Implementation only, not a deployment approval receipt. Own thread metadata was
gpt-6-astra/high; no model override/max claim. Base245fb23 retains live UI/PWAae2bd95.

## Plan and boundary

Opt-in is unchecked. The browser stores one nonextractable HKDF CryptoKey by
IndexedDB structured clone, never raw owner-key text/password in localStorage or
sessionStorage. Expiry is fixed at min(save time+7days, authenticated session
expiresAt); ordinary restore never writes/extends that deadline. Explicit Lock
app/logout/forget invalidates trust. Ordinary React unmount/page exit clears RAM
only. The existing branded Gate/menu and first-PWA-claim fix remain.

Existing challenge.binding is SHA256(session.nonce + ':' + credentialVersion).
The client matches stored app/generation/binding BEFORE deriving/transmitting a
remembered owner proof. There is no new API route or weaker cookie-only private
access. Fresh setup/migration readiness precede record restore; a fresh challenge,
proof, authenticated channel and uncached encrypted /api/session precede cache
key setup/private UI. The transport pins identity for reconnects too. A new login
with the same password still has another nonce and cannot reuse previous trust.

## Persistence and races

The record contains exact origin/app/generation/session binding, created/expiry,
CryptoKey, random record ID and revocation fence. Owner-derived HMAC with a
separate trusted-device-record/v1 domain authenticates these metadata fields;
corrupt TTL/binding/identity/signature is rejected. The browser-profile key can
still be USED by same-origin code; nonextractable does not mean hardware,
biometric, OS-unlock or XSS protection. No at-rest disk encryption guarantee is
made by WebCrypto. Root/fullAccess scope is unchanged.

LocalStorage contains only two nonsecret values: a random revocation fence and
an active-record pointer. Explicit forget rotates the fence synchronously before
awaiting IDB deletion. Pending saves retain their old fence/intent; transaction
abort and final guards reject them. A save publishes its active-record pointer
only AFTER the IDB transaction and a final live-intent check; interrupted or stale
commits leave unadoptable orphan rows. Cleanup checks the random row ID to avoid
deleting another tab's newer save. A blocked deletion cannot make an old row
restorable while the durable fence remains. It is not a secure-erasure promise.

Storage open/transaction deadlines are bounded. Missing fence/pointer, quota,
blocked storage or invalid capability fails closed on automatic restore. Explicit
RAM-only entry remains possible. Network loss does not delete a still-valid
record or open private data; retry via reload requires fresh authorization.
Unauthorized/session/generation failures discard that record. Expiry is checked
at restore, during async work, on private access and when returning to a visible
page. No stale completion may close a newer unlock or replay a mutation.

If both localStorage revocation and IDB deletion fail, the UI reports inability to
forget instead of claiming durable deletion. The menu's normal Lock app performs
server logout/revocation; the retained old session binding cannot authorize after
that logout even if a physical orphan row remains. Browser storage loss/user
clearing is treated as loss of trust, not permission to adopt an orphan key.

## Tests and regression intent

Owned temporary browser profiles, generated fake keys/sessions, actual IndexedDB,
HTTP router/SessionRegistry/proof/transport/Gate; no model turns/real Hours action.
Chromium and Playwright WebKit (not a claim about a physical iPhone) exercise:
- Default off, reload, close/reopen tab and complete browser; unchanged deadline.
- Nonextractable HKDF, origin/generation/session scope, max7days/short session cap.
- Session change and generation rotation rejected BEFORE any owner proof.
- Logout/replayed cookie401; TTL/live expiry; two-tab Lock/forget.
- Corrupt binding/TTL/signature; blocked storage and quota; RAM-only recovery.
- Lock during delayed restore; late save vs a newer unlock; crash after fence;
  failure after key write but before publication; transient offline restore.

Four transport tests check app/generation/session mismatch before proof and reject
an unrelated persisted CryptoKey before network. Existing independent R1/R2
fixtures now return an authenticated session contract for the new mandatory
session check; request-count assertions distinguish that legitimate authorization
GET from a forbidden replay of the old private read. No guards were weakened.
Full check and browser commands run sequentially through codex-heavy, one worker,
heap1024MiB. Exact results/hashes are in the private delivery report at handoff.

## Integration and rollout

This candidate starts from current combined UI/PWA245fb23, not old cf5d590. It owns
Gate, secureApi, trustedDevice, the shared secure-client library and tiny checkbox
CSS. The shared transport lives under server/ but is bundled into the frontend;
no gateway module imports secure-client. No HTTP/config/wire/backend contract
change is required. A full server build emits a changed secure-client.js/map for
CLI consumers, but neither is required to publish this browser feature: leave
ALL deployed backend files unchanged, including Hours and its map.

After bounded root review, publish the complete matching new client to NEW5174
only: stage/backup with a fresh current frontend baseline, preserve old hashed
assets for open tabs, copy assets/SW first and atomic index last, verify local and
public bodies/entry hashes and unchanged backend/PIDs/Hours. Do not overwrite UI
with the older session-return build or merge into OLD main. No backend restart,
new key creation/rotation, state migration or automatic opt-in on a user's browser.
User must reload the new client, enter the key once and tick the optional box.

If reverting frontend after users opted in, retain schema/cleanup handling or
explicitly forget/revoke trust first; old RAM-only code will not restore the row,
but it cannot promise to erase the newly introduced durable capability. Prefer a
forward fix. Do not use old rollback scripts that stop OLD or restore databases.

Standards context: https://www.w3.org/TR/webcrypto/#security-considerations and
https://www.w3.org/TR/webcrypto/#cryptokey-interface. This is browser-profile trust,
not separate hardware-bound per-device credentials or remote per-device revocation.
