# Answer-content push candidate

Task 378b37ef-b834-4a2f-a87b-6b8fb5b67991. User explicitly supersedes the earlier metadata-only policy: title is only the conversation name; body is its final assistant answer. No group/Leader/app prefix. Unnamed title: `Cuộc hội thoại`. Empty/unclassified answer: generic completion, never progress or another turn's answer.

Source baseline b67d1dc817658b36102c156694b2eeb98e1626e3 (ec8638f lineage). Dedicated worktree `/root/WORKTREES/cr-push-answer-content`, branch `fix/push-answer-content`. Previous release status is actually complete at 2026-09-23T14:20:43.191Z; do not use old Vault ARMED status. Every previous manifest payload file still matched NEW during this task's read-only comparison. Hours template remains 703ad317215c7b1b9e7059169c1613d0128cb2a0d993a94e601f33e352e06df0.

## Behavior

- Controller selects only completed `agentMessage` items with explicit `phase: final_answer`, scoped to exact thread/turn. Turn payload is preferred, then captured completed items. Unclassified messages/deltas/plans/tools/commentary never become push body. Existing orchestration answer extraction is unchanged.
- Strip common Markdown headings, fences, links, bold and inline-code delimiters; normalize whitespace/control/bidi characters. Text is displayed literally, never interpreted as HTML. JSON-escaped UTF-8 body budget is 2200 bytes plus ellipsis, leaving room for bounded metadata and encryption under Web Push size limits. Unicode code points are not split at the payload boundary.
- Store body alongside the same completion's metadata/tag. Retry/restart and in-flight coalescing preserve that snapshot. Restore revalidates bounds without reinterpreting Markdown. Legacy queued entries have no answer and stay generic.
- SW title is sanitized convo name only. Body uses authorized payload with bounded defensive validation. Click target, gate/unlock, draft handling, foreground suppression, ownership/expiry/revocation and native scheduling are unchanged.
- No literal “From Codex Remote” exists in the notification formatter. Previous app-controlled group/Leader title is removed. Manifest still identifies the app (`Codex Remote Control`, short name `Codex Remote`). A separate source/app label displayed by the OS/browser is not a title/body field controlled by this formatter; physical-device attribution has not been inspected or tested. Do not rename the entire installed app to hide it.

## Verification status: BLOCKED, not passed

`git diff --check` passed. Authored regression coverage for exact-turn/final-only extraction, empty/malformed content, UTF-8/JSON size, retry/restart/coalesced answer snapshots and SW title/body, while retaining navigation/ownership tests. Browser fixture additionally intercepts actual worker display for leader/nonleader; all credentials/native RPCs are fake and no OS push is sent.

Attempted `codex-heavy --label push-answer-full-check -- env TMPDIR=/tmp npm run check`; the sandbox rejected the runner's `/var/log/codex-heavy/...service.json` write with EROFS before tests/build. Do not run heavy commands outside that required runner as a workaround. No current app/build/browser/runner checks are claimed passed. No candidate dist, deployable package, fresh seal, screenshots or runtime changes were produced.

Knowledge revision-checked CLI read failed `connect EPERM 127.0.0.1:5174`, so the maintained Vault correction remains pending. A draft outside Vault is retained for leader to merge with a fresh CLI revision. This session does not expose a trustworthy actual model/effort receipt; no model/effort claim is inferred from prior task instructions.

## Complete checks and prepare (leader environment)

After reviewing/committing any fixes, link the existing dependency directory if needed and run from the candidate worktree:

```sh
codex-heavy --label push-answer-candidate -- env TMPDIR=/tmp /usr/local/bin/node scripts/push-release/check-candidate.mjs /tmp/push-answer-evidence
```

This sequential job runs full npm check, real fake-HTTP/encrypted browser fixture (desktop/mobile), existing fake deployment/readiness tests and runner syntax. Only on success does it write hash-bound `candidate.json`. It also checks the previous LIVE payload has not drifted. No publication is performed. Screenshots and logs remain in the supplied evidence directory. Dependency links must not be committed.

Then prepare a fresh private package (these commands do not arm/apply):

```sh
node scripts/push-release/deploy.mjs prepare /root/.local/state/codex-remote-secure/releases/push-browser-answer-378b37ef /root/WORKTREES/cr-push-answer-content /tmp/push-answer-evidence/candidate.json
node /root/.local/state/codex-remote-secure/releases/push-browser-answer-378b37ef/deploy.mjs baseline /root/.local/state/codex-remote-secure/releases/push-browser-answer-378b37ef /root/.local/state/codex-remote-secure/releases/hours-chart-669d66d4/LIVE.json
node /root/.local/state/codex-remote-secure/releases/push-browser-answer-378b37ef/deploy.mjs check /root/.local/state/codex-remote-secure/releases/push-browser-answer-378b37ef
```

Leader reviews candidate checks, manifest/seal and current baseline before separately activating. Runner still allows only controller/index/push JS/maps plus matching complete client/SW; it preserves Hours backend/template/state and all other runtime modules. Publication keeps the established lock/drift/code-only backup/encrypted ALL-idle (including queued own tasks)/single NEW restart/health and Files/Hours verification. No mutable state/key/VAPID/subscription restore. OLD remains disabled. Never reuse the completed prior release directory. A backend restart and client SW activation will be required eventually; this task has done neither.
