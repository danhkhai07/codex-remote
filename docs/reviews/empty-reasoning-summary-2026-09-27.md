# Empty reasoning summary cards

Status: implementation candidate, **not deployed**.

Task `97d5ff64-9029-4ae3-b963-1a346e5b5214` starts from preview-sharing integration source `0f214f3333cda4a33af8422b6419009e6695416e`. The focused product commit is `4b10929fb7fcf798bccec17625d9a1d3f7da19b0` on `fix/empty-reasoning-summary` in `/root/WORKTREES/cr-empty-reasoning-summary`.

## Cause and correction

Cold paginated history already excludes native reasoning bookkeeping. Live `item/completed` SSE events can still add empty `reasoning` items to the in-memory transcript. `conversationItems` previously returned those items unchanged, and `HistoryItem` sent each one through the generic activity fallback, producing repeated **Reasoning summary / View details** cards after a final answer. Empty internal items followed the same fallback.

The transcript projection now omits empty reasoning, known internal lifecycle rows, and unknown empty bookkeeping rows before applying the bounded 240-item view. It retains user, assistant and Plan messages, nonempty public reasoning summaries, known tool/activity types, content-bearing rows and signed history-detail rows. The raw source/cache/native transcript is not deleted or rewritten.

No duplicate or reordering defect was reproduced. Existing reconciliation replaces a stored row only with a live row sharing the same `(turnId, itemId)` and preserves visible arrival order. Focused tests cover the same-ID case, so this change does not alter reconciliation, paging, SSE protocol or server history.

## Evidence

The pre-fix inverse produced 13 `Reasoning summary` labels from one public summary plus 12 empty reasoning items, and retained empty/internal IDs in the projected rows. The same tests pass after the correction:

- focused Vitest: 13 passed;
- TypeScript: passed;
- oxlint on the four changed files: 0 warnings and 0 errors;
- client build and PWA validation: passed;
- encrypted Chromium fixture: passed at 1280×900, 768×800 and 390×600 with owned fake native data and zero real model turns.

The browser fixture covers cold native history, 12 empty SSE reasoning events after a final answer, a context-compaction event, one supported nonempty public summary, warm thread reopen, 20-message paging that excludes tools, lazy tool detail and 32 KiB chunks, frozen/deep-240 Jump to latest, draft/anchor retention, SSE, Lock and thread switching. Screenshots confirm a single nonempty public summary and no empty fallback stack.

Private evidence is under `/root/.local/state/codex-remote-secure/reviews/empty-reasoning-summary-97d5ff64-final`:

- delivery SHA-256: `f6eb158c94c1bf7d0140a8f62de87f6899d2526ea72d3329c65a3c265eef9b19`;
- exact 25-file client manifest: `35eed0acca2e3976208f560daa21726f7004115ef51023aa6f8150471264b70c`;
- screenshot manifest: `5f3f30441627dcefadf92fe001fe844d7a151e00204f3b5117c1fdc6b8d35892`;
- browser log: `11ab0040bec88849b8dcfe22115cf4a25419a6145bde76cf86661fbef59eda9c`;
- focused final unit log: `780219c96fcaf134be0b25981b88aaafa7ecb774afef3d2d7c6b970ead7fd3f3`;
- final typecheck/lint/build/PWA log: `b48e5f081f504aefaeaa795729f857a54af409c01fe5af15a15249d7a9966892`.

The matching client entry is `assets/index-DuR5uNWT.js` (`b395735e78bedc547a5283e9db3b1f962d7d267a2b6ce70d0c4fe1dc3d47f88a`) with map `962461ec9ef56c2b7d6f2c17f3cce9c82f4feaec9fe8892e7b57ad3426c1d0`; `index.html` is `e2be2710d1ef6b7a7f2d11b7c80b7ecfe4250ac79db7fec135310266a79ae92e`.

## Integration boundary

This is a client-only product change. Backend source and emitted backend artifacts remain exactly the preview-sharing base. The observed NEW runtime remained `codex-remote-secure.service`, PID `2937958`, on live source ancestor `177e812c2f9b441f201bbdba365a252fdba63cf3`; no runtime, Services, config, key, state, Hours or native data changed.

Root should integrate the product commit after the preview-sharing source, then publish the complete matching 25-file client graph with immutable assets first and `index.html` last while retaining old hashed assets. This delta alone needs no backend restart. Physical Safari/iOS remains untested.
