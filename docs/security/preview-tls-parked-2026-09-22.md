# Preview TLS infrastructure — parked, 2026-09-22

Task `a37aff40-9aa2-4265-af11-26b72c6d1ef3`, worker conversation
`01a0c024-a380-7312-a73c-a4949cd6d89b`. Existing user deployment authorization
covered this scoped operation. No application deployment or owner-key provisioning
occurred. This document is an observation, **not an approved infrastructure receipt**.

## Published infrastructure

At 09:02–09:04 +07, Certbot 2.9.0 issued the new `codex-preview-ports` lineage,
the existing preview bootstrap was replaced with parked HTTPS, and Nginx reloaded.
Only these seven names are in both `server_name` and the origin certificate SAN:

`p2345`, `p5180`, `p5210`, `p5211`, `p5212`, `p5213`, `p5215`, all under
`danhkhai.io.vn`.

The user-created proxied wildcard DNS makes these names resolve; it does not
authorize other ports or a wildcard Nginx vhost. HTTP still serves only the ACME
webroot and otherwise redirects to HTTPS. HTTPS returns503 with
`Cache-Control: no-store`; no `proxy_pass`, application HTML, or Set-Cookie.

Origin certificate: Let's Encrypt YE1, ECDSA, valid
`2026-09-22 01:03:44 UTC` through `2026-12-21 01:03:43 UTC`.
SHA256 certificate fingerprint:
`8B:86:2F:71:FE:97:F7:09:57:42:96:A4:85:1B:1D:AE:9D:0A:81:F0:AF:98:CF:8C:5F:CA:05:61:20:42:81:C6`.

The observed Cloudflare edge certificate is Google Trust Services WE1, covering
`danhkhai.io.vn` and `*.danhkhai.io.vn`, expiring `2026-11-14 06:25:46 UTC`.
Observed edge fingerprint on all seven probes:
`88:D5:3A:10:99:E6:8A:9C:08:09:77:3A:88:AF:5C:FE:55:C2:DF:FC:DF:7A:E6:9A:9A:1D:75:54:63:D1:48:8E`.
These are observations; re-read fingerprints when binding a fresh release receipt.

## Evidence and guards

Private evidence/backup directory (0700):
`/root/.local/state/codex-remote/preview-tls-20260922T020000Z`.
`manifest.json` SHA256:
`ff18ac3895f084d2d7805f9f6f724b61146e9c8286059da598b1aaace177a161`.
It references exact commands, before/after inventories, public response bodies,
certificate chains, canary deletion, and per-step logs. Secret files were hashed,
not copied into this report/Git/Vault. The backup contains only the old site config.

The operator held `/root/.local/state/codex-remote/deployment.lock`, using the
reviewed cooperative lock implementation. It guarded original destination bytes,
metadata, parent identities and enabled-symlink target before replacement, and
rechecked its own installed version before syntax test/reload. This is not a CAS
against a malicious root writer. The lock was released and the operator exited.

- Recursive DNS through1.1.1.1 and8.8.8.8, and both Cloudflare authoritative
  servers over TCP: all seven A/AAAA names returned Cloudflare addresses, including
  IPv4 `104.21.79.246`/`172.67.150.82`. Those are edge IPs, not originIP. UDP to
  authoritative servers timed out; TCP succeeded. No restrictive CAA at the names
  or zone; recursive parent CAA also had no records. A query for `io.vn` to the
  Cloudflare zone authority returned REFUSED because that server is not its authority.
- Before issuance, all seven public HTTP canaries returned200, exactly93 bytes,
  SHA256 `0585c01795d6fdd407e890dd738e6127511abf5bccce8725c630d064c98c6b24`,
  without Set-Cookie. No redirects were followed.
- Both `/` and `/api/session`, direct origin using `curl --resolve` and public
  Cloudflare, returned503/no-store/no-cookie on all seven hosts:28 assertions.
  Each body was the same206-byte Nginx error page, SHA256
  `b2fee87d3242e522e235c35a0ee89829d043fdf65fda92f7f07d70daed1e2adc`.
- Fourteen origin/edge certificate chains passed normal trust and hostname
  verification. No `-k`/disabled certificate checking. HTTP/TLS checks repeated
  successfully after renewal dry-run reloaded Nginx.
- `certbot renew --cert-name codex-preview-ports --dry-run --run-deploy-hooks
  --no-directory-hooks --no-random-sleep-on-renew --non-interactive` succeeded.
  Actual command also uses the evidence directory's `certbot-work`/`certbot-logs`.
  The hook is exactly `/usr/sbin/nginx -t && /usr/bin/systemctl reload nginx`.
  Certbot labels hook stderr as “error output”; it contained successful nginx
  syntax messages. Both command exit codes were0.
- Production issuance explicitly selected the existing registered ACME account;
  no email or consent was supplied/invented. For the authorized staging dry-run,
  Certbot automatically created its staging account using built-in dry-run
  behavior when a production account exists. No interactive account prompt occurred.
  This staging account is a new Certbot-managed path, recorded in inventory.
- The random nonsecret canary was removed. All seven public hosts subsequently
  returned404 for it. It **cannot be reused as a live rollout canary receipt**.

DNS/HTTPS/certificate scans ran sequentially through `codex-heavy`; no application
build or app tests were necessary for this configuration-only change. Production
`nginx -t` used the actual configuration. No root `nginx -p` fixture was run.

## Exact changes and retained state

Only one existing file changed among914 inventoried entries;913 remained exact.

| Path | Result |
| --- | --- |
| `/etc/nginx/sites-available/codex-preview-ports` | root:root0600,1017bytes; SHA256 `ecfc70ebc5bb41612b21f1a805e939365cdce0dd27770c1372eb1b6d6eba1048` |
| `/etc/nginx/sites-enabled/codex-preview-ports` | Original symlink/metadata unchanged |
| `/etc/letsencrypt/renewal/codex-preview-ports.conf` | New root:root0600; SHA256 `3f2dd9b23ff72eb82db8ed917abb03e20677b0a8a6dcffa249434119aa043b3f` |
| `/etc/letsencrypt/live/codex-preview-ports/` | New named lineage symlinks/README |
| `/etc/letsencrypt/archive/codex-preview-ports/` | New cert1/chain1/fullchain1/privkey1; private key stays in Certbot's private path |
| `/etc/letsencrypt/accounts/acme-staging-v02.api.letsencrypt.org/` | New automatic dry-run staging account; only hashes/metadata in evidence |

`inventory-delta.json` gives every added path, target and hash. Keep the task
directory: the named renewal file intentionally retains its `certbot-work` and
`certbot-logs` paths. Those two operational subdirectories may change on renewal;
the captured issuance/dry-run logs and manifest are separate. Existing account,
other certificate lineages/renewal files, TLS options, vhosts, timer, firewall,
DNS/Cloudflare settings and Workboard files were not changed. No global renewal
was attempted; unrelated existing renewal failures are not fixed by this result.

Main and remote main remain `783b1e3ae0efd683458c9fa0b3518b2e476b06a9`.
Gateway PID1758426 and Workboard PID611064 have the same invocation/start identity;
Nginx master PID284687 is unchanged (workers reloaded). Local/public
`/api/healthz` return `{"status":"ok","codex":"ready"}`.
Owner key `/root/.local/state/codex-remote/secure-owner/owner-key.json` is absent.
Hours JS stays `b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93`,
map `6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8`.
All five `/var/lib/nginx/{body,proxy,fastcgi,uwsgi,scgi}` owners remain
www-data:root0700 with unchanged inodes. All11 existing seal files are unchanged.
Final read-only verification at09:11:55 +07 matched all932 current inventory
entries,11 seals,26 evidence hashes and service/source identities; see
`final-invariants.json`.
No Services publication, gateway/Workboard restart, owner-key creation, application
source/client/dependency mutation, native turn, pause or user-session mutation.

## Unlisted-host and Cloudflare limits

`p59999.danhkhai.io.vn` was tested without credentials. Public HTTP returned301;
public HTTPS `/api/session` returned a153-byte404, no Set-Cookie. Direct origin
TLS correctly failed hostname verification for this unlisted name. With trusted
allowlisted SNI but an unlisted HTTP Host, IPv4 returned404 and loopback IPv6
returned the parked503. No admin/API content was returned in these probes.

This is **not proof of an explicit global unknown-host deny policy**. The existing
IPv4 default is the unrelated cns/portfolio vhost; the preview block is the implicit
IPv6 default. A separate reviewed default-reject policy, or an exact-host guard
within the final active preview block, would make rejection explicit. Do not edit
the other vhosts or widen this task based on these observations. Final active
preview routing must preserve the gateway's independent Host/port authorization.

Successful edge/origin certificate verification does **not** attest the configured
Cloudflare SSL mode. `network-observation.json` deliberately has `tlsMode:null`,
`notAnApprovalReceipt:true`. No Cloudflare API is configured here. Leader must
record the actual effective Full(strict) configuration for these hosts. An already
effective zone setting is sufficient; a new rule is not inherently required.
See [Cloudflare Full(strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/).

## Final receipt and baseline handoff

Application acceptance remains80843c0; future source00f9e197. Runner8b395de/seal4e3199
is under independent review. This intentional live Nginx change makes its old
baseline stale. **Never edit or arm an old seal. No final builder ran in this task.**

Leader still needs exact runner review approval, actual Full(strict) evidence,
genuine fresh-profile migration readiness, Workboard staged readiness and a NEW
final release/seal under the existing user authorization. Owner key remains absent
until the reviewed cutover mechanism proves the old gateway stopped.

Revalidation commands (same seven hosts, no credential access; NEW evidence only):

```sh
umask 077
preview_probe_dir=$(mktemp -d /root/.local/state/codex-remote/preview-probes-XXXXXX)
python3 - "$preview_probe_dir" <<'PY'
import pathlib, sys
old = '/root/.local/state/codex-remote/preview-tls-20260922T020000Z'
new = pathlib.Path(sys.argv[1])
source = (pathlib.Path(old) / 'probes.py').read_text()
(new / 'probes.py').write_text(source.replace(old, str(new)))
PY
codex-heavy --label preview-parked-recheck -- python3 "$preview_probe_dir/probes.py" parked
codex-heavy --label preview-cert-recheck -- python3 "$preview_probe_dir/probes.py" certificates
sha256sum /etc/nginx/sites-available/codex-preview-ports /etc/letsencrypt/renewal/codex-preview-ports.conf
readlink -f /etc/nginx/sites-enabled/codex-preview-ports
stat -c '%n %U:%G %a %i' /var/lib/nginx/{body,proxy,fastcgi,uwsgi,scgi}
systemctl show codex-remote workboard nginx -p MainPID -p InvocationID -p ActiveState
```

The two probe commands write timestamped local observations in that new directory,
preserving evidence referenced by this manifest. Run checks through `codex-heavy`
sequentially. Do not rerun `operator.mjs`: it is the retained one-time operation
record, not a resumable/general deployment runner.

For a final live canary, acquire the shared deployment lock and guard current site
and symlink preimages first. Use a NEW nonsecret token and body, for example:

```sh
umask 077
preview_receipt_dir=$(mktemp -d /root/.local/state/codex-remote/preview-readiness-XXXXXX)
preview_canary_token="codex-final-$(openssl rand -hex 16)"
printf 'Codex Remote public deployment probe: %s\n' "$preview_canary_token" > "$preview_receipt_dir/body"
install -m 644 "$preview_receipt_dir/body" "/var/lib/codex-preview-acme/.well-known/acme-challenge/$preview_canary_token"
for preview_port in 2345 5180 5210 5211 5212 5213 5215; do
  curl --noproxy '*' --fail --silent --show-error --max-time 15 \
    "http://p${preview_port}.danhkhai.io.vn/.well-known/acme-challenge/$preview_canary_token" \
    -o "$preview_receipt_dir/p${preview_port}.body" || exit 1
  cmp "$preview_receipt_dir/body" "$preview_receipt_dir/p${preview_port}.body" || exit 1
done
sha256sum "$preview_receipt_dir/body"
```

Keep that canary available through runner preflight/final-precopy checks, then
remove only the owned token after completion/abort. Hash the new evidence files
and bind them to the NEW seal. The matching runner requires ordered `hosts`,
actual `tlsMode`, `canaryPath`/`canaryDigest`, origin/public fingerprints and
`renewalDryRun`, plus its usual exact-app/seal/age/file bindings. Do not turn this
partial observation into `result:approved` while real gates remain missing.

After all gates and the reviewed runner revision are known, the leader can use
that revision's `scripts/secure-release/build.mjs` with the verified
`/tmp/cr-secure-api-review-fixes-candidate-manifest.json` and a new root-private
release directory, then seal/check it using the matching scripts. Capture fresh
site/certificate/symlink/renewal/inode baselines; retain the exact accepted app
payload/dependencies and new Hours module. Neither main nor preparation branches
are merged by this infrastructure task.

Preparation commands, only from the independently approved runner checkout and
after real infrastructure readiness (not executed in this task):

```sh
: "${preview_new_release:?Choose a NEW root-private release path after readiness approval}"
codex-heavy --label secure-final-baseline -- node scripts/secure-release/build.mjs \
  "$preview_new_release" /tmp/cr-secure-api-review-fixes-candidate-manifest.json activation-candidate
# Stage the matching verified dependencies and evidence; verify payload hashes,
# source maps/import graph, and merged Nginx/Workboard configurations before seal.
codex-heavy --label secure-final-seal -- node scripts/secure-release/seal.mjs "$preview_new_release"
codex-heavy --label secure-final-preflight -- node "$preview_new_release/runner/runner.mjs" --check
```

`preview_new_release` must name a nonexistent child of the root-private releases
directory. A successful seal creation is not readiness approval; missing/expired
bound evidence must still make `--check` return preparationblocked. These commands
do not arm/restart the gateway. Follow the approved runner's dependency staging
steps rather than skipping the commented prerequisite.

Certbot references: [webroot and renewal](https://eff-certbot.readthedocs.io/en/stable/using.html).
Installed2.9.0 help/source were also inspected; staging account behavior is in
`certbot/_internal/cli/cli_utils.py:set_test_server_options`.
