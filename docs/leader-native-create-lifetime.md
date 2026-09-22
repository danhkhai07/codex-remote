# Native conversation creation lifetime fix

Implementation task `6505858f-f109-4f5d-9a25-9f51b10c2639`, not independent approval
or activation. Dedicated worktree `/root/WORKTREES/cr-leader-native-create-lifetime`,
branch `fix/leader-native-create-lifetime`, exact pushed review base
`14cc1893c84a77a1de397c4371f9c1ad65d6e1ba`. Earlier author/review trees remain intact.
The historical CR3 report/decision are unchanged; see
`leader-lifecycle-retention-independent-review-82b4367.md`.

This is a new recovery assignment, not replay of task6beabd71. The leader verified
that prior failed admission had no native turn or partial implementation. Its failed
receipt remains historical; no production task status is changed and no user Stop
is inferred. The possible old-runtime queued/read race is not proven as its cause.
The candidate's existing `creating` reservation and acceptance controls are retained.

Actual read-only task receipt: **gpt-6-astra/max**, current native turn
`01a0c81c-82fc-72e1-891d-3edb316b7c69` matches. Metadata-only evidence:
`/tmp/cr-native-create-settings.json`.

## Change and asynchronous boundaries

The captured admission callback now passes through `OrchestrationDriver.create`
and the controller adapter into the existing optional `createThread` callback.
`CodexAppServer.request` already checks it immediately before the synchronous
native pipe write after startup/reconnect; that transport implementation is unchanged.
`createThread` checks the same callback after the reply, before `#markResumed`
(context export, metadata cache and resumed cache) or folder assignment.

The creation path has one native request await. Workspace/folder validation before
it and cache/export/assignment afterward are synchronous. The adapter's await only
unwraps the response. The outer orchestrator still checks its captured lifetime
after that await before recording the thread ID, then rechecks admission through
the existing guarded rename and final transition to queued. Catalog admission,
request-ID reservations, supported model/effort, access/role/epoch/Plan checks and
the durable `creating` state are not changed. Unguarded direct creation callers
still work, and an existing HTTP authorization callback remains effective.

If native creation was already accepted, this fix does not roll it back, archive
it, replay it or restore an old task snapshot. A stale command rejects without
locally adopting that reply. Native evidence and a newer folder assignment remain
intact; automated reconciliation/adoption of such created conversations is outside
this fix. A killed process cannot execute a late callback: these tests establish
the explicit class-lifetime contract, not a production overlap incident.

## Evidence

CR3's two inverse probes are now acceptance tests using the actual controller,
orchestrator, request implementation and stdio pipe to an owned fake subprocess.
Both run for same-object restart and a replacement controller/orchestrator:

- A held real request startup continuation released after stop/recovery sends no
  native effect and creates no folder membership or exported conversation.
- One accepted native creation with a held reply preserves the newer folder;
  there is no second create, rename, archive or stale context export.
- Both stale commands reject409 and leave newer orchestration bytes identical.
  Unchanged-lifetime startup/reply controls each create/name once. A direct create
  without an admission callback preserves full-access behavior and local export.

Before the fix, the four stop/restart acceptance variants failed at the escaped
effect/overwritten-folder assertions; the normal control passed.
`/tmp/cr-native-create-before.log` records this intentional red run. All seven
native controls pass afterward (`/tmp/cr-native-create-acceptance.log`).

Final affected checks: **154 tests across six files**, plus **17 native-security
R3 controls** (nine unrelated tests skipped), lint and server build PASS.
`/tmp/cr-native-create-focused.log`. Includes the existing L1/L2/L3, idempotency,
200/205 retention, eight-worker, model pinning, manual control and encrypted
leader/epoch/Plan/logout/expiry/rotation controls. All heavy work uses codex-heavy,
one Vitest worker and a1024MiB Node heap. Fake subprocesses/temp Vault only; no real
model turn, task resolution or unsafe Nginx fixture. Owned jobs/processes exit.

Client and browser harness are unchanged from82b4367. Its four-viewport/31-screenshot
evidence is reused after verifying all38 recorded log/artifact/screenshot hashes.
The older3f7e139 full527+11 log hash is also verified for unchanged-scope evidence;
neither browser nor full suite is claimed rerun at this HEAD. Source/client map
checks bind the complete matching client to this checkout.

## Artifact handoff

`scripts/leader-review-fixes-artifacts.mjs` produces the read-only manifest
`/tmp/cr-native-create-artifacts.json`:90 backend files,46 accepted security entries,
25 matching client files, JS/map emission, dependencies and reused evidence.
The emitted incremental delta from product82b4367/review14cc189 is exactly:

| File in dist-server | Previous SHA256 | New SHA256 |
| --- | --- | --- |
| controller.js | 15d3fc0d0251a8ff9cbbc4e01fcb32601d128b7b182ec0a0af3979deffaea9b7 | f7e041f6a7a12bfe789f3e4fd52f3e6b88d45ee167a93713907415baa2ed793d |
| controller.js.map | 1e9436a6ace5d4a6856b58914ed07423d610c737b415d0fde5f939aa698166f3 | 79a0483d59bf77b43ebb3e7862a3e2c1ab7d2882e89bf7cc563fcbcc7361694f |
| orchestration.js | eca9771bb59e80ca0263cb4a3d4b5a1f33c49e364796e51fcc6ef8dc2a6c28eb | b26415e206cbea0e987c5d5615a718b2ceb3bef9e0edb00f904fc5e6ff2115c5 |
| orchestration.js.map | 587bc839a66f476a2a1987f6c6beb22b75d22bc67fe7387c70a6986f3a32ac62 | d3a02f276d0e1356d0cb37ef14c71b1b4e954c0d47c7f2535b55f96105a52c55 |

Combined acceptedsecurity SOURCE00f9e197/app808 allowlist remains exactly six:
`controller.js/.map`, `http-app.js/.map`, `orchestration.js/.map`. HTTP JS stays
`1a3e4d21e0f5154a746ded3d3a9440493d60618ded2ce1b742cfa60db99342f0`, map
`e55e6b39060d87f8bd7445e3c9d6dbd102f52d9100a22b2fe684668a35e4e19f`.
Native transport/secure transport sources and other modules are unchanged.

The whole matching client `dist/` is copied into this isolated review checkout
byte-for-byte from82b4367, not rebuilt:25 files, entry `assets/index-BssRLWrJ.js`,
HTML SHA `554846255773e35b4dd367413481e1ffc8839a3940dad68f2948c6447e7b9d20`.
Hours JS remains `b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93`,
map `6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8`;
Hours source/generator/template and dependencies are unchanged.

Final pushed HEAD/clean remote/check receipts: `/tmp/cr-native-create-delivery.json`
and the checked-revision Vault handoff. Keep this worktree for CR3 delta review.
No release is built/armed, no main merge, runtime restart, production state/config,
Services, owner-key or seal/activation-package mutation. Security activation stays
independent. Review/activation remains with the leader; no independent approval
is implied. The existing unknown-delivery/settlement limits of82b4367 remain.
