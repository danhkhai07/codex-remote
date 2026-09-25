# Independent H1 re-review: accepted

Task `385a07cf-4603-4ad9-939f-31deff57490d`. **H1 is closed at exact source
`be0dcbc4093ad516b10df4452f2ab86d06f1f700`**, branch
`fix/history-frozen-latest`. No reproducible remaining H1 defect was found.
This decision covers only the frozen-history return-to-latest delta; it does
not approve a deployment package or claim the change is live.

Review worktree: `/root/WORKTREES/cr-history-h1-rereview`, branch
`review/history-h1-rereview`. Product source and the author's checkout were not
modified. This branch adds only this report and an independent acceptance fixture.

## Why the original failure is fixed

- `src/App.tsx:1883` supplies the application's `browsingOlder` state to the
  viewport. Reaching the bottom of a partial window no longer implies that the
  application has returned to live history.
- `src/TranscriptViewport.tsx:79` requests the latest window before resuming
  following; lines 88–94 resume only after the frozen state is cleared.
- The resize and scroll paths at lines 104–105 and 139–149 cannot silently
  resume a frozen window. The control at line 162 stays visible while frozen,
  including at the displayed bottom.

The reviewed product delta contains only App and TranscriptViewport changes.
Server behavior, dependencies and release runner source are unchanged. The
original failure report remains valid for `52fd238`, not for this fixed hash.

## Independent focused checks

`scripts/history-h1-rereview-browser.mjs` uses the actual encrypted application,
fake native RPCs, temporary canonical histories and real SSE transport. It adds
held-revalidation/cache-first recovery and frozen-window End controls to the
author's acceptance fixture. Both 1280×900 and 390×600 passed:

- Frozen 40-message window: the bottom retains a pointer-accessible, on-screen
  latest control; activation reveals the same previously withheld SSE delta.
- Latest cache paints while network revalidation is held, follows the bottom
  after unfreezing, and keeps the draft. End also recovers a frozen 40-message
  window, independently of pointer activation.
- Paused latest remains still during turn-completion revalidation and can be
  resumed explicitly.
- Six deliberate older-page requests cross the 240-item cap and evict newest
  history. Each prepend preserves the reading anchor, and requests/items remain
  stable without another action. Latest restores newest history plus SSE.
- Restored anchors are unique; draft survives; held responses cannot overwrite
  another conversation or reappear after Lock. Cookie-only access is denied.

Four focused `src/historyWindow.test.ts` tests passed. Fixture lint returned
zero warnings/errors. All checks ran sequentially in one `codex-heavy` job
`codex-heavy-7ce4fe11e68d4fbcac533e5217fd2da9.service`, with a 1024 MiB Node heap.
Expected secure-authorization errors occur after the deliberate Lock control.
An earlier preflight stopped before tests because it included inherited server
test additions in the backend comparison; excluding test files corrected that
verifier. It was not a product failure. Both logs are retained.

## Hash-verified reused evidence

The independent preflight verified all six author delivery evidence hashes,
ten prior 625-test/11-restart/native/browser receipts, all 98 unchanged backend
artifacts and all 25 matching client artifacts. It also verified five existing
actual-Chung read-only receipt files, without opening its production transcript.
Server source excluding inherited tests and the dependency lockfile are unchanged
relative to `52fd238`. Author frontend typecheck, client build and PWA evidence,
and unaffected backend/native/Chung checks, are reused rather than rerun.

Private durable evidence, decision JSON, verifier, logs and four screenshots:
`/root/.local/state/codex-remote-secure/reviews/history-h1-rereview-385a07cf`.
Screenshots were inspected for visible controls, retained draft and layout.

## Limits and rollout boundary

Mobile coverage is a Chromium viewport with pointer/DOM scrolling and keyboard
controls, not physical iOS/Safari gesture testing. This bounded re-review does
not re-open the already documented unsupported-prefix limitation or certify
unrelated pagination/native behavior. No model turn, user-conversation mutation,
full production-history read, runtime/package change, arm or restart occurred.
Leader must review the matching package and deployment gates separately.
