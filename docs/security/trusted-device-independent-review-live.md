# Trusted device: independent review and live publication

Task `fe0f2b91-9e9a-4fae-bf56-ab4d5d7543a8`, 23 September 2026.
Reviewer CR3 actual turn receipt: `gpt-6-astra/high`, not max. No delegation.

**Accepted within the requested trust scope and LIVE on
https://remote.danhkhai.io.vn.** Reviewed trust source
`f246f383c582afc7b92d39b06e8f6e336e04ab81` is unchanged. Published combined
frontend source is `f5d5f9cd2e4588902681bc85e99eb964592ccab9` on
`review/trusted-device-live`. This is not a new audit of the established
encryption protocol. No unresolved finding was identified in this bounded review.

## Review and independent evidence

Read the product delta, the browser fixture and transport tests, including the
guards around every asynchronous restore/save step. Confirmed opt-in defaults
off, nonextractable HKDF capability storage, HMAC-authenticated metadata, exact
origin/app/generation/session binding before remembered proof, fixed deadline
bounded by seven days and authenticated session expiry, fresh migration/setup/
proof/uncached session before cache or private UI, and identity pinning on
reconnect. Explicit Lock/forget differs from ordinary unmount; asynchronous
cleanup checks row identity, fence and intent before publishing/adopting state.

Independent real-browser additions in
`scripts/trusted-device-independent-browser.mjs` verified:

- Unmount retains opt-in, while releasing RAM; reload reauthorizes.
- Successful owner proof followed by a failed uncached session request never
  mounts private UI and does not silently discard a valid opt-in.
- Changing the cookie session on an already unlocked page causes reconnect to
  reject before another owner proof. Only the channel-expiry clock comparison
  is advanced; the challenge is evaluated against real time.
- Corrupt origin metadata is rejected before proof.
- Failure of both durable forget mechanisms produces a visible error and
  leaves private UI locked.
- Retrying Forget after storage recovers actually removes the row; reload
  stays locked.

These ran with the author's Chromium lifecycle controls, real IndexedDB,
SessionRegistry/router, fake credentials and zero native mutation effects.
Independent focused Vitest run: **35 tests / 3 files** (transport trust,
independent lifetime regressions, and preserved Files links). Lint, client
typecheck, clean client build and PWA validation passed. Actual combined build
also passed Chromium/WebKit UI at 1280/390, plus Files browser controls at
1280/390/320: new tabs, download, hidden listing, symlinks, sandboxed HTML,
conversation links, draft/Plan preservation and Lock.

Reused CR2's hash-verified 560 Vitest + 11 Node full check, final 36 focused
controls and WebKit trust lifecycle evidence; did not repeat the broad suite.
All heavy work ran sequentially through codex-heavy with bounded heap and one
Vitest worker. Playwright WebKit is not physical iPhone Safari.

## Deployed Files baseline reconciled

The first read-only baseline check deliberately stopped before tests or writes:
the original activation manifest no longer described 16 backend artifacts.
Narrow inspection found the completed owner Files deployment
`8aedf3e7da9b8779a3da7db9dfc6ee0ec253ec12`, marker
`/root/.local/state/codex-remote-secure/owner-files-deploy.json`, at
2026-09-23T10:49:37Z, NEW PID **1978365**. All 16 deltas matched its immutable
payload hashes; all remaining backend files matched the original baseline.
Nothing was rolled back or rewritten.

The trust candidate branched before that deployment's seven frontend changes.
Integration commit `2970c51` preserves those exact Files routes/links/mobile
styles and its existing browser fixture. Trust product files remain identical
to the reviewed candidate; no backend source change was introduced for this
integration. The matching 25-file client includes menu/login/no-floating-Lock,
PWA first-claim handling, owner Files and optional trust together.

## Actual publication and verification

Root-private evidence directory:
`/root/.local/state/codex-remote/trusted-device-live-fe0f2b91`.

- Shared deployment lock, fresh preimages and verified private client backup.
  Ten changed files; hashed assets first, worker before atomic index last.
  All old hashed assets retained. One existing source map was retained only
  after identical JS and equality of every map field except source paths.
- All 25 disk hashes, **40 public/loopback full-body hashes**, and eight import
  references passed. No backend symlink/build output entered runtime.
- Actual live Chromium profile opted in, closed the entire browser, reopened
  with a fresh proof and unchanged deadline, then forgot trust and remained
  locked after reload. RAM-only manual unlock, mobile menu and logo Lock passed.
  Cookie-only private API returned 403; no raw key in secure packets or
  local/session storage. Private credentials were consumed only in memory;
  screenshots precede credential input. Own session revoked and profile removed.
- All 90 backend artifacts, including compiled secure-client, helpers, key,
  config and OLD source/client/backend stayed identical to the fresh baseline.
  NEW PID **1978365**, OLD **1934453**; no restart. Hours JS
  `b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93`
  and map `6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8`
  remain unchanged. No model turn or Hours action.
- NEW Services entry updated and read back using matching encrypted maintenance
  CLI with a clean environment. Shared lock released; owned fixtures stopped.

LIVE marker finalized **2026-09-23T11:14:00Z (18:14 +07)**:
`LIVE.json`, SHA-256
`b9b1cbf33d1b7ae8694a326c242a4e11dc3c86b2d154b1a1234c130aff4a3cfd`.
Candidate inventory SHA-256
`3dc3e8bcc68b50c72cdf72b09a67cbcce7ca23b0a23101d06c6954c79f11a5d2`.
Review decision SHA-256
`3a5c50ee13272d8f6c9139512260e4f80b36f025b01925a451295812a015bd13`.
The marker binds public/live verification and Services evidence hashes.

## Limits and rollback

Trust belongs to this browser profile and current server session. It is not
hardware protection, biometric authentication, protection from active same-origin
XSS, or a secure-erasure guarantee. Browser eviction/privacy policy may remove
the capability; offline access is not enabled. User browsers were **not** opted
in automatically. The checkbox is an explicit choice during unlock.

Prefer a forward fix. Restoring the old RAM-only frontend does not erase the
new IndexedDB record and removes its cleanup UI. Before such a rollback, retain
a cleanup-capable client or have opted-in profiles Forget/Lock and revoke their
sessions; never claim a server file restore erases remote browser capabilities.
No backend downgrade, key rotation, state restore, OLD shutdown, or broad cache
clear is part of this publication. Keep this worktree and evidence for intake.
