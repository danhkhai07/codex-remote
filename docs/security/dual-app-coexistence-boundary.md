# Two live apps: practical key and state boundary

Assessment for task `b2fc83c6-33ec-4368-a0e1-4031c3323120`, 22 September 2026.
Exact source inspected: old `783b1e3ae0efd683458c9fa0b3518b2e476b06a9`,
accepted security `80843c0947c5e665a51a6207dbb871bf2c06a421` /
`00f9e197285e9c918372367f626c0b744d47d0d6`, and Leader review
`10f52e9410dd593e9182483701f043b43338ccf1` (this worktree's base).
Matching current native task receipt: **gpt-6-astra / max**. No delegation.

## Decision to unblock preparation

Keeping both URLs live on this host is feasible without requiring a new VM solely
because root/fullAccess is accepted. However, **an unchanged old gateway with
`fileRoots=["/"]` defeats the new file-backed owner key through its ordinary
authenticated Files API**. New origin, separate cookie, independent secret and
0600 permissions do not remove that direct HTTP path. The same exposure covers
a new runtime's `.env` and native login file. This is distinct from the accepted
ability of an explicitly authorized root agent to read host files.

The concrete path is: retain the old UI/service and its data; separately harden
its Files boundary before creating the new key; run the new instance with its
own native home, Vault and all mutable stores. A temporary ALL-idle restart of
the old backend for that small backport is different from retiring the old app.
Root must approve that backend change and schedule it; **none is authorized or
performed by this assessment**. Do not use the old cutover runner: it intentionally
stops the old service. Do not silently remove that runner's guard.

If old runtime must remain byte-identical right now, do not claim the requested
key defense on the same host. Root's concrete choice is **allow the narrowly
scoped legacy hardening at ALL-idle while keeping the old app available afterward,
or leave the new key/activation pending**. Deploying anyway adds a direct legacy
HTTP key-exposure exception; it is not already implied by accepting root risk.

## Minimal legacy hardening and what it does not claim

Old `server/config.ts:85-86`, `server/http-app.ts:195` and
`server/server-files.ts:88-112` admit any regular file under `/`. Current runtime
config confirms port5173, old public origin, roots `/`, workspace `/root`, no
preview-origin template. No real secret was requested from that API.

An existing compatible implementation is available for a focused backport:
`server/file-policy.ts:3-19`, `server/server-files.ts:44-67,106-135`,
`server/directory-listing.ts:7-45` at accepted808, plus config root validation.
Use explicit project/data roots; deny `.env`, `.local`, `.codex`, `.state`, SSH,
system paths, and lexical/canonical/descriptor escapes. Keep the native workspace
roots and fullAccess setting independent. Do not copy new `config.ts` wholesale:
it defaults production to encrypted API and would change old UI behavior.

The backport also needs the matching HTTP/PPTX file consumers: the accepted
`serveServerFile` is async and must be awaited; HTML/PPTX reads need the accepted
opened-descriptor helper instead of re-opening `file.path`. An isolated file-copy
of only three compiled modules is therefore **not** an installation recipe.
Retain old route/JSON shapes and UI; test normal files, hidden listing, symlink/
encoded/traversal canaries, HTML, PPTX, download and failure handling. No crypto UI
is necessary for this Files backport. This assessment produces no product patch.

Files hardening alone does not fix old preview or session behavior. Legacy
`localhost-preview.ts:136-138,219-225` still serves same-origin preview; old
`http-app.ts:219-222` delegates before ordinary app handling. The pre-crypto
foundation at1706f3b contains isolated previews/session revocation/migration/limiter
work that can be backported independently of encrypted UI. Do not claim that
broader old-app defense is delivered by the Files patch. Existing legacy scripts
or root jobs cannot be retroactively trusted by a new-origin deployment.

Both issuers cannot simply share the same `p{port}` hosts with different secrets:
preview tickets are in-process and signed cookies belong to their issuing gateway.
Either keep old preview behavior explicitly legacy, or give its hardened preview
an independently reviewed routing/issuer boundary. Do not point old tickets at
the new gateway or share session secrets to make them work. `/workboard/` is also
an old-origin surface. No legacy route should be proxied into new private APIs.

## State ownership: supported knobs, not a live state clone

| Store | New-instance boundary |
| --- | --- |
| Native Codex | Dedicated `CODEX_HOME`; separately provision native login privately. `codex-app-server.ts:65-71` inherits this variable while stripping only `CODEX_REMOTE_*`; Docker config also explicitly uses it. Keep native history/jobs separate. |
| Vault/groups/tasks/socket/mailboxes | Dedicated `CODEX_REMOTE_CONTEXT_VAULT`, a real directory, not a symlink to the old Vault. |
| Session registry/key | Independent password/session secret, `CODEX_REMOTE_SESSION_STATE`, `CODEX_REMOTE_SECURE_KEY_FILE`; key outside both apps' exposed roots. |
| Read receipts/services | Explicit separate `CODEX_REMOTE_READ_STATE_FILE` and `CODEX_REMOTE_SERVICES_FILE`; defaults collide under the same OS home. |
| Push | Explicit separate `CODEX_REMOTE_PUSH_STATE`; never share subscriptions/signing state across origins. |
| Attachments | Existing `AttachmentStore` creates an independent private temp directory per process (`attachments.ts:37-40`). |
| Hours/presence | Do not set both instances to the same writable `CODEX_REMOTE_WORK_HOURS_FILE` / `CODEX_REMOTE_WORK_PRESENCE_FILE` without another reviewed ownership mechanism. Keep old Hours authoritative; new Hours is not automatically synchronized. |

Separate app install paths alone do not separate these defaults. In particular,
`index.ts:28-38` starts Vault observation, and `controller.ts:136-140` starts the
orchestration socket. Same-Vault startup is **already refused** by
`orchestration-socket.ts:8-20` when the old socket is alive. Removing that refusal
would expose the cached whole-state writer in `orchestration.ts:93-124`, shared
mailboxes and non-transactional cross-process revision check in
`knowledge-store.ts:119-130`. These are single-owner stores, not a shared database.
`read-state.ts:12-35`, Services and Push cache state and can overwrite each other.
Hours `work-hours.ts:57-69` has atomic rename/revision checking, but no cross-process
lock around read/check/write; the generator lock does not make two API writers safe.

Simplest supported launch uses **fresh independent state**. Old conversations,
tasks and authoritative notes remain accessible through the old app. This does
not provide synchronized history or the user's shared Vault across both apps;
root must describe that functional tradeoff, not silently assume it is wanted.
Independent fullAccess jobs must continue using task worktrees to avoid shared
project-file conflicts. Account/provider limits remain shared.

No general native-home/Vault live-clone operation was found in this app.
`scripts/import-context-vault.mjs:204-223` and `docs/context-vault.md:40-57` provide
read-only thread export into a chosen Vault, not native history/task migration or
a consistent multi-store backup. Do not `cp -r` live native SQLite/WAL, sessions,
Vault `.state`, sockets or pending jobs into an active second writer. A later
history migration needs a supported native backup/export plus coordinated
consistent capture and explicit ownership handoff; per-file copies are not that.

## Evidence and activation prerequisites

`scripts/dual-app-boundary-review.mjs` ran through codex-heavy, sequentially:
**8 controls passed**, using owned temporary canaries/Unix sockets only. It shows
0600 canary acceptance by the old `/` policy; denial with explicit roots; accepted
policy denial of broad roots/private names/symlink escape; preserved ordinary
Files shape; deterministic shared-read-state lost update versus separate stores;
same-socket refusal without stopping the first server; and separate socket success.
No native process/model turn, production key, user task or database was used.
These controls do not certify a not-yet-written legacy backport or a native clone.

Before activation, root/CR3 need: approved/tested legacy Files backport and its
ALL-idle publication (or explicit alternative exposure decision); exact new-origin
TLS/Host/Origin/cookie and preview issuer configuration; independent store paths
and native account readiness; honest history/Vault/Hours availability; fresh
artifact/config baselines and absent-key proof. Provision the new key only after
the direct old Files exposure is removed, then verify new encrypted access with
isolated canaries. Full(strict) and private SSH retrieval readiness are user
confirmed; no extra generic deployment permission is needed. Source defaults for
`restart-when-idle.mjs` still target `codex-remote.service` and the old marker, so
they must not be accidentally used to restart the new service.

This is a bounded practical assessment, not a new broad security audit. Old main
783b1e3/PID1758426 and Hours JSb763a0f7/map6a76da38 were preserved. No source/runtime
deployment, configuration, key, live canary or Services changes occurred.
