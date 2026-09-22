# Leader lifecycle and outstanding report retention

Implementation task699b2436-efa4-4746-9d65-26456738c898, not independent approval
or activation. New worktree `/root/WORKTREES/cr-leader-lifecycle-report-retention`,
branch `fix/leader-lifecycle-report-retention`, exact pushed review base
`fc40c05b607b99b04d63e812c443d1c309745031`. Previous author/reviewer trees are
preserved. Original report: `leader-resolution-history-fixes-independent-review.md`.
L2 and the original dispatch-marker/receipt/selector fixes remain accepted within
their earlier review scope; this task addresses only the two residual findings.

Actual read-only receipt: task699b2436 maps to current native turn
`01a0c7de-7f14-7fb1-abe0-b9403107ceb9`, **gpt-6-astra/max**, current turn matches.
Evidence `/tmp/cr-leader-lifecycle-settings.json` contains only these settings
and identifiers, no credentials or real task content.

## L1: lifetime ownership of asynchronous continuations

Each running lifetime has its own identity. Stop invalidates it permanently;
restarting the same object creates a new identity and reads current persisted
state. It does not restore a stale snapshot. Every awaited startup/reconcile read
checks that identity before any settlement/write, and startup checks again before
finalization/timer installation. A repeated start while running is idempotent.

Scheduler inspection, catalog/start/interrupt replies and result deliveries carry
the same ownership guard. An old pump's finally cannot clear a new pump's lock
or dispatch reservations. Late cancellation success/failure cannot replace new
state; its guard also reaches the existing native interrupt boundary. Admission
and archive continuations use the same rule. A stopped instance ignores completion
and change callbacks and cannot restart scheduling. Normal exact-turn settlement,
manual control, supported model settings, encrypted guards and eight-worker
capacity are retained.

Both independent delayed-read inverses now assert acceptance: after the new
instance records recovery, releasing the old startup/reconcile reply leaves the
persisted file byte-identical. No old timer, start or interrupt occurs. Additional
fixtures cover same-object stop/start, late scheduler inspection, create reply,
accepted/rejected cancellation and late worker/result replies across both kinds
of restart. No production process overlap is asserted from these class fixtures.

Focused orchestration/controller/encrypted resolution suites:110 passing tests,
lint and server build. `/tmp/cr-leader-lifecycle-focused.log`. This intermediate
run still contains the two separate retention inverse cases, not L3 acceptance.
Further late-callback controls: `/tmp/cr-leader-lifecycle-final-controls.log`.
All heavy work uses codex-heavy sequentially with one Vitest worker and fake
native/temporary Vault data. No actual model turn or real resolution is performed.

## L3: reserve report capacity and prioritize outstanding evidence

The existing global inactive-history capacity is200. Inactive tasks whose result
is not reliably delivered are retained ahead of delivered history. Remaining
history slots use the L2 actual terminal/recovery ordering and stable legacy
fallback. All unfinished/native-uncertain tasks remain retained separately.
Resolution and original result/status are preserved; resolving a task does not
acknowledge its report or release its reservation.

Admission now reserves each accepted task's future result slot. The concrete
invariant for new work is **outstanding inactive reports + unfinished tasks <=200**
across the shared state, with each task counted once. At capacity, spawn/delegate
fails409 before task reservation, budget spending, create/rename or dispatch.
Retries of existing request IDs remain idempotent. Concurrent commands recheck
capacity after the catalog await, before synchronously reserving the last slot.
Already accepted work can continue and finish at capacity because its result is
already reserved. Only a confirmed native result-delivery receipt frees a slot.
No worker concurrency, wakeup or pending-notice budget is increased.

Legacy states may already exceed this invariant. They retain every outstanding
record, its result and recovery, and every accepted unfinished task. This is a
finite inherited excess, not permission to grow it: all new admissions are
blocked until outstanding+unfinished drops below200. Completion of previously
accepted tasks only converts existing reservations; repeated saves/restarts do
not add records. At/over200 outstanding inactive reports there are zero delivered
history slots, avoiding the JavaScript slice(-0) edge case. Original uncertain
records stay accessible through the task API/current view, not just a count.

Acceptance converts both independent199/205-delivered probes: the old review
record and fresh failure survive save/restart; delivered history is evicted first.
Additional tests seed200/205 outstanding reports plus accepted work, preserve the
finite excess and evidence across completion/restart, reject repeated spawn and
delegate (including another folder) without effects/budget changes, race for the
last slot, retain admitted work across failure/restart, and free exactly one slot
after an actual fake-native delivery. Recovery alone does not free capacity.
The L2 fresh-recovery/new-failure controls still pass using known-delivered history.

Final affected suites: **126 tests across five files**, including89 orchestrator,
21 controller integration,7 encrypted resolution and9 selector tests; lint/server
build pass. Log `/tmp/cr-leader-report-retention-verified.log`. One initial test
expected a nonexistent duplicate:false field on normal admission; that assertion
was corrected to the existing task response contract. No product workaround was
needed. The prior full527+11 evidence is not rerun or claimed as a new full check;
product implementation changes in this task are server-only.

Remaining limits: unknown legacy settlement can still block resolve/worker slots;
unknown or review delivery can keep admission blocked indefinitely at capacity.
There is no automatic acknowledgement, recovery fabrication, uncertain replay,
new override API or unrelated archive system. The UI selector is unchanged, so
delivery priority can evict even recent delivered history when all slots are
needed for outstanding evidence; it never evicts an outstanding report to do so.

## Browser and artifact boundary

Fake-native browser fixtures pass at1280x900,320x600,390x844 and390x600. They retain
the Leader page, Files placement, keyboard, draft/scroll, cancel/retry, compact Plan
and logo reload behavior. The old205-delivered case has exact current/history
counts; the pre-existing205-uncertain case exposes every original result together
with accepted active work and a fresh failure. The latter tests UI accessibility;
the server fixtures separately exercise real admission, pruning and persistence.
Log `/tmp/cr-leader-lifecycle-browser.log`,31 screenshots in
`/tmp/cr-leader-lifecycle-browser/`; manually inspected desktop,320px Plan and
`outstanding-overflow-evidence-390x600.png`. Owned preview/browser processes exited.
No app URL is hosted or handed over and no Services entry is changed.

`scripts/leader-review-fixes-artifacts.mjs` emits the read-only manifest
`/tmp/cr-leader-lifecycle-artifacts.json`. It compares90 backend files,46 sealed
security entries, source/JS/map emission and all25 matching client files. Since
product3f7e139, the only new runtime artifacts are:

| File | Previous SHA256 | New SHA256 |
| --- | --- | --- |
| `dist-server/orchestration.js` | `a489b6867c94fed79379e64abecc1c478615020cf7599dc338c0198f3c0475a5` | `eca9771bb59e80ca0263cb4a3d4b5a1f33c49e364796e51fcc6ef8dc2a6c28eb` |
| `dist-server/orchestration.js.map` | `1b086af71e79e579c8a77399435531bceb9320703eefc72bdaaaa9770dc58604` | `587bc839a66f476a2a1987f6c6beb22b75d22bc67fe7387c70a6986f3a32ac62` |

The combined Leader delta from accepted security SOURCE00f9/app808 remains exactly
`controller.js`, `http-app.js`, `orchestration.js` and their maps. The first two
modules/maps are byte-identical to3f7e139; the manifest carries all six exact hashes.
The secure transport implementation, dependencies and Hours sources are unchanged.
Hours JS remains`b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93`,
map`6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8`;
generator/template are untouched.

The entire matching client `dist/` is reused byte-for-byte from the preserved
3f7e139 author checkout, verified against unchanged source/maps and exercised by
these browser fixtures. No new client build is claimed or needed for this delta.
Its entry is`assets/index-BssRLWrJ.js` and HTML SHA256
`554846255773e35b4dd367413481e1ffc8839a3940dad68f2948c6447e7b9d20`.
For a combined rollout from accepted security, use this complete matching client,
not an arbitrary earlier security client.

## Review and activation handoff

These are implementation acceptance tests, not independent approval. Preserve the
CR2 findings and decision as historical evidence. The final checked/pushed HEAD
and clean remote receipt are recorded in `/tmp/cr-leader-lifecycle-delivery.json`
and the checked-revision Vault handoff. Keep this worktree and its artifacts for
leader/CR2 inspection. Nothing here changes main, a live service, real task state,
production configuration/keys, security runners or immutable release seals.

After separate review, the leader may prepare a **new** isolated release from the
exact reviewed HEAD, with private state/runtime backup and rollback inventory.
Select only the two incremental artifacts above if3f7e139 is the verified
baseline, or the six combined backend files plus the complete matching client
when integrating accepted security. This does not authorize copying this older
baseline over independently accepted changes. Reconcile the then-current release
first, keep Hours and modules outside that allowlist unchanged, and use
`scripts/restart-when-idle.mjs` only after ALL turns are idle. No restart is armed
by this task; accepted security rollout remains independent. Never restore an old
orchestration state snapshot over newer recovery/results during rollback, and do
not resolve the real target task as an activation test.
