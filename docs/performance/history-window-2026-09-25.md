# 20-message history implementation — draft, not rollout ready

User's confirmed25September contract supersedes the5MB/2.5MB proposal: initially about20 user/assistant messages, tool calls do not consume message count, scroll upwards to retrieve older history, reuse local device cache. Preserve native transcript/model context/Vault; no deletion. “localstorage” describes caching behavior, not permission to persist private content or keys as plaintext. Existing encrypted IndexedDB remains the store.

Base6f6fe30a08f3e763d74eed440824ffa84f831aa9. Marker push-browser-answer-378b37ef complete; live index.html/controller.js byte-match that package at preparation. Runtime Hours JSb763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93/map6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8 read-only verified. No process/config/native/Hours mutation, no deployment.

## Implemented draft

- Existing generated native protocol `/tmp/codex-orchestration-protocol/v2/ThreadReadParams.ts` explicitly deprecates full hydration in favor of `thread/turns/list` and `thread/items/list`. Draft uses those methods: turns metadata only, descending items, signed per-thread continuation carrying within-turn position and actual turn status. Browser history API never falls back to includeTurns:true.
- `/history` defaults20 messages, maximum80 scanned items per request; tool-dense pages may contain fewer messages and expose an explicit continuation. Per-item text/tool summaries have16K/2K UTF-16 code-unit budgets and bounded containers. Full details display in32K-character windows through a signed item cursor. Detail item-ID mismatch after rewrite fails instead of selecting a different item.
- File stat fingerprint plus native events invalidates server cache; unchanged fingerprint returns the same bounded page/revision without another items scan. Without a metadata path,1second cache TTL.128pages/16MiB,16in-flight builds; shared concurrent page reads. Existing encrypted response cache supplies revision/not-modified wire semantics.
- Local cached history paint only after a fresh session/owner unlock. Cache route access is explicitly limited to history windows; retains generation/namespace/epoch checks. Older cached pages are reused without a network call. Cold offline unlock remains forbidden; already-unlocked offline browsing may reuse cached pages.
- Upward wheel/touch/keyboard near boundary requests one page per gesture; explicit load button remains accessible. Item-ID anchor adjustment, bounded240-item view, latest jump, separate active/pending/draft state. Reading an older window excludes unrelated live transcript rows; reconnect refresh keeps that window and refreshes latest cache separately.
- Unread reconciliation uses bounded history pages instead of full native hydration. Existing known receipt boundary is carried in a signed cursor across gap pages, so newly observed IDs from the first page do not prematurely terminate a multi-page gap within one turn. Pending/ACK and Push generation behavior remain unchanged.

## NOT resolved / must pass before integration

1. Native `thread/items/list` has an item-count limit, **no byte limit in the inspected schema**. The current app-server uses readline+JSON.parse for RPC. A single197MB item may still allocate/transfer197MB between native and gateway before this draft clips it. The many-item fixture is not proof of this case. Need a bounded native content/summary facility verified against the installed binary, or a coherent private incremental read index/streaming reader of trusted rollout storage. Do not ship or claim the giant-item requirement solved by post-RPC truncation.
2. No checks executed: codex-heavy fails BEFORE execution, read-only `/var/log/codex-heavy/...service.json`. Cannot generate fresh native schema, run typecheck/fullcheck/browser or collect new performance metrics under this sandbox. Do not run checks outside the mandated heavy runner.
3. Native page/cursor compatibility must be verified with fake subprocess protocol fixtures and the installed schema (read-only generation). Existing shared browser fixtures lack paging RPCs and need adaptation once checks can run. No automatic legacy full-read fallback is intended.
4. Browser fixture covers initial20/tool count, explicit older load, bounded UI and offline cached older page reuse on1280/390. It has NOT RUN. Still extend/execute warm reload/no-change, append while closed, cancellation/Lock+switch races, actual upward scroll anchor, Plan/draft, and giant-single-item197MB native-wire/memory cases. Unit tests are authored, not passed.
5. Unread multi-page recovery and statuses require integration regression coverage, including restart during a gap, overlap within one turn and native compaction/rotation. A currently interrupted/active turn remains separate from display pagination; the backend never alters native context.
6. The existing background Vault completion reconciliation still uses full history RPC; it is not an ordinary browser-open/page route. Preserve Vault correctness while separately deciding whether its event-only export can replace full repair reads. No claim that every background full native read has been eliminated.

## Evidence and repeatable commands

Previous d43da8f investigation's5M vs2.5M numbers are historical, **not** measurements of this implementation. New probe `scripts/history-window-browser.mjs` models197MB of old tool records lazily and fails if the UI asks for full native hydration. It does not allocate a197MB single-item result. No measured speedup for this draft yet.

Required once heavy runner is available (sequential, one worker):

```
codex-heavy --label history-window-check --timeout 1200 -- bash -lc 'set -e; export NODE_OPTIONS=--max-old-space-size=1024 VITEST_MAX_WORKERS=1 PLAYWRIGHT_MODULE=/tmp/working-hours-browser/node_modules/playwright/index.mjs; npm run check; node scripts/history-window-browser.mjs'
```

Record actual output, fix failures, then add giant/native integration acceptance before root review. Local source static diff check alone is not acceptance.
