# Workboard and preview configuration readiness — 2026-09-22

Prepared and tested; **not installed or approved for activation by this report**.
This bounded implementation review covers Workboard `bc66e80` and the staged
Nginx configuration on runner base `dc9ee2062e1fd87d86b024f0e95076286b6e692d`.
It does not replace the leader's independent R6 review or protocol acceptance.
The task inherited Astra/max as assigned; no worker model/effort override was used.

The one required fix is the exact preview Host guard in
`affb655516c2a9816324c36c5a3684cc64e043a4`. Application code/build/dependencies,
cutover transitions, key handling and postverification remain unchanged:

| Pin | Revision |
| --- | --- |
| Accepted application bytes | `80843c0947c5e665a51a6207dbb871bf2c06a421` |
| Future source target, including independent controls | `00f9e197285e9c918372367f626c0b744d47d0d6` |
| Current live main and remote main | `783b1e3ae0efd683458c9fa0b3518b2e476b06a9` |
| Workboard candidate, unchanged | `bc66e80daf1d548900a8f532151d1bff932c1623` |
| Live TLS preparation evidence | `367b4740a15dbb67c7328ea97f997d1aff15ab10` |

Leader features `d07206a` are outside this payload. No broad application build or
full security audit was repeated. No actual model turn, pause, production key,
user Workboard mutation, production configuration change or service restart occurred.

## W1 — P2: an implicit default could exceed the seven-host allowlist

The installed TLS report observed preview as the implicit IPv6 default. The
accepted gateway rejects an arbitrary unrecognized Host with 400, but its preview
Host matcher accepts the configured `p{port}` pattern. A valid parent-session grant
for an unlisted port therefore returns 200 when that Host reaches the gateway.
With the user's wildcard DNS, an exact `server_name` declaration alone cannot
enforce the intended seven-host boundary when its server is the default.

The isolated fixture demonstrates both parts using the accepted gateway and real
SessionRegistry/encrypted maintenance adapter, a fake owner key, and an owned
unlisted upstream. Unguarded Nginx as the IPv6 default returns that upstream's
body with status 200. This requires an authorized parent grant; it is not an
unauthenticated admin API bypass.

`proxy-configs.mjs` now renders a map with seven exact strings and a default of
zero, followed by a server-level 421 guard in both preview HTTP and HTTPS blocks.
It rejects template drift rather than accepting a wildcard, missing host, or
already transformed input. No `hostnames`, regex entry, wildcard server name,
new default server or unrelated vhost policy is introduced. Exact string matching
follows the [Nginx map contract](https://nginx.org/en/docs/http/ngx_http_map_module.html).

The same valid unlisted grant and an arbitrary unknown Host now receive 421 for
HTTP requests and WebSocket upgrades through the fixture's IPv4 and IPv6 TLS
listeners. Rejected requests reaching the fake upstream: **zero**. The HTTP-port
block contains the same server-level guard; its structure and Nginx syntax are
tested, while the adversarial network probes use the TLS listeners. Allowed
Workboard login/save/logout, Vite HMR and revocation still pass.

This is fixed in staged artifacts only. The live site remains parked 503. Global
default-vhost behavior for other hosted sites remains outside this change.

## Workboard source and live preimage review

The candidate changes only ancestor parsing and response framing headers in
`server.py`: one exact HTTPS origin is allowed, malformed/path/list/wildcard
values fail startup, CSP retains `'self'`, and X-Frame-Options is omitted only
when the explicit ancestor is configured. The deployed value will be exactly
`https://codex.danhkhai.io.vn`. Another authorized preview cannot frame Workboard.
An absent ancestor retains the old SAMEORIGIN behavior.

The existing Origin equality check, cross-site rejection, session cookie and CSRF
checks are unchanged. The gateway validates the browser's preview origin before
rewriting it to the canonical upstream `http://127.0.0.1:5180`; this matches the
drop-in. A request using the admin origin directly against the preview API is
rejected with 403. Cookies remain Secure, HttpOnly, SameSite=Strict and scoped to
Workboard. Workboard responses remain `Cache-Control: no-store`.

Only these two Workboard files belong in the future rollout:

| Destination | Staged input / SHA256 |
| --- | --- |
| `/root/GITHUB/Workboard/server.py` | `workboard-server.py`: `4ef0bc4b12a9b2bff9b6149881e9c7becfa38f367dffbf23e3594cc6a0f18354` |
| `/etc/systemd/system/workboard.service.d/isolated-preview.conf` | `workboard-isolated.conf`: `fe160f4686024288272ec5ffc1b4ba9d2b86d6fc7799235f9020ec4666605395` |

The drop-in sets `WORKBOARD_ORIGIN=http://127.0.0.1:5180`, the exact HTTPS ancestor,
`WORKBOARD_SECURE_COOKIE=1` and `WORKBOARD_DATA=/root/GITHUB/Workboard/data`.
The live process currently uses the same data directory by default. Its working
directory is `/root/GITHUB/Workboard`; root identity, ProtectSystem=strict,
NoNewPrivileges=yes and the existing data-only ReadWritePaths remain unchanged.
Data directory realpath and inode were checked, not its contents. Live `.git`,
`.env`, and the proposed drop-in are absent; no repository was added.

The synthetic upgrade fixture initializes the old source with fake seed/data,
changes a fake task and version to 17, adds a session/backup, then initializes the
candidate using a different initial password and an intentionally invalid seed.
All account/state/session/backup/attempt rows and the original password survive;
the seed is not reimported, data location stays the same, and SQLite remains 0600.
The real database was neither opened nor copied. The future runner's consistent
private backup is separate from this fixture and must never be restored implicitly.

The four live public files match the candidate/fixture byte-for-byte; no public
asset, database or seed replacement is required. Bundle verification succeeded.
Do not apply the entire historical format-patch or create Git in the live folder.

## Nginx and TLS compatibility

All active and parked server blocks use exactly `p2345`, `p5180`, `p5210`, `p5211`,
`p5212`, `p5213`, `p5215.danhkhai.io.vn`. Active and parked configs reference the
installed `codex-preview-ports` certificate and its existing SSL include/dhparam.
Read-only certificate inspection reconfirmed exactly those seven SANs, expiry
2026-12-21T01:03:43Z and SHA256 fingerprint
`8B:86:2F:71:FE:97:F7:09:57:42:96:A4:85:1B:1D:AE:9D:0A:81:F0:AF:98:CF:8C:5F:CA:05:61:20:42:81:C6`.
Normal-trust public/origin chain and renewal evidence is reused from task a37aff40;
this task issued no certificate and ran no production Nginx command.

The real-IP snippet's 15 IPv4 and 7 IPv6 ranges match Cloudflare's published
[IPv4](https://www.cloudflare.com/ips-v4) and [IPv6](https://www.cloudflare.com/ips-v6)
lists at review. Only trusted peer addresses may supply the real-IP header under
the [Nginx real-IP contract](https://nginx.org/en/docs/http/ngx_http_realip_module.html).
The staged locations overwrite X-Real-IP, clear X-Forwarded-For/Forwarded/
CF-Connecting-IP, and set X-Forwarded-Proto from the TLS connection. Actual probes
from an untrusted loopback client confirm spoofed headers do not reach the upstream.

`/api/secure/request` has an exact 36m body limit and unbuffered request/response
proxying. An actual streamed **35,063,561-byte** body reaches the fixture upstream
intact; a declared body greater than 36 MiB is rejected with 413. Other locations
retain their existing 26m limit. The upload here is a byte-size/proxy check; prior
accepted application fixtures establish encrypted document framing.

Both `/workboard` and all `/workboard/...` bookmarks redirect to **`/services`**,
where the trusted app handles unlock and an encrypted ticket. They do not mint
plaintext `/preview/...` tickets. Maintenance closes all public admin paths with
503/no-store; the active-admin/parked-preview phase keeps preview closed. The three
staged combinations pass actual restricted Nginx startup and request checks.

## Focused evidence

The final sequential `codex-heavy` job passed with `VITEST_MAX_WORKERS=1`:

| Check | Result |
| --- | --- |
| Exact-host/config controls | 3/3 |
| Active/maintenance/cutover Nginx combinations | 3/3; 36m and spoof checks pass |
| Workboard unit checks | 10/10 |
| Synthetic old-to-new SQLite initialization | Existing rows/password/path preserved |
| Real gateway + Workboard + Nginx browser | Encrypted ticket, login/save, CSRF 403, stale version 409, reload/direct navigation, logout pass |
| Isolation and cache safety | Parent DOM inaccessible; other-preview ancestor denied; Secure cookie and no-store pass |
| Desktop/mobile Chromium viewports | 1280×900 and 390×600; no mobile horizontal overflow |
| Vite | HMR updates; four 304 responses; initial body 215,548 bytes, reload body 125 bytes |
| Parent-session logout | Active Vite WS closes; Workboard/Vite/replayed grants return 401 |
| Lint | 0 warnings/errors, 246 files |

The gateway fixture verifies all 46 accepted backend inventory hashes before use.
Its parent page is a small static harness served by the actual gateway; it is
**not a rerun of the full admin unlock UI**. Accepted app unlock/Plan/encryption
regressions are reused. Chromium viewport testing does not prove physical mobile
or Safari behavior. Byte savings are this fixture's response-body measurement,
not device latency or production performance.

Every Nginx fixture uses the existing restricted nonroot helper, five absolute
private temp paths, private pid/lock/logs and fake TLS. Host metadata and service
identity assertions run before/after. Host temp owners remain www-data. The only
root process actions are owned fixture service management; no host chown/reload
or `nginx -p`-only isolation is used.

Root-only evidence is in
`/root/.local/state/codex-remote/workboard-preview-readiness-20260922`:
`final-checks.log`, `browser/workboard-preview-result.json`, two fake-data
screenshots, `live-preimages.json`, `final-live-invariants.json`, and
`staged/inventory.json`. The delivery manifest binds the pushed revision and all
these evidence bytes. This directory is **not a release or activation receipt**.

Reproduce from this retained worktree with accepted compiled modules and matching
dependencies available through local symlinks (never install dependencies in live):

```sh
codex-heavy --label workboard-readiness -- env VITEST_MAX_WORKERS=1 \
  PLAYWRIGHT_MODULE=/tmp/working-hours-browser/node_modules/playwright/index.mjs \
  bash -c 'set -e
node --test scripts/secure-release/proxy-configs.node-test.mjs
node scripts/secure-release/nginx-stage-fixture.mjs /root/.local/state/codex-remote/workboard-preview-readiness-20260922/staged
python3 -B scripts/secure-release/workboard-upgrade-fixture.py
node scripts/secure-release/workboard-preview-fixture.mjs /root/.local/state/codex-remote/workboard-preview-readiness-20260922/staged NEW_OWNED_EVIDENCE_DIRECTORY
npm run lint'
```

The completed run used `dist-server` and `node_modules` symlinks to
`/root/WORKTREES/cr-secure-api-review-fixes`, then removed only those local symlinks.
No accepted checkout was edited. Tests should use a new evidence destination.

## Exact staged inventory

These are outputs of the same `renderProxyConfigs` used by the final builder;
historical shared inputs were read unchanged. Current installed parked bytes differ
from the historical parked template in its comment only; semantics match.

| Artifact | SHA256 |
| --- | --- |
| `admin-active.conf` | `7a45aaaabb5331be8e86b2fa749e11cce111355bf682cbd383cf3b9198310d5e` |
| `admin-cutover-gated.conf` | `fec1832afc78f780c27be056e2bceac83fa9c855630c058ee6b1096ad1f2151a` |
| `admin-maintenance.conf` | `095a5907405acc976763b806f148fc67cb1a8c6ad9e04eee4a65bbfa40b86ac1` |
| `preview-active.conf` | `c0651e07ee0d90c869872c377ae0c953e4e454f1cff055dbeb07e3b6a0d5076f` |
| `preview-parked.conf` | `c09b9e0d77a85f67315fdf1dadbfe92cf3e5aad337b7274e3166923288179f33` |
| `cloudflare-real-ip.conf` | `0abf967d02ba79488a8fba4db48df6adf2f874f944399a8f5ef2e603bf9dbccc` |
| `workboard-isolated.conf` | `fe160f4686024288272ec5ffc1b4ba9d2b86d6fc7799235f9020ec4666605395` |
| `workboard-server.py` | `4ef0bc4b12a9b2bff9b6149881e9c7becfa38f367dffbf23e3594cc6a0f18354` |
| `workboard-embedding.patch` | `13afbee2e95a867fc2906364a5dd225a99bb125ade0934ab723f0afd076cea9d` |
| `workboard-review.bundle` | `685d7d850565e366dd0806ccc7562670925d738cedb53cf83fb61f42113f6fb8` |
| `workboard-delivery.json` | `62e10d37d3d87aa446e210758f7d6ed0aae74e6f465eebb124af9591fde6297c` |

Current preimages were unchanged at 2026-09-22T02:43:57Z. Full inode/device/time,
owner/mode and symlink records are in the private evidence; secret files have
hashes/metadata only, never their values.

| Live object | Checked state |
| --- | --- |
| Workboard `server.py` | root:root 0600; `af0dbf18b31dc6a57586344d85cfa0b0394ea581b289a914130277bcd53c7e29` |
| Workboard unit | root:root 0600; `d963ee2d1d38eaa30ec75cbc387c3fbcde296e8db509536a3bf988c276256044`; no existing drop-ins |
| Workboard data directory | root:root 0700; inode 197708; same realpath |
| Admin vhost | root:root 0644; `be569d835d2897e075ebff8a22fe5fbd830c38bf27aa5234c161ada59d0fb366` |
| Installed parked preview vhost | root:root 0600; `ecfc70ebc5bb41612b21f1a805e939365cdce0dd27770c1372eb1b6d6eba1048` |
| Enabled preview link | `/etc/nginx/sites-enabled/codex-preview-ports` → `/etc/nginx/sites-available/codex-preview-ports`, unchanged |
| Owner key / proposed Workboard drop-in | Both absent |
| Live PIDs | Gateway 1758426; Workboard 611064; Nginx 284687; invocation IDs unchanged |
| Hours JS | `b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93` |
| Hours map | `6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8` |

## Final integration contract and remaining gates

1. Review this scoped fix and the separate R6 decision. Use the new branch on
   `dc9ee206`, or cherry-pick its two commits onto a separate final preparation
   checkout. Include **both** `build.mjs` and `proxy-configs.mjs`; the helper is a
   preparation dependency, not an application/backend module. Never merge the
   preparation branch into live main or import leader features into this payload.
2. Leave the historical infra directory and every old seal unchanged. The final
   builder reads those inputs, writes the three transformed configs into a new
   private release, imports unchanged Workboard server/drop-in, and seals the
   actual outputs. Compare its infra files with this staged inventory. There is
   no need to rebuild the unchanged app or copy all of `dist-server`.
3. Capture a **new** live baseline after actual remaining readiness is satisfied.
   Parked TLS intentionally changed the historical Nginx baseline. Reject further
   source/config/process drift; do not edit an old baseline to accommodate it.
4. The leader must record actual effective Cloudflare Full(strict), fresh-profile
   migration/operator readiness, R6 acceptance and the existing deployment
   authorization. Certificates alone do not prove CF mode. This task does not
   assert those gates complete or create an `approved` evidence record.
5. Regenerate and verify a fresh public canary just before final preflight using
   the TLS task's procedure. Its earlier canary was deleted. Bind this report,
   tests, inventory and preimages into the new Workboard/fixture evidence record
   only after exact final-release review; respect the runner's evidence lifetime.
6. Keep the R5/R6 cutover: old authenticated ALL-idle checks, guarded source phase,
   ingress gate, proven old process/cgroup/listener stop, init/bind once, required
   encrypted gateway start, read-only postverify and guarded ingress opening.
   Do not pre-create the production owner key. Keep Hours/module/map and all
   runtime state intact; no implicit database restore or plaintext recovery.

After those real gates, the leader's **preparation** commands are:

```sh
node scripts/secure-release/build.mjs NEW_PRIVATE_RELEASE \
  /tmp/cr-secure-api-review-fixes-candidate-manifest.json activation-candidate
codex-heavy --label final-staged-nginx -- env VITEST_MAX_WORKERS=1 \
  node scripts/secure-release/nginx-stage-fixture.mjs NEW_PRIVATE_RELEASE
```

Then compare infra hashes, complete the exact new release/seal/evidence review and
use the existing [runner procedure](secure-release-preparation.md). No final builder,
seal, arm or rollout command was executed for this task. TLS stays parked until
that later controlled activation. Services must only be updated after publication.
