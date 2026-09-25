# Independent review: history windows and device cache

Decision: **CHANGES REQUIRED** for exact application source `52fd238dbcc8b2bb8037e1a0e7daac16840cea73` (`feat/history-window-cache`). Task f4ffdaaa-a22f-4139-8cf9-227d647746a6. Reviewer worktree `/root/WORKTREES/cr-history-window-independent`; no product edits. One reproduced P2, no P1 identified in this bounded review. Runner activation review belongs to the leader and is not approved by this report.

## H1 — P2: scrolling to the displayed bottom hides the only visible way back to live output

Locations in reviewed source:

- `src/TranscriptViewport.tsx:118`: every bottom scroll sets `following=true`, clears `reading`/`unread`, and therefore hides the `reading`-guarded Jump to latest button at line135.
- `src/historyWindow.ts:22`: loading an older page sets `historyWindow.browsingOlder=true`. `refreshHistoryWindow` at line29 keeps such a window even after subsequent refreshes; viewport's following flag cannot clear it.
- `src/transcript.ts:43`: browsingOlder suppresses all live SSE items.
- `src/App.tsx:932`: the explicit loadLatest action clears the frozen window by reopening latest. Ordinary bottom scroll does not invoke it.

Reproduction using the real encrypted app and verified candidate artifacts, with an isolated small canonical paginated transcript and fake native RPCs:

1. Open latest20 messages, enter a composer draft, then load an older page (40 messages).
2. Scroll to the bottom of the displayed window normally. Jump to latest disappears.
3. Deliver a new assistant delta through the real SSE/event path. It does not render, and the latest control stays absent, even though the viewport claims to follow.
4. Positive control: focus transcript and press End. The **same received SSE** now renders; draft is unchanged.

Confirmed in Chromium at1280×900 and390×600; screenshots `bottom-stuck-1280.png` and `bottom-stuck-390.png`. This is not a packet-delivery/auth/native-ID failure. It is a mismatch between viewport follow state and application frozen-history state. On touch devices the hidden button is especially problematic; keyboard End is not an ordinary visible recovery. Scrolling up to recover the button or reopening the convo is a workaround. A window truncated at240 items can also end before actual latest history, making its bottom particularly misleading. That extension is source reasoning; the executed fixture used40 messages.

Minimum fix: keep a visible return-to-latest action whenever the app is browsing/frozen on historical data, and avoid declaring live-follow solely from that partial window's bottom. Alternatively explicitly restore latest on the intended user transition, without treating programmatic anchor adjustments as such intent. Use one coherent state contract between App and TranscriptViewport. Do not resume/jump readers while they remain paused on older content.

Acceptance: pointer/touch-visible action remains reachable after bottom scroll; activating it restores latest/SSE and draft; no duplicate messages or automatic page draining. Cover desktop/mobile, a frozen latest window caused by paused refresh, and deep history after240-item eviction. Retain anchor/Lock/switch controls. `scripts/history-independent-browser.mjs` currently asserts the observed defect (inverse test); a successful exit proves reproduction, **not acceptance**. Convert that assertion to the corrected behavior for re-review.

## Controls and evidence reuse

Verified all10 receipts from the author delivery, including final625 Vitest/89files +11 Node log, native oracle7 comparisons/54 actual RPCs, browser/cache/Lock/Plan controls, two screenshots and aggregate37-header inventory. Verified release manifest/baseline/seal and all49 candidate payload file hashes (16backend+33client) before copying app artifacts into the reviewer worktree. Reused that evidence instead of rerunning the broad suite/native materialization/197MB fixture. Source and native-compatibility limits are documented in `docs/performance/history-window-2026-09-25.md`.

Independent sequential codex-heavy controls:

- 14 targeted unit tests passed: three new reviewer tests plus existing historyWindow/historySync/threadHistoryCache controls. New cases partition43 messages across one native turn with80-tool page overflow into20/20/3; preserve explicit IDs/status/source bytes; invalidate old cursors after duplicate completed-item update and reopen checkpoints; reject cross-thread identity and withdrawn liveness before queued and after operation results.
- Real browser H1 inverse plus positive End recovery passed both viewports. Draft retained; held encrypted history could not overwrite another convo or reappear after Lock; cookie-only history denied before native RPC. No full-history RPC or native/model turn.
- Reviewer lint0 warnings/errors and script syntax passed. The first browser run confirmed desktop then hit a fixture-only mobile auto-selection/sidebar race at initial selection. Confirmation waits for the already selected default conversation and passed both. Initial copied-harness unused warnings were then removed (measurement-only code); syntax/lint rerun only, no runtime/product change.

Evidence archive: `/root/.local/state/codex-remote-secure/reviews/history-window-f4ffdaaa`. `decision.json` records exact source, hashes, check results and limits. Original temporary logs: `/tmp/history-independent-f4ffdaaa/check.log`, `browser-confirm.log`, `lint.log`. A full app rebuild/suite was not necessary for this tests/report-only review.

## Limits and boundaries

The37-header inventory proves only observed unreferenced metadata, not all native histories. Non-null history_base/subagent ordinal prefix refusal is an existing documented limitation, not a newly discovered P1/P2. The native oracle covers its seven scenarios, not every event/version. Cold full-source indexing, per-thread rather than global disk cap, and unchanged background Vault full hydration remain explicit limits.

No production full-history read, state/key/native mutation, real push/model turn, deploy/arm/restart or author checkout modification. No physical iOS/touch gesture testing; mobile evidence is Chromium viewport plus DOM scroll/pointer and keyboard controls. Impeccable context launcher was unavailable (permission denied); review used incumbent code/verified captures directly, with no aesthetic redesign or general accessibility certification.
