# H1 implementation: keep latest reachable in frozen history

Task `2550cd42-e88c-4d50-a075-ea4e50681b52`. Dedicated worktree
`/root/WORKTREES/cr-history-frozen-latest`, branch `fix/history-frozen-latest`,
exact base `6471a6e79e77ae94614d070132331a67748cf92a` (review of application
`52fd238dbcc8b2bb8037e1a0e7daac16840cea73`). This is an implementation
handoff for re-review, not independent approval or deployment.

App now passes its `browsingOlder` flag to TranscriptViewport as `frozen`.
A frozen window always retains the existing Jump to latest control. Its bottom
does not mean live-follow, and resize/anchor adjustments cannot enable it.
Pointer activation or End requests latest from App; following resumes after App
replaces the frozen window. A new upward reading gesture cancels the pending
follow intent. Ordinary unpaused/latest bottom behavior stays unchanged.
No visual redesign, extra control, paging budget or backend change.

## Acceptance

`scripts/history-independent-browser.mjs` now checks acceptance instead of the
review's inverse. Actual encrypted app with temporary canonical histories, fake
native RPCs and fake credentials passes at1280x900 and390x600:

- Load40 messages, scroll to displayed bottom: latest remains pointer-accessible.
  SSE stays withheld until activation, then the same received delta appears.
- Pause latest without fetching older; background turn-completion revalidation
  freezes it without moving the reader. The bottom still offers latest recovery.
- Six deliberate older-page requests cross the240-item cap and evict latest79.
  Anchor survives each prepend, counts/read requests stay stable without another
  action, and deep-bottom latest restores newest history plus received SSE.
- Draft remains intact, restored rows have unique anchors, keyboard End works.
- Held history cannot overwrite a switched conversation or reappear after Lock;
  cookie-only history is denied before native RPC. No full-history/model request.

All checks ran sequentially through codex-heavy, Node heap1024MiB, one worker.
14 focused tests PASS; lint0, typecheck, client build and PWA PASS. One batched
browser acceptance/desktop-mobile screenshot pass succeeded; retained snapshots
were inspected against the review's failing mobile capture. Impeccable hardening
and craft-floor guidance applied to the bounded behavior fix; context launcher
was permission-denied, no PRODUCT.md/DESIGN.md exists, so incumbent code/screens
were used. Existing styling, copy, layout and unrelated flows were preserved.

## Evidence and integration boundary

Private evidence: `/root/.local/state/codex-remote-secure/reviews/history-frozen-latest-2550cd42`.
Checks job `codex-heavy-207875110c244b09b707d5d45982d7ae`; reuse job
`codex-heavy-be2dbd7b10a04b74a980876aaf9c75e4`.
`reuse-and-artifacts.json` verifies all10 prior author receipts and98 copied
backend artifacts byte-identical to the exact review checkout. Server source,
dependency lockfile, Hours and history-release runner source are unchanged.
Unchanged625+11/native7comparisons54RPC evidence is reused for unaffected scope,
not presented as a newly rerun full suite. Matching clean client build has25
files with exact hashes in that manifest; prior release33-file inventory includes
its own retained artifacts and is not silently repackaged here.

Only product changes are `src/App.tsx` and `src/TranscriptViewport.tsx`.
Root must prepare a new matching-client package after review; the existing
package/seal remains untouched. No runtime/config/Hours/key/state reads or writes,
arm, restart, real model turn, Services change or production transcript read.
Owned browser/server/temp fixtures were cleaned. Mobile is Chromium viewport
with pointer/DOM scroll and keyboard controls, not physical iOS gesture evidence.
Original review findings remain in their historical report/decision; only this
bounded H1 implementation and acceptance are claimed.
