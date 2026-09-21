# Browser cache for preview resources

Candidate only until integrated/deployed with the security patch. This does not
make the legacy same-origin preview secure.

HTML with an upstream validator/cache directive, JavaScript and CSS responses
can be stored by the browser with private, no-cache, must-revalidate. Every
reuse reaches gateway authentication first and re-reads the current upstream.
This deliberately overrides even immutable/long max-age assets: port ownership,
restarts and session revocation must not leave an HTTP freshness window.
Vary is retained and Cookie added. Upstream/request no-store, upstream
Set-Cookie (even a stripped reserved cookie), Vary:*, Authorization, range and
write preconditions, non-200 responses, API/auth/session/events routes, encoded
bodies and other content types remain no-store. Dynamic HTML without an upstream
signal is not opted into storage. Upstream no-transform is honored.

ETags are SHA-256 over delivered bytes, after any path-mode rewrite. Downstream
If-None-Match/If-Modified-Since are not sent upstream; upstream ETag/Last-Modified
cannot accidentally validate transformed bytes. GET/HEAD matching tags return
304 with no body or Content-Length. HEAD fetches GET upstream to obtain the same
representation/hash/length as GET, but returns no body to the browser.
An unchanged upstream ETag does not hide changed bytes (including a new port owner).

No disk/shared/CDN/body cache is added. Eligible text is buffered per response,
bounded at the existing 16 MiB rewrite limit. Larger untransformed bodies fall
back to no-store streaming; oversized transformed text retains the existing 413.
Uncacheable responses and SSE keep streaming; WebSocket handling is unchanged.
Savings are downstream response-body bytes, not upstream request count or model
work. Revalidation still costs requests/headers and reads upstream bytes.

## Integration with security

Keep CR2's isolated-only origins, ticket/parent-session validation, reserved header
filters and session watch/close callbacks. Do not restore path fallback just to
merge this change. server/preview-cache.ts is independent of auth/origin policy:

1. In authenticated HTTP forwarding, call previewRequestHeaders for GET/HEAD.
2. Apply previewCacheable to the original upstream headers **before** stripping
   Set-Cookie or replacing cache directives. Call noPreviewCache by default.
3. For eligible bounded text, use validatePreviewBody on the actual bytes (no
   rewrite for isolated origins), then send 304 or the bytes. Preserve the
   security session watcher throughout reading/hashing; aborted/revoked responses
   must never proceed to writeHead.
4. Leave launch/error/redirect/WS paths no-store and outside conditional handling.
5. Re-run real candidate SessionRegistry logout/revoke/expiry tests after merge.
   The standalone browser fixture uses a fake revocation guard before the proxy;
   it is not proof that the unmerged security branch is deployed.

The existing base lacks server-side logout revocation. This feature checks the
base's existing auth before revalidation; it does not claim to fix that old bug.
A browser cache cannot erase bytes already delivered or a rendered old page.

## Verification

After building the server, run via codex-heavy, with PLAYWRIGHT_MODULE pointing
to an existing Playwright install if necessary:

- npx vitest run server/preview-cache.test.ts server/localhost-preview.test.ts server/preview-paths.test.ts --maxWorkers=1
- node scripts/preview-cache-browser.mjs
- PREVIEW_CACHE_MODE=isolated node scripts/preview-cache-browser.mjs

The browser fixture uses local temporary Vite files, fake auth and ephemeral
listeners; it closes/removes all of them. It measures response-body bytes on the
gateway (not headers, TLS or user-device latency), verifies reload revalidation,
changed module on reload, API no-store, auth removal and a simulated revoked
grant. The isolated-origin run also verifies Vite HMR updates without reload.
Path-mode HMR is not asserted; its baseline status is recorded in delivery notes.

HTTP caching semantics: https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2.4

Rollout requires leader review/integration with security, idle-safe backend
watcher, Services metadata for any new hosted preview and preservation of the
existing work-hours.js hash
a9a74ac46cd4c72b5ff350188d3edf648d8b4ffe2a5fbf4a494f68fab691bd91.

Observed baseline limitation: on main 25e43c7 the path adapter does not rewrite
Vite's dynamically supplied HMR update URL /dep.js?t=..., which reaches the gateway
without /preview/<port> and returns 400 in this fixture. The legacy path-mode
hot-accept callback can consequently receive an undefined module. The original
proxy reproduced an HMR timeout; this candidate reports that limitation rather
than changing the path-rewrite architecture. Isolated-origin HMR passes with no
page errors. Deploy with the security branch's isolated origin and rerun the
combined fixture; do not treat path-mode cache checks as full HMR acceptance.
