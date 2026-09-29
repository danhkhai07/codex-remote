# Share link creation disclosure and expiry editing

Candidate for root review; not deployed or armed. Base is LIVE source
`75fefb22690d03a006905a3b70f0d5a8dec27607`. Fresh runtime inventory matched its
complete backend/client inventory; actual observed PID was 4052311 (the earlier
3784853 receipt is historical). Original review checkouts and seals are retained.

The user requested creation only after pressing `+`, and editing the lifetime of
an existing link without revoking it, with a maximum of one day. The root's
explicit interpretation is **createdAt + 24 hours total lifetime**, not 24 more
hours at each edit. This implementation follows that interpretation without
recording it as an additional independently confirmed user preference.

## Behavior and authority

The existing English Share links popup initially shows its list and collapsed
history. `Create link` is the accessible name of the compact plus button. The
existing form appears on demand and closes after Cancel or successful creation,
returning focus to the plus. Active rows offer an inline expiry editor in the
browser's local timezone, show the latest allowed time, and retain the URL.
Countdowns use the existing server-clock anchor; save responses refresh it.
Mutation locks prevent double Save or simultaneous edit/revoke of the same row.
Other rows remain independently revocable. Request generation/lifetime checks
keep stale GETs and closed/locked-dialog continuations from replacing results.

Encrypted owner `PATCH /api/preview-shares/:id` accepts canonical ISO UTC strings
`expiresAt` and `expectedExpiresAt`. It requires CSRF and rechecks owner lifetime
after the awaited body read, immediately before the synchronous store update.
Only active, allowlisted, still-registered grants can change; the new expiry must
be strictly after server time and at most creation + 24h. A conflicting stale
edit gets 409. Retrying the already-applied target is idempotent while active.
Expired/revoked/unavailable grants never revive, including identical retries.

Atomic fsync/rename persistence preserves grant ID, creation, service generation,
port, label, path and capability. A failed save disables sharing and closes live
access, as before. Service replacement and independent revocation remain intact.

## Capability, cookie and stream compatibility

Previously the URL signature covered mutable expiry. On first edit, optional
`tokenExpiresAt` records the original signed value. Signing omits that new field
and reconstructs the original grant object, retaining already-issued URLs across
edit and restart. Unedited version-1 files load unchanged; no eager migration or
production data rewrite is needed.

New recipient cookies retain the same name/security flags and a signed retention
ceiling at creation + 24h. Every HTTP request and WS/stream guard still consults
the current server grant, so a retained cookie cannot bypass a shortened expiry,
revocation or service replacement. Editing never grants beyond the original
24h ceiling. A legacy cookie's original signed expiry is accepted only for that
same grant identity; explicit owner extension changes that grant's authority.
HTTP responses refresh legacy browser retention to the fixed ceiling. A browser
that already discarded its legacy cookie before making another request must
reopen the **same original URL**. No recipient owner login/key is required.

Handoffs retain their one-use, port-bound 60-second deadline and additionally
check the live grant at redemption. Already-open HTTP/WS watchers cancel their
old expiry timer and schedule the current server cutoff after any edit. They
cannot outlive terminal status; already-delivered bytes cannot be recalled.

## Rollout boundary and recovery

After root reviews expiry/security semantics: build/publish only
`http-app`, `localhost-preview`, `preview-shares` JS/maps plus the whole matching
client. Preserve all other modules, especially secure-client JS/map, event-hub
map, context/prompt improvements and Hours JS/map/template703ad317. No dependency,
config, registry-generation, key or native change is required.

Use a NEW package, fresh observed preimages and private backups, shared publication
lock, and NEW-only ALL-idle/zero-pending gates with no own-turn exemption. Backend
and hashed assets precede restart; health precedes SW/index publication. Keep old
hashed assets for open tabs. Postverify health/fresh PID, code/client hashes and
encrypted read-only share list without creating production links. Do not replay
any prior runner. After successful publication, update only the existing root
Services record and checked Vault notes.

Never restore an old grant store or silently downgrade this module after edits:
old binaries do not interpret `tokenExpiresAt` or fixed-ceiling cookies. Prefer a
forward code fix, preserving issued/revoked grants and original capability fields.
Any code-only rollback needs an explicit compatibility plan and fresh idle gate.

## Validation and evidence

Full `npm run check` passed with 687 Vitest cases across 94 files, 11 Node cases,
lint, typecheck, client/server builds and PWA validation. The first full run used
an inherited TMPDIR below `.local`; 14 Files tests correctly rejected that
restricted fixture location. The complete rerun used `/tmp` without weakening
file policy. Logs retain both runs. The existing large-client-chunk warning is
unchanged.

Final encrypted browser fixtures pass Chromium 1280/390/320 against both fake API
and the actual candidate backend with isolated state and owned fake services.
They cover initial list-only view, plus/Cancel/focus, create, edit preserving URL,
anonymous recipient cookie access, shortened cutoff, revoke, stale GET, double
Save, error/retry, closed/locked lifetime and chat draft preservation. Development
StrictMode passes at 1280. HTTP and WebSocket tests hold actual sockets across
extension beyond the original expiry and closure at the shortened cutoff. Store
tests cover restart, original signed URL, legacy cookie, terminal/stale edits,
creation ceiling and persistence failure.

One visual correction followed the batched review: split the native date-time
field into labelled date and time fields because its contents clipped at 320px.
Final typecheck, focused lint, client build/PWA and all browser fixtures passed
after this client-only correction; backend/source checks remain applicable.
Final 320/390 screenshots show the whole input without reducing font size.
Physical Safari/iOS is untested. No production share or model turn was created.

Private evidence is under
`/root/.local/state/codex-remote-secure/reviews/share-link-expiry-fb1d0f67/`:
`check-final.log`, `correction.log`, `screenshots-final/`, `artifacts.json` and
`delivery.json`. The manifest binds the exact six backend files and complete
25-file client graph, validates imports/source maps and confirms unchanged
runtime inventory/dependencies/Hours. The existing same-name docx source map uses
LIVE bytes only after all non-path fields and normalized source paths matched.
The staged candidate lives in this worktree's `dist-server` and `dist`; those
generated outputs and all private evidence are excluded from Git.

## Authorized rollout

Root accepted exact product `5378c9330a2711c0e52a86ee6b44698b93fda38a` for
NEW deployment after independent source and evidence review. The follow-up
`scripts/preview-share-release` runner binds that product separately from its
runner/docs commit. It verifies the already-live sharing configuration byte for
byte and never publishes configuration. Its backend allowlist is exactly the
six JS/map files above; the client payload is the complete matching 25-file
graph. Immutable assets publish before one restart; `sw.js` and `index.html`
publish only after backend health, with index last.

Use a newly named private release and never replay an existing attempt:

```sh
node scripts/preview-share-release/deploy.mjs prepare "$release" "$worktree" "$evidence"
node "$release/deploy.mjs" baseline "$release"
node "$release/deploy.mjs" check "$release"
node "$release/deploy.mjs" arm "$release" "$(sha256sum "$release/seal.json" | cut -d' ' -f1)"
systemd-run --unit=codex-preview-share-expiry-5378c93 --collect \
  /usr/local/bin/node "$release/deploy.mjs" apply "$release"
```

The watcher uses encrypted metadata plus global orchestration state and exempts
no conversation. If it is waiting on the coordinating turn, end that turn and
report ARMED. Do not poll it from the same task. `apply-attempt.json` permits
exactly one apply. After an ambiguous post-restart verification failure, inspect
the phase and hashes and use only the sealed verify-only recovery command:

```sh
node "$release/deploy.mjs" verify "$release"
```

Verify-only never restarts and cannot publish an unsealed backend. It may finish
sealed SW/index publication after proving a fresh healthy backend. Mutable grant
and registry stores are evidence only after restart: never restore their backup.
