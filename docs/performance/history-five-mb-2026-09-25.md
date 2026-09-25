# Conversation loading investigation — 2026-09-25

Scope: user requests “convo đạt 5mb thì cắt một nửa đi; đỡ phải load lâu mỗi lần chat”. Whether this means reversible loading or permanent deletion is still awaiting clarification. This branch changes no product implementation, native transcript, model context, Vault history or deployment. It supplies a disposable measurement and a proposed loading contract.

Baseline: source `6f6fe30a08f3e763d74eed440824ffa84f831aa9`; NEW release `push-browser-answer-378b37ef/status.json` was complete/verified (2026-09-24T14:48:39.016Z). Preserve its Push/Files/title/Services and current Hours. No release applied here.

## Where work happens

- `server/controller.ts:349`: readThread first awaits native full history, records context, then projects a capped response. `:660` requests `thread/read` with `includeTurns:true`; concurrent reads are deduplicated but sequential opens read again. The metadata cache at `:669` stores no history.
- `server/conversation-size.ts:2`: already caps view at **5,000,000 UTF-8 bytes of serialized JSON**, not disk transcript bytes, not 5 MiB, not encrypted wire bytes. Oldest included turn/items can be shortened. This is not deletion of native history.
- `src/api.ts`, `src/transcript.ts`, `src/threadHistoryCache.ts` and `src/deviceCache.ts` apply view/cache limits too. Cache can paint sooner but authenticated refresh still reads native. SSE replay is a separate 16 MiB budget (`server/event-hub.ts`); reducing view size must not reset replay IDs or discard pending events.
- `src/App.tsx:410`: conversationItems renders all included HistoryItems. TranscriptViewport maintains scrolling rather than virtualizing rows. Reducing bytes reduces input, decryption/JSON/cache work and rendered content; DOM count also depends on item structure, markdown and open tool details.
- Existing truncation notice (`src/App.tsx:1886`) has no older-history retrieval control/API. Simply changing 5M to 2.5M would continue hiding history, not fulfill a reversible loading design.

No claim is made about the dominant production bottleneck: real native disk/RPC cost and private conversation contents were not sampled. Projection occurs too late to reduce native full-read/JSON work. Fixing that requires supported native pagination or a separately maintained consistent read index; editing native transcript files is not a performance shortcut.

## Proposed reversible contract (not yet implemented/approved)

1. When serialized history exceeds 5,000,000 bytes, initial view targets the newest ~2,500,000 bytes; below threshold keep ordinary loading. Keep full turn/item IDs and whole completed turns, including tool calls/results. No content changes supplied to the model.
2. Keep active/pending turn state separate and authoritative. Never discard an unfinished turn to meet an arbitrary cap. A single oversize turn requires explicit bounded item/detail retrieval, visibly marked, with paired tool metadata retained; it cannot satisfy both a hard 2.5 MB cap and unconditional whole-turn inclusion.
3. Return a stable older-history cursor anchored to original turn IDs and a history revision/snapshot boundary. Retrieve older pages only on demand, authorized through the existing encrypted/liveness checks. Native full read may still occur per page initially; disclose this limitation.
4. Show historical pages in a separately bounded window, with back/forward navigation, not an ever-growing accumulated DOM/cache. Preserve selected conversation, draft, scroll anchor, latest live overlay and SSE replay IDs. Do not feed old pages into live reconciliation/context recording or treat their last turn as the current active turn.
5. Define reload/concurrent completion/reconnect cursor behavior explicitly: dedupe by IDs, reject/rebase missing anchors, never silently skip newly completed turns. Test giant single turns, tool pairs, pending questions, drafts, Unicode byte counts and interrupted requests before shipping.

The fixture's whole-turn projection is intentionally a feasibility prototype, not the production cursor implementation. It refuses an oversized latest turn instead of claiming that case is solved. Its older-plus-recent reconstruction assertion proves the fake source stayed intact, not availability of a shipped older-history API.

## Reproduction and coverage

Build only an isolated worktree, then run `scripts/history-five-mb-probe.mjs` through codex-heavy. Requires the external Playwright install at `/tmp/working-hours-browser/node_modules/playwright/index.mjs`. Uses owned temporary files/fake owner key/password, a loopback HTTP gateway with real encrypted transport, Chromium and fake native RPC. No native subprocess/model turns or real conversation data. Both runs use the same built client and independent browser contexts. The projected run wraps the existing capped read result; no shipped route is replaced.

The fixture checks >5M source, <2.5M projection, unchanged original, contiguous whole-turn suffix and exact older/recent reconstruction, oversize refusal and zero turn starts/interrupts. Projection currently recalculates JSON sizes repeatedly; it is not a production-efficient implementation. New pagination, giant-item display, active-turn races and mobile controls are design requirements above, not tested shipped features.

Sequential codex-heavy checks: server/client builds; 16 existing conversation-size/transcript/threadHistoryCache tests; fixture; lint. Early probe runs were stopped in their own units: measuring `response.body()` for every secure request included the never-ending SSE connection. Final probe measures completed server response writes, excluding open SSE; it never changes replay semantics. No broad app suite needed because product implementation is unchanged.

Final local sample (`/tmp/history-five-mb-wire.log`):

| Measure | Existing cap | Whole-turn prototype |
| --- | ---: | ---: |
| Source JSON bytes (both) | 7,045,767 | 7,045,767 |
| Projected JSON bytes | 4,999,936 | 2,498,314 |
| Included turns | 79 (boundary may be partial) | 39 whole |
| Completed encrypted response body bytes during startup | 6,726,025 | 3,378,656 |
| Rendered element count | 1,721 | 858 |
| Unlock to latest answer visible | 12,858 ms | 7,157 ms |
| Full fake-native reads during startup/open | 5 | 5 |
| Total fake-native JSON parse time | 121 ms | 105 ms |

These are single-run observations under the shared one-CPU heavy queue, not a benchmark guarantee. Completed wire totals include startup requests, not only history; open event streams are excluded. Repeated prose is not representative of every tool/markdown-heavy conversation. The 5 full reads show native work is not fixed by this projection. Identifying/reducing redundant startup/resume/reconciliation reads requires separate lifecycle instrumentation, rather than removing those reads blindly. The standalone existing parse+cap took107ms versus prototype projection221ms: timings have different scopes; this naive repeated-serialization helper does not demonstrate a faster server projection.

Runtime recheck during investigation: NEW PID2452356 active; OLD PID0 inactive. No deployment, key/Hours/session configuration change or production conversation mutation performed.
