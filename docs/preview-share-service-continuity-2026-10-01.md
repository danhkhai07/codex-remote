# Registered preview origins and stable share links — review candidate

Task65778437. Base live product `5378c9330a2711c0e52a86ee6b44698b93fda38a` (expiry editing); NEW runtime is a publication, and its `server/` sources are older than deployed `dist-server`. Do not choose source from that directory. Actual task receipt: `gpt-6-astra`, `xhigh`, fullAccess true. No delegation/model turn/production share write.

## Root cause and behavior

The live environment, exact Nginx host map and certificate SANs cover seven ports only: 2345, 5180, 5210–5213 and5215. `PreviewShares` correctly intersects that operator-provisioned set with current Services registrations; removing the set or accepting every numeric port would expose unintended loopback apps. Services now also registers5217/5221/5222. All three DNS names resolve through Cloudflare and upstream HEAD with gateway-equivalent Host/X-Forwarded-Host returns200. The seven-host certificate does not cover the new hosts. They need the staged ACME/TLS/ingress activation, not a weakened gateway check. The browser fixture uses an actual ephemeral port outside the seven over owned HTTPS, proving the mechanism isn't intrinsically limited to seven.

Separately, live Services upsert rotates UUID whenever any metadata field changes. That is why a name/summary/PR/branch update invalidates public grants. The fix preserves the existing persisted UUID for updates to the same registration. Content changed behind the port doesn't rotate it. URL/token, expiry, navigation path and service name **inside an existing signed grant** are deliberately not rewritten.

Ownership/continuity contract:

- Omitted directory/kind retain the current ownership fields. Name/summary/PR/branch/start-path updates keep UUID.
- An explicit different directory or kind defaults to replacement (fresh UUID). A different port is a separate registration; remove the old registration when moving its listener.
- `register --replace` explicitly replaces an otherwise indistinguishable app at the same port; old HTTP/WS access is denied immediately. Remove/re-register always gets a fresh UUID, even with identical fields/timestamp.
- Services GET/PUT now expose nonsecret `registrationId`. To move the **same app** between worktrees, read its current ID and supply `register --expected-identity ID --directory NEW`. This asserts owner-approved continuity and compares against the exact current generation. A stale request after replacement/removal fails409, without altering the newer registration. It is not permission to falsely label a different app as the same app.
- Without an explicit replacement/removal or ownership change, no gateway can distinguish a listener silently replaced by a different program using identical metadata. The registry is the cooperative ownership authority, not a process identity oracle. Native/root permissions are unchanged.

No data conversion is required for current version1 registry/grants. Existing UUID bytes survive constructor/restart; the preexisting migration only generates new UUIDs for legacy entries lacking one. Grant records are never remapped. A read-only counts-only sample found9expired/3revoked/3identity-mismatched grants and0current grants; already invalidated links are **not** resurrected. An owner needs a new link for those once infrastructure is ready. The patch preserves future valid links across updates/restarts, max24h, editing within creation ceiling, early revocation and existing auth checks.

## Exact candidate scope

Runtime payload: **services.js + services.js.map**, plus maintenance **scripts/services.mjs**. No frontend change; browser test reuses the actual live client graph. Configuration change only `CODEX_REMOTE_PREVIEW_SHARE_PORTS` to `2345,5180,5210,5211,5212,5213,5215,5217,5221,5222`. No config defaults enabling arbitrary ports. Existing shared/private cookie handling, service-identity checks, HTTPS origins, gateway/owner API exclusions and signing logic remain unchanged.

`share-origin-plan.mjs` is a preparation-only helper for future registered ports as well: explicit inputs, exact existing Nginx shape, registered durable ports, no wildcard/gateway ports. It emits ACME-only bootstrap, ten-host active Nginx, a nonsecret env patch and exact certbot arguments. It never provisions DNS/TLS or installs configuration. Inventory and staged bytes are under `/root/.local/state/codex-remote-secure/reviews/share-service-continuity-65778437/infra`.

## Activation plan — root review required, not armed

1. Review staged source, hashes and backend/CLI allowlist. Acquire the shared NEW `deployment.lock` directory protocol (not an unrelated flock); back up exact Nginx preimage with target/mode/owner and abort if preimage differs. Keep the existing seven vhosts/certificate and all other sites unchanged.
2. Install only `nginx-bootstrap.conf` over the reviewed preview vhost; `nginx -t` then reload (no gateway restart). The three extra HTTP hosts serve only `/.well-known/acme-challenge/`; HTTPS rejects handshake, other paths503. Verify a newly owned ACME canary for each exact host, remove only those owned canaries, and record DNS/public evidence. Do not fabricate Cloudflare policy inspection: Full(strict) was previously user-confirmed, not API-audited.
3. Run the exact certbot argument vector in `infra/plan.json`. New lineage `codex-preview-ports-v2` covers all ten explicit SANs; preserve old lineage/renewal and obtain renewal+nginx-test/reload hook. Validate all SANs, validity, chain, private key permissions and renewal configuration. No wildcard DNS or zone-wide Cloudflare change. If issuance fails, keep new hosts parked and old seven operational.
4. Install exact staged `nginx-active.conf` only after cert verification. Syntax-check/reload, verify all ten hosts present a trusted certificate publicly and locally. Anonymous preview must reach gateway auth denial, never the upstream app. Unknown hosts must fail closed. Stage/verify one exact new-port private preview launch via owner proof before enabling sharing for it; do not create real public shares for smoke.
5. Capture a **fresh** activation baseline after infrastructure, not reuse this preparation snapshot. `share-continuity-stage.mjs NEW_OUTPUT INFRA_DIR` produces review-only payload/manifest/preimage hashes and frozen maintenance/readiness closure; it has no apply/restart option and its review seal is not activation readiness. Freeze the accepted NEW env/config/client import closure before publication. Bind source,2backend+CLI payload, dependencies, existing frontend, Hours JS/map/templates/generator, key identity, one-field env preimage, Services/grant snapshot, Nginx/cert and NEW/OLD process lifetimes. Back up current registry/grants at activation for evidence only; never restore them after startup.
6. Root activation adapter uses the frozen `core.mjs:workflow` plus `readiness.mjs:allReadiness/metadataReadiness`. ALL NEW threads idle, zero pending/queued/results/native-uncertain, two full checks5seconds apart plus immediate pre-copy and pre-restart checks; **no own/leader exemption**. The service target is ONLY `codex-remote-secure.service`, loopback5174. Do not use stock restart script's OLD default. Publish only the2backend files/CLI and one env value under the lock, with drift guards and atomic writes. Preserve file permissions. Exactly one ordinary NEW restart, no stop/disable of OLD beyond its existing disabled state. No full dist-server copy, frontend publication, key rotation or history/state edits.
7. Verify new PID, payload hashes, complete preserved frontend, public/loopback health, Hours/key/OLD invariants, encrypted read-only Services/share listing and current private-preview boundary. No mutation of real share, hours or native turns. Record LIVE only after evidence; then update Services root metadata and checked Vault. During this candidate task none of those live changes occur.

After a pre-copy failure, diagnose drift and prepare a new baseline. After publication/restart, **verify-only/forward-fix**, never replay apply or restore Services/grants/key/data from backup. Rolling back old Services code would reintroduce metadata invalidation; it is not a way to recover old links. Infra-only failure can restore the previous vhost/config bytes if unchanged and appropriate, preserving the new certificate for diagnosis and leaving old seven hosts live.

## Checks and limits

Targeted registry/share encrypted HTTP/WS/race/expiry tests, planner controls, server build/typecheck/lint, encrypted desktop1280/mobile390/320 browser and non-root filesystem-restricted Nginx with five private temp paths. Nginx fixture substitutes owned ports/self-signed fixture TLS/includes; it tests exact host routing/auth boundary, not actual public certificate readiness. Actual TLS issuance and final activation remain gates for root, not claimed complete. Detailed logs/results/manifest in the delivery evidence; no claim of physical iOS testing or absolute detection of unregistered listener replacement.

Browser fixture note: the first run reached metadata/replace checks, then its following short-expiry control reused an invalid `/preview/share` document with a new fragment. Playwright treated that as same-document navigation, so the bootstrap script did not rerun. The independent controls now reset that fixture page before opening a new capability; the browser-only TTL is6s to tolerate the one-CPU test queue, while server expiry tests still cover exact boundaries/1s. This is fixture isolation, not a claim to fix arbitrary browser hash-only navigation in the public bootstrap.

Preparation commands (placeholders must be fresh output paths; never replay older releases):

```sh
node scripts/share-origin-plan.mjs \
  /root/.local/state/codex-remote-secure/services.json \
  /etc/nginx/sites-enabled/codex-preview-ports \
  2345,5180,5210,5211,5212,5213,5215 5217,5221,5222 NEW_INFRA_DIR
codex-heavy --label share-continuity-package --memory-mib 1024 --reserve-mib 1536 -- \
  node scripts/share-continuity-stage.mjs NEW_PACKAGE_DIR NEW_INFRA_DIR
node scripts/share-continuity-readiness.mjs NEW_PACKAGE_DIR
```

The last command validates the frozen closure and reports counts only using the NEW maintenance environment. It is an observation, not a claim of eventual idle or authority to arm. The final root-reviewed activation adapter/seal must bind the post-TLS baseline to the preserved workflow before any apply command exists; this candidate intentionally has no deploy/arm command that could use missing TLS evidence. The pure `patchSharePorts` helper edits exactly one existing config value, rejects duplicate/drifted assignments and preserves unrelated values/bytes. No secret environment values are stored in the review manifest or printed by these commands.
