# Knowledge acceptance checks

Retrieval and answer correctness are separate checks. The deterministic suite in
`server/knowledge-context.test.ts` checks which evidence is selected, its scope/status,
archived decisions, long handoffs, byte limits and UTF-8. Store/HTTP tests separately check
stale writers, diff/restore, observed file edits/deletions, authentication and path boundaries.

Use **Knowledge → Kiểm tra truy xuất** against the target conversation, then inspect the
excerpts. To assess an actual answer, ask the same question in a test conversation and compare
its answer against the criteria below. A passing source check alone does not score the model.

| Question | Evidence expected | Correct application |
| --- | --- | --- |
| Bắt đầu task code mới thì dùng worktree nào? | Confirmed global worktree lifecycle | Create a new worktree for a new task; keep the current one when continuing the same task. |
| Sau khi PR merge phải dọn những gì? | Worktree lifecycle; Services workflow | Verify merge, stop only that PR's test services, update Services, remove its worktree; preserve unrelated work. |
| Review Kiotclone hiện tại dùng link gì? | Current Kiotclone review note | Use the Codex Remote localhost preview URL; do not apply the superseded ngrok requirement. |
| Trước đây Kiotclone dùng cách review nào? | Historical/superseded review evidence | Explain the earlier ngrok request as history and identify the current preview workflow. |
| Quy tắc chờ mọi lượt kết thúc trước restart áp dụng ở đâu? | Codex Remote project note with its scope | Apply it to the Codex Remote gateway, not every unrelated review app. |
| Ý tưởng chưa xác nhận có phải yêu cầu phải làm không? | A note explicitly marked proposed | Treat it as a proposal and seek applicable current instructions before treating it as a requirement. |

For a human answer review, record the selected source revisions, the actual answer, a pass/fail
per criterion and any missing context. Keep such reports outside the always-injected handoff;
label them as evaluation evidence. Do not claim an automated end-to-end model evaluation from
these source-selection tests. No external model calls are needed for the automated suite.

Operational checks:

1. Open one note in two clients. Save in client A, then save client B's old revision. Expect 409,
   B's draft preserved, A's content unchanged, and a visible merge comparison.
2. Merge both edits and save. Compare with an older version and restore it. All prior versions
   remain available after restarting the store.
3. Edit/delete a note directly, let observation run, and inspect external/deletion entries.
   Restore the last observed contents of the deleted note through the CLI.
4. Open source links, inspect a prior context snapshot, and run a retrieval preview. The preview
   must not send a turn or add a used-context record.
5. Check the page at 320, 390, 768 and 1280 px. Note editor, source dialog and version comparison
   must remain accessible without page-wide horizontal scrolling.
