# Bounded independent Push review

Decision: **accepted within the scope below; no P1/P2 finding**. This review is
not activation approval or evidence that Push is live. No production write,
restart, service arming, real notification, real conversation/model turn, key or
Hours mutation was performed.

## Exact scope

- Primary fixed candidate: `d4775efeb98764d0858eceafbf6491346259807c`.
- Push implementation: `ba81b136cd70bdd48e793b8bae137435f3ee430d`.
- Baseline reconciliation: `51e7785da7f8882d6734f6150d073334db3a0b99`.
- Read additional stable delta to `ec8638ff96c2266ca6cece6a6d48a49fc148aa5f`:
  FileViewer title, its fixture/docs and Hours title assertions only. Push and
  backend source are unchanged. FileViewer bytes equal the authored `51ad6daa`
  implementation. Services/title were authored by this reviewer; this report
  does not claim their implementation was reviewed independently.

## Findings and behavior

No material defect was identified in this bounded review.

- `server/controller.ts:95` updates cached explicit names on native rename;
  `:124` snapshots current group/leader role and completion status. Worker labels
  do not inherit the group's leader role. The `index.ts` adapter passes only
  context to Push, keeping the answer out of the payload.
- `server/push.ts:17` allowlists identifiers/labels/outcomes, normalizes controls
  and caps Unicode code points; `:112` snapshots/coalesces a complete context;
  `:149` revalidates restored deliveries. Existing device ownership, expiry,
  logout unsubscribe, retry/dedup/visibility behavior remains. Legacy delivery
  bodies remain generic. A push already handed to an external provider cannot
  be retracted by a subsequent local logout; the patch does not claim otherwise.
- `public/sw.js:74` uses a fixed local target, skips nested and Files/Hours
  clients, and requests an ACK before choosing an existing root app. It does
  not call `navigate()` on that app. Invalid IDs/payloads fall back to `/`.
  ACK means the target was accepted, not that authentication/thread loading
  completed. Incompatible clients have a bounded ACK timeout and new-window
  fallback; OS focus/openWindow behavior still needs real-device acceptance.
- `src/notificationNavigation.ts:31` restricts messages to the same-origin root
  worker and root top-level app. Only a bounded thread ID is held in the hash;
  the encrypted API remains the access gate. `src/App.tsx:950` checks the
  selection sequence and request lifetime before opening a target. Manual
  selection/newer notification wins; drafts and active turns remain intact.
- A lookup already pending when the owner explicitly Locks may be cancelled
  and consumed. The review does not require that pre-Lock click to replay after
  a new login. A click received while locked is retained until unlock. The
  independent fixture verifies stale lookup cannot resume after Lock and a
  fresh click after unlock still works.

## Independently executed evidence

All heavy checks used codex-heavy sequentially, one worker, Node heap1024MiB,
`TMPDIR=/tmp`, fake credentials/native RPCs and disposable local listeners.

1. Reviewed complete Push delta and baseline reconciliation. Verified author's
   full-check/fixture log hashes from its fixed manifest; reused588 Vitest +11
   readiness and generator/browser evidence without repeating the broad suite.
2. Ran33 focused tests: push delivery16, context integration5, notification
   navigation3 and worker9. Passed. Unit tests cover labels/privacy, legacy
   fallback, invalid IDs/URLs, subscription ownership, expiry, retry/restart,
   in-flight coalescing, foreground suppression, role/name changes and ACK.
3. Ran independent real encrypted browser probes at1280×900 and390×844.
   Added held native reads to prove manual selection wins, newer click wins,
   and Lock while awaiting native RPC cannot resume its target. Existing cold/
   locked click, drafts, same-document marker, missing-thread fallback and
   no start/interrupt checks also pass. Only synthetic-click OS `focus()` is
   stubbed, as in the author fixture. No real push or physical Safari tested.
4. Built a clean matching25-file client from the fixed source and verified its
   worker bytes against source. The mutable author output had advanced to the
   title build, so initial old-manifest comparison correctly failed on index;
   it was not accepted as the old candidate. A first focused context test also
   failed because inherited TMPDIR was outside its explicit `/tmp` root;
   rerun with the documented TMPDIR passed. Production implementation unchanged.
5. Lint passed with zero warnings/errors. No implementation fixes were made.

Logs: `/tmp/contextual-push-independent-review-r3.log` (clean build +33 tests),
`/tmp/contextual-push-independent-browser-r4.log` (final browser +lint).
Artifact receipt: `/tmp/contextual-push-review-artifacts.json`.
Screenshots: `/tmp/contextual-push-review-browser/push-thread-{1280,390}.png`.

## Runtime and rollout boundary

Independently matched all90 current NEW JS/map hashes to the recorded runtime
baseline and checked candidate bytes. Publish exactly `controller.js`,
`index.js`, `push.js` and their three maps. Excluded build differences are
`secure-client.js`, its map and historical `event-hub.js.map`; keep actual live
bytes. No package/dependency delta. Hours JS remains
`b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93`, map
`6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8`.
Candidate/runtime/isolated Hours templates all match
`b2b5f55f45f151391e274cc8b3f20c62eab025b9bc22f094b4ec470422537b81` and
the CR4 `hours-c9f7285e/LIVE.json` receipt. Do not republish/regenerate Hours.

The NEW-only runbook is coherent: preserve key/VAPID/subscription/session/native/
Vault state; freeze the old authenticated maintenance/config import closure;
verify complete thread/pending and all-group orchestration queues/reports;
two idle observations five seconds apart, under-lock drift+idle before writes
and immediately before `codex-remote-secure.service` restart. Never restart OLD,
interrupt work or use the default OLD-targeting stock watcher. Code-only guarded
rollback must not restore mutable state. Publish matching client/worker with
old hashed assets retained and index last; verify fresh PID/health/assets and
exclusions before marking complete. The polling readiness mechanism has a small
admission race, explicitly acknowledged; it is not a hard admission barrier.

The only remaining review boundary is the concrete executable release runner,
its fresh final manifest/baseline and activation-time ALL-idle evidence. This
document cannot approve a runner that did not yet exist in the reviewed commit.
The stable ec8638f title delta is compatible by source review and verified author
incremental evidence; final publication must use its complete matching client,
not the fixed d4775ef client used for independent Push probes.
