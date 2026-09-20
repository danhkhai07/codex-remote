# Repository workflow

- After completing requested repository changes, run the checks appropriate to the change, review the diff, commit the completed work, and push the current branch to its configured remote before reporting completion. This is the user's standing instruction; do not ask again for routine commit/push permission. Follow any explicit instruction to leave changes uncommitted or unpushed.
- Split work into small, focused commits by feature or fix, including relevant tests. Split shared-file hunks when needed; do not bundle unrelated features into one large commit. Keep each commit coherent and buildable.
- Preserve unrelated work. Stage only reviewed files belonging to the requested work; do not discard existing changes. When asked to commit all pending changes, review and include those changes as well.
- Never commit secrets, `.env`, credentials, temporary attachments, runtime state, or generated build output.
- For changes spanning client and server, run `npm run check`. For smaller changes, run the relevant tests and build checks. Fix failures before committing.
- Use a descriptive commit message. Push without force unless the user explicitly requests rewriting published history; for such rewrites, verify the remote tip and use an explicit `--force-with-lease` value. Otherwise, if the remote has advanced, integrate its changes without overwriting others' work, then rerun affected checks.
- Verify the push succeeded and report the commit hash and branch. If checks, commit, or push are blocked, report the exact blocker and what remains; do not claim completion.
- Build client updates before reporting them available. For backend updates, restart only after all active turns have finished, using `scripts/restart-when-idle.mjs`; never interrupt an active conversation to deploy.

# Hosted services

- Whenever hosting a localhost app or adding a user-facing route on Codex Remote, register/update it on `/services` before handing over its URL. Include the service name, port or path, work summary, and the verified PR number/link (or explicitly no/unknown PR), plus branch/worktree when applicable. Use `npm run services -- register ...` as documented in README.md. Update the registry if a port changes ownership or a service is retired; do not silently leave stale metadata.

# Knowledge updates

- Use `npm run knowledge -- read --path ...`, then `write --path ... --file ... --revision ... --actor <conversation-id>` for maintained vault notes. Preserve the read revision; HTTP 409 means read the latest content and merge before writing again. Use an empty revision only when creating a new note.
- Keep conversation handoffs short and current-first: active objective, current status, decisions, next steps and sources. Preserve completed delivery history in an archived reference with a link.
- `/knowledge` shows note sources, versions/diffs, recent injected context and retrieval previews. Previewing context does not send a user turn or count as used context. Scope and confirmed/proposed/superseded status must remain explicit.
