# Repository workflow

- After completing requested repository changes, run the checks appropriate to the change, review the diff, commit the completed work, and push the current branch to its configured remote before reporting completion. This is the user's standing instruction; do not ask again for routine commit/push permission. Follow any explicit instruction to leave changes uncommitted or unpushed.
- Split work into small, focused commits by feature or fix, including relevant tests. Split shared-file hunks when needed; do not bundle unrelated features into one large commit. Keep each commit coherent and buildable.
- Preserve unrelated work. Stage only reviewed files belonging to the requested work; do not discard existing changes. When asked to commit all pending changes, review and include those changes as well.
- Never commit secrets, `.env`, credentials, temporary attachments, runtime state, or generated build output.
- For changes spanning client and server, run `npm run check`. For smaller changes, run the relevant tests and build checks. Fix failures before committing.
- Use a descriptive commit message. Push without force unless the user explicitly requests rewriting published history; for such rewrites, verify the remote tip and use an explicit `--force-with-lease` value. Otherwise, if the remote has advanced, integrate its changes without overwriting others' work, then rerun affected checks.
- Verify the push succeeded and report the commit hash and branch. If checks, commit, or push are blocked, report the exact blocker and what remains; do not claim completion.
- Build client updates before reporting them available. For backend updates, restart only after all active turns have finished, using `scripts/restart-when-idle.mjs`; never interrupt an active conversation to deploy.
