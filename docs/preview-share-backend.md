# Expiring public preview links — backend candidate

Base `177e812c2f9b441f201bbdba365a252fdba63cf3`. This implements the server
contract for a separate frontend integration. It is **not deployed**, creates no
production shares, and changes no frontend, model context, Files policy, Hours,
owner key or preview infrastructure.

## Authority and threat model

An unlocked encrypted owner can deliberately issue a bearer link for one
registered, allowlisted isolated preview service for 1–86400 seconds. It opens
the **service**, not a directory sandbox; the initial path is only navigation.
The service's own login, cookies, Authorization header and behavior remain.
Owner Lock/logout does not revoke intentional grants. Revoke, fixed expiration,
service registration replacement or retirement invalidates them independently.

The trust boundary includes the gateway/admin origin, its signing secret, private
state and configuration. The preview app, its documents and service workers are
untrusted. The link holder can forward the link, operate the exposed service and
keep downloaded data. This is not protection from a compromised admin origin,
root/full-access code, an app relaying already delivered data, external clock
tampering or a listener silently replaced without updating the registry.

The registered port must also appear in `CODEX_REMOTE_PREVIEW_SHARE_PORTS`; gateway
and public listener ports are excluded again on the server. Path-only services
such as `/files`, arbitrary ports and absolute target URLs are not shareable.
The allowlist is separate from the broad numeric preview-origin template. Both
admin and preview origins must be HTTPS. No automatic DNS/TLS expansion occurs.

## Wire flow

1. The owner receives `https://ADMIN/preview/share#ID.MAC` inside the existing
   encrypted API. The MAC uses the durable grant and a separate HMAC domain from
   preview cookies. No raw bearer or owner key is written into the grant store.
2. This exact anonymous admin route serves a static, hash-CSP document without
   the app bundle or preview content. It synchronously clears the fragment, then
   posts the capability to the exact admin path
   `/__codex_preview_share__/exchange` with `credentials: omit`. Other private
   routes keep the existing encryption/authentication gate. Existing admin PWA
   navigation already bypasses `/preview/`; no SW modification is necessary.
3. Exchange returns a random one-use handoff valid for at most 60s and no later
   than grant expiry. A form POST sends only that handoff to the exact isolated
   preview host's `/__codex_preview__/share-redeem`. It validates the admin Origin,
   port, handoff, grant and current registry identity before consuming it.
4. The 303 response sets `__Host-codex_preview_share` (Secure, HttpOnly, host-only,
   Path=/, SameSite=Lax), clears the private preview cookie, and navigates to the
   original relative path. Lax supports a cross-site top-level form/303 flow;
   the cookie's signature and durable grant are checked on every HTTP/WS access.
   Bootstrap uses `Referrer-Policy: strict-origin`: only the admin origin is sent,
   never its path/query/fragment. `no-referrer` would turn this form's Origin into
   `null` in Chromium and break the strict origin guard. Redeem and proxied
   content retain `no-referrer`.

A pre-existing app service worker can see/intercept the short-lived handoff on
its own origin. It cannot replace the admin bootstrap or see the reusable
capability. This distinction is covered by an actual HTTPS Chromium worker
fixture. Bootstrap/exchange/redeem are no-store. Capabilities are never placed
in request URLs, upstream headers/bodies, response errors, Vault or app exports.
Normal recipient browser history contains the cleaned navigation rather than
the capability. An intentionally copied original link is itself a credential.

One share cookie exists per preview host: opening B replaces A for subsequent
requests in all tabs on that host. Existing streams stay bound to their opening
grant. A private owner launch clears the share cookie; a shared launch clears the
private preview cookie. An invalid share cookie never silently falls back to a
valid owner preview cookie. Cookies do not authenticate the admin API.

## Owner API and durable lifecycle

- `GET /api/preview-shares` → `{links, services, serverNow}`.
- `POST /api/preview-shares` with `{port, path?, label?, ttlSeconds}` → 201
  `{link}`. TTL must be an integer, 1–86400; path ≤1024 UTF-8 bytes; label ≤120
  characters. Service selection and mutation are synchronous after the final
  owner/request-live check. Probe results never authorize creation.
- `DELETE /api/preview-shares/:id` → `{ok:true}`. Revocation is idempotent even
  if the already-closed history entry was pruned. No edit/extend operation exists.

Link records contain `id,label,serviceName,port,path,createdAt,expiresAt,revokedAt,
status` with ISO timestamps, and `url` only when active. Status is active,
expired, revoked, or unavailable. Unavailable means registration/config identity
is no longer eligible, not that a TCP listener momentarily stopped. Services
contain `{port,name,path,running}`. The list rechecks owner liveness, current
registry identity and metadata after probes, including remove/recreate with
identical metadata and timestamp.

Services gain a private random UUID generation, migrated and durably persisted
once for existing records. It is not exposed by existing Services APIs. An exact
normalized no-op upsert retains it; **any meaningful metadata change**, including
summary/PR fields, conservatively rotates it and invalidates grants. Delete and
recreate always rotates it even within the same millisecond. External listener
changes without registry updates are unobservable; service owners must keep
registrations current.

The grant file defaults to `preview-shares.json` beside the configured session
state file. `CODEX_REMOTE_PREVIEW_SHARE_STATE` optionally sets its location.
Production must use a private persistent NEW-instance path. It is a single
gateway-writer store: 0600 exclusive temp file, fsync, atomic rename, directory
fsync. Registry writes use the same persistence boundary. A corrupt grant or
registry identity fails startup closed. A failed write invalidates in-process
sharing and closes connections, returns failure, and requires storage repair;
do not treat an error after rename as proof the mutation did not happen.

Across ordinary restart active URLs and cookies remain valid without extending
expiry; revoked/expired grants do not resurrect. Rotating the session signing
secret invalidates previous share bearers/cookies (a subsequent owner list can
derive new URLs for still-active records). Changing the owner password/key or
logging out alone does not cancel shares.

Limits: 128 active links, 512 records total, 1024 pending handoffs, 2048 watched
HTTP/WS connections. Admission never evicts an active grant to make room. Closed
history is bounded; unknown/pruned IDs cannot authenticate. Anonymous request
parsing is bounded to 32 concurrent bodies, 2 KiB each, 10 seconds; malformed
capabilities have bounded lookup/HMAC work. Full handoff capacity returns 429;
parser capacity returns 503/Retry-After. These are application resource bounds,
not a claim of protection against network DDoS. Expired handoffs are removed at
the next exchange/registry or grant invalidation. HTTP/WS authorization watchers
close connections at expiry/revoke/retirement; guards recheck before upstream,
after headers/upgrade, and after cache hashing. Existing private-cache
revalidation and credential/header filtering remain; no shared CDN caching.

## Integration and rollout boundary

Expected backend allowlist, with each matching source map (12 files total):

```
config.js                 config.js.map
http-app.js               http-app.js.map
localhost-preview.js      localhost-preview.js.map
services.js               services.js.map
preview-shares.js          preview-shares.js.map
preview-share-page.js      preview-share-page.js.map
```

No dependency changes or frontend build is required for this backend alone.
Root will integrate the separate popup UI and publish its matching full client.
Do not copy all dist-server: preserve accepted live/build excluded pairs for
secure-client.js/map and event-hub.js.map. Preserve Hours JS
`b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93`, map
`6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8`, both
703ad317 templates, keys, owner sessions, native/Vault/history and OLD disabled.

Necessary nonsecret config addition, after root verifies current service owners
against the seven existing exact TLS/Nginx hosts:

```
CODEX_REMOTE_PREVIEW_SHARE_PORTS=2345,5180,5210,5211,5212,5213,5215
```

Default is empty (sharing disabled), so this is an explicit deployment input.
Keep every other env value unchanged. Optional explicit NEW state path is
`CODEX_REMOTE_PREVIEW_SHARE_STATE=/root/.local/state/codex-remote-secure/preview-shares.json`.
Capture the actual session/registry path from allowed config metadata; never log
credentials. No Nginx/DNS changes are part of this feature.

Prepare a new sealed integrated package from fresh source/runtime/config
preimages. Back up code/config plus the **current** service registry preimage
before the first generation migration; record absence of the share store if
new. Use the established NEW-only ALL-idle gate, shared lock/drift checks, one
restart of codex-remote-secure.service, backend health before client SW/index
last, and postverify. Do not invoke the stock OLD-service restart blindly or
replay a completed release. Existing history-specific runner allowlists need
an explicitly reviewed new share scope, not an unmodified invocation.

Registry generations/grants become mutable application data. Do not roll back
their state after activation or restore a database that could resurrect grants,
discard a revocation, or reassign ownership. On ambiguous publication or mutation
inspect receipts/state read-only and use a forward fix; do not auto-replay.
Postverify health/module/client hashes/Hours/OLD and encrypted owner GET list
without creating a real share. Lifecycle tests belong to fake services. Update
the existing app Services entry only after actual publication.

## Evidence and limits

Backend controls use a real isolated HTTP gateway, encrypted fake owner
credentials, actual owned upstream HTTP/WS sockets and temp durable state.
They cover owner proof/CSRF/logout including a held probe, 24h ceiling,
multi-recipient/restart/revoke, corrupt/persistence failure, service generation,
port/path/capability bounds, cookie separation, cached304, slow headers/late
upgrade, live HTTP/WS expiry/revoke/retire and capacity recovery. Existing secure
API/private-preview/cache/session/Services/config tests remain in the focused run.

`scripts/preview-share-backend-browser.mjs` runs owned HTTPS with cross-site admin
and preview origins, no owner session, Chromium1280×800 and390×600. It verifies
fragment cleanup, cap only posted to admin, upstream filtering, successful
cookie/303/reload, invalid links, and a malicious root-scope app worker seeing
only the one-use handoff. No real Safari/iOS/WebKit device result is claimed.
The separate popup UI and integrated full suite remain root/CR4 integration work.
No production mutation, deployment, arm, service restart or model turn occurred.
