# App security patch: threat model and rollout gates

Status: implementation authorized; candidate only until reviewed, no production changes.

## Trust boundaries

- A preview server and its HTML, JS, redirects, cookies and WebSocket messages are untrusted, even on localhost. It must never execute with the administrative origin, obtain administrative cookies, or invoke control APIs with the user's authority.
- A browser session is authority to use the existing agent workflow, including explicitly enabled full access. This patch does not silently revoke prior full-access authorization or claim to sandbox a root agent.
- File API inputs are untrusted paths; canonical path and deny rules must both pass before reading. A workspace allowlist is not an OS security boundary against an agent that already runs as root.
- Forwarded client addresses are untrusted except from configured exact proxy peers. Nginx must overwrite the chosen header, and only configured Cloudflare source networks may supply CF-Connecting-IP.
- Signed sessions are bearer credentials; logout must invalidate them server-side across restart and close streaming connections. Signing-key rotation invalidates old signatures; password rotation must invalidate prior browser sessions too. Stored revocation identifiers are hashes, never cookies/secrets.

## Decisions before implementation

1. Remove the unsafe same-origin preview proxy. Require an isolated per-port origin template; keep `/preview/<port>` as authenticated launch/redirect only. Without configured isolation, fail closed with a clear configuration error. Existing origin-template ticket flow remains the basis, with revocation-bound preview grants, expiry-bound HTTP/WS and stripped reserved/control headers. Administrative HTTPS cookie uses `__Host-` and old browser cookies require login again. Dedicated origin enables ordinary preview fetch/assets/storage/WS without weakening the control plane.
2. Prepare Nginx/DNS/TLS configuration; `/workboard/` must redirect into the isolated preview, not bypass Node by proxying code on the administrative origin. No production config edit or DNS/API mutation in this task. DNS/TLS availability is a release gate, not a reason to leave file/session patches unfinished.
3. Restrict file roots to explicit workspace/data directories (reject `/` and filesystem/system roots). Deny secret/auth/SSH/system paths and aliases on both lexical and canonical paths, for listing, metadata, content and render routes. Test canaries only. Protect the open/read boundary against symlink replacement, and document residual hard-link/root-agent limits.
4. Persist revoked session identifiers atomically, keyed to configured credential generation; reject expired/revoked sessions and terminate SSE/WS on expiry/logout. Keep loopback maintenance clients working via the same cookie-name helper. Fail closed on corrupted revocation storage. Rotate neither credentials nor running services during implementation.
5. Exact configured trusted proxy addresses + a single normalized real-IP header; never use arbitrary X-Forwarded-For. Prepare Cloudflare source ranges and Nginx real-IP chain, with spoofing and separate-client tests.

## Verification and limitations

Reproduce original proof against this base in a fake gateway/native stub with nonsecret file canaries. Repeat after patch in iframe and standalone preview, including cross-origin fetch/parent access, forged control headers/cookies, redirects, SW, assets/WS and logout/replay/expiry. Run tests sequentially through codex-heavy. Functional Plan/reconnect/chat tests use only fake native protocol. Do not initiate real model turns.

Gateway and agent still run root; splitting OS identities/executor is a separate migration. Path filtering protects file API routes, not arbitrary root commands authorized in a full-access turn. DNS/TLS and Nginx integration must be verified before claiming preview isolation live; `/workboard/` must be included. No automatic deployment, reboot or SSH/firewall changes.

Sources: prior audit `References/Codex-Remote-Security-Review-2026-09-20.md`; https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox ; https://developers.cloudflare.com/support/troubleshooting/restoring-visitor-ips/restoring-original-visitor-ips/ .
