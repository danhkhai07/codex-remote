# Encrypted API v1 — implementation plan and review contract

Base: 9151e6746e56687b0bdac896ce9b36726f8a71b6. Not deployed. This is a
security-critical application protocol requiring independent review. Passing
fixtures is not a cryptographic audit. Root/fullAccess stays unchanged.

## Threat model

HTTPS remains mandatory in production. Add owner-key possession beyond a stolen
HTTP cookie and keep private API method/path/query/body, response/error and SSE
payloads opaque to an HTTP intermediary. Headers, cookies, lengths and timing
remain observable. Not protection against VPS/root compromise, an actively
modified frontend, or XSS while unlocked. Not end-to-end encryption to a model;
existing server storage/history and existing local drafts are out of scope.
Isolated preview app HTTP/WS retains its own HTTPS/cache policy, not this tunnel.

Owner key: random 256 bits, distinct from login password; local provision/rotate
CLI writes mode 0600 outside file roots and never prints the key. Operator moves
it over their existing SSH/password-manager workflow. One owner key across devices
in v1. Key stays only in JS memory while unlocked; reload requires unlock again.
No key persistence in IndexedDB, localStorage, service worker, URL or log.

## Protocol

Use pinned jose Compact JWE (dir/A256GCM), native WebCrypto HKDF-SHA256 and random
nonces; no handwritten crypto primitives. Domain-separated derived keys for
proof, channel request, channel response and persistent cache. No compression.
Protected JWE headers bind protocol version, channel, direction, request ID,
sequence and frame kind. Reject unexpected algorithms/headers/context, malformed,
reordered/truncated frames and cross-channel packets.

Public endpoints: minimal health/setup metadata, login, authenticated challenge
and handshake. Login returns no workspaces/private metadata in required mode.
Challenge random one-use, short TTL, bound to session nonce/credential generation
and owner-key generation. Proof decrypts only under a key derived from the random
owner key and challenge context. Challenge consumed before asynchronous proof
verification. Fresh channel keys include server challenge and fresh channel ID.
Caps/expiry apply to challenges, channels, active requests, used IDs and buffers.
Current caps: 128 pending challenges globally / four per session, 30-second TTL;
eight concurrent handshakes globally / one per session; 64 channels globally /
eight per session, 15-minute lifetime bounded by session expiry; 32 active requests
globally / 12 per channel; 2,048 used request IDs per channel. Admission is reserved
before asynchronous work. Old idle channels can be evicted only after valid proof.
Failed proof admission also uses a bounded per-IP limiter (eight failures per 15 minutes,
4,096 identities; trusted-proxy resolution, Retry-After). It reserves before body
reads and finishes on every outcome; password-login success cannot reset it.
All public/setup metadata is version/type checked before selecting client mode.

Only authenticated /api/secure/request dispatches business APIs in required
mode; legacy /api/* is rejected even from localhost. Internal dispatch reuses
session registry, host/origin, CSRF, root/fullAccess/role checks, size and file
policy. Request header and bounded 64KiB body frames are encrypted; final frame
required before any business dispatch. Upload cap stays 25MiB (encrypted wire
budget is larger); v1 buffers this existing bounded request, not arbitrary files.
Response metadata, bounded body frames and final length/frame-count are encrypted.
Downloads stream with backpressure and SSE remains bounded/reconnectable. End
frame is required; abrupt stream end is an error and reconnect uses existing
cursor/epoch/dedup logic. Revocation/expiry closes active streams.

IDs reserved before dispatch, duplicates never execute twice, including concurrent
requests. Do not automatically retry mutations on unknown transport outcome.
Re-handshake on the same unlocked page may reuse the in-memory owner key, but not
old channel packets. Browser must match responses to request ID/context. Key or
password rotation/restart and logout invalidate old channel use. Exceptions and
business errors after proof remain inside encrypted responses.

## Ciphertext cache

IndexedDB default total 64MiB, entry <=8MiB, TTL 7 days, bounded LRU. Namespace:
app instance + owner key generation/account. Per-installation random nonsecret
salt derives a cache key separately from transport; each write uses random JWE IV.
Resource paths/headers/revisions are encrypted; lookup keys are keyed opaque IDs.
Never replay transport ciphertext as a new response. Cache body is reusable only
after a fresh authorized GET through business dispatch returns an encrypted
unchanged result bound to the resource/representation/revision. No HTTP 304 on
POST and no offline private display in v1. Larger responses stream normally and
are not automatically cached. Corruption/quota/missing/old keys safely refetch.
Lock purges decrypted state/URLs/streams but keeps ciphertext. Logout deletes only
this app's encrypted namespaces and broadcasts lock to other tabs. Rotation
invalidates namespace; it does not delete server history. Previously downloaded
bytes cannot be remotely erased. Existing plaintext conversation snapshots must
stop being written/read in required mode; existing drafts are not newly migrated.

## Client and migration merge contract (CR2)

PreviewMigrationGate wraps SecureGate before any session effects. The installed
`installMigrationReady(() => ensurePreviewMigrationReady(true))` rechecks before
setup, login and unlock; api.session also rechecks before restore. Reject cleanup
errors without sending credentials or deriving keys. Foundation 1706f3b is merged.
This known-residue gate is NOT proof of origin integrity; rollout at the existing
URL still requires a new browser profile. See migration-readiness-contract.md.
Unmount private UI on lock/logout, cancel requests and revoke generated object
URLs. Password-manager-compatible unlock field uses current-password but distinct
label/name from login. No automatic password-manager access; tab visibility does
not lock. Agent jobs keep running.

Encrypted HTML uses an opaque-origin sandbox, retaining existing connect/form/
network restrictions; never combine allow-scripts and allow-same-origin. DOCX
render shell has no scripts. Large downloads use a user-chosen stream destination
where supported; any browser fallback limit is explicit. Working Hours backend
uses the pause-aware 783b1e3 source and matching generator/template. Its parent-frame
get/start/stop/pause/resume/replace-totals adapter uses secure transport. Preserve
the new approved runtime hash below; do not reinstall the superseded estimator.
Maintenance knowledge/services/restart watcher use the same authenticated protocol
adapter, no localhost exception. Push payloads are generic, not chat excerpts.

## Validation and release

Fake credentials/RPC only. Test cookie-only, wrong key, replay/concurrent duplicate,
tamper/truncation/reorder/cross-channel, expiry/logout/password/key rotation,
bounded state; real SessionRegistry fixtures. Browser desktop/mobile unlock,
chat/Plan/Files/upload/download/orchestration/SSE/reconnect/lock/multitab; ciphertext
cache reload savings/change/denial/corrupt/quota and storage/network inspections.
Retain isolated preview browser cache/HMR checks. All heavy jobs via codex-heavy,
one worker; full npm run check. Report limits and unimplemented paths explicitly.
Separate protocol/backend/client/cache/tests/docs commits, push and preserve tree.
No production key generation, merge/deploy/restart or existing release edits.
New pinned release includes dependency/runtime/CLI artifacts; preserve work-hours
SHA b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93.

Primary references checked 2026-09-21:
- https://github.com/panva/jose (v6, WebCrypto runtimes)
- https://github.com/panva/jose/blob/main/docs/jwe/compact/encrypt/classes/CompactEncrypt.md
- https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey
- https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams
- https://www.rfc-editor.org/rfc/rfc7516 (JWE)

## Implementation limits to verify explicitly

- Automatic ciphertext cache uses a single IndexedDB readwrite transaction for
  LRU accounting across tabs. Entry cap counts ciphertext, so base64/JWE overhead
  means some bodies below 8MiB are intentionally not retained.
- 25MiB uploads are individually encrypted in 64KiB chunks, with bounded
  pre-dispatch assembly (existing upload size limit). Aggregate request/response
  cache buffers are capped at 64MiB; overflow rejects uploads or streams responses
  without caching. This does not claim constant-memory browser Blob upload.
- Download transport and server stream without whole-file assembly. Desktop
  File System Access API can save arbitrarily large allowed files with backpressure.
  Other browsers have an explicit 64MiB Blob fallback, and large previews have the
  same explicit bound. Mobile/Safari large-file save parity is not complete v1;
  never silently issue a plaintext download URL to work around it.
- Static /secure-viewer and /secure-docx-frame contain no private data; they are
  renderer assets. HTML is sent to an opaque sandbox with connect/form/object/
  remote resource access denied; it receives neither cookie access nor key.
- Existing device-cache conversation plaintext is no longer read/written in
  required mode. Legacy persisted drafts, pinned paths, settings and screen state
  remain a documented residual; this feature does not migrate those stores.
- Old administrative /preview links are rejected in required mode; issue preview
  tickets through the encrypted API. Workboard redirect integration must open the
  authenticated client launch flow, not rely on a cookie-only /preview shortcut.
