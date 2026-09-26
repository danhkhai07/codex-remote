# Preview share manager UI — 2026-09-27

Status: candidate, not deployed.

- Base: `177e812c2f9b441f201bbdba365a252fdba63cf3`
- Initial product commit: `21295af2ab1572e71080895fc9c69bf038f34414`
- Race/lifecycle follow-up: `d013900aef4df7e570c549dc1fa61e477961deff`
- Branch/worktree: `feat/preview-share-ui`, `/root/WORKTREES/cr-preview-share-ui`
- Scope: client source, client API adapter, focused tests and isolated browser fixture. No server source changed.

## Behavior

The existing sidebar settings menu now opens an accessible `Link chia sẻ` dialog. It lazily loads the owner-only list, offers only server-supplied services, defaults to one hour, and limits choices to 15 minutes, 1 hour, 6 hours or 24 hours. Active links support copy, open and early revoke; expired, revoked and unavailable links remain in a collapsed history section.

Create and revoke operations have synchronous in-memory locks as well as disabled pending controls. Closing the dialog aborts pending reads and mutations. Secure transport still owns lock/session cancellation. The countdown advances from `serverNow` without background API polling, and a locally elapsed active link moves into closed history.

List reads capture the current popup lifetime and mutation revision. A response started before or during create/revoke cannot replace the successful local result, and refresh/retry cannot start while a mutation is pending. Every dialog effect setup owns a fresh lifetime controller, so React development StrictMode cleanup cannot leave the next setup permanently aborted. Post-await create, revoke, copy and list callbacks also verify that the same dialog lifetime is still current before updating UI.

The optional opening path now follows the backend's exact 1,024 UTF-8 byte limit. The UI reports byte usage and blocks an oversized value without truncating it; the backend remains authoritative for all path syntax and service checks.

The dialog uses the existing panel, button and typography language. Native dialog semantics provide modal focus handling and Escape; cleanup returns focus to the settings trigger. At 520px and below fields and link actions stack without document overflow. The conversation draft and reading position are not touched.

## API boundary

The client implements the agreed contract only:

- `GET /api/preview-shares`
- `POST /api/preview-shares` with `{port,path?,label?,ttlSeconds}` and the existing CSRF header
- `DELETE /api/preview-shares/:id` with the existing CSRF header

The popup cannot work until the matching backend endpoints are integrated. The backend remains authoritative for eligible services, path validation, the 24-hour maximum, capability URLs, expiry and revocation.

## Validation

- Focused Vitest: 13/13 (`src/api.test.ts`, `src/previewShares.test.ts`), one worker.
- TypeScript project typecheck: pass.
- Focused oxlint over the four touched TypeScript/JavaScript files: 0 warnings, 0 errors.
- Production client build: pass; matching 25-file manifest SHA-256 `738d8a8174380c376717dfa0da8e631e40f82d525631427288f488fd05623021`.
- PWA validation: pass.
- Encrypted real-app browser fixture: pass at 1280, 390 and 320 px. It covers no request while collapsed, load failure/retry, stale pre-create and pre-revoke GET responses, refresh during a pending mutation, one-hour default, the UTF-8 byte boundary, disabled stopped service, double create/revoke, copy/open, collapsed history, Escape/focus return, pending-request abort, no polling, no outer overflow and retained draft/scroll. A separate development-mode run passes under the actual React StrictMode setup/cleanup rehearsal. Both fixtures create no real share or model turn.

Before the follow-up, the held pre-create GET deterministically failed because it removed the just-created row (`0 !== 1`), and the development StrictMode run timed out because the second setup reused an aborted lifetime. The same probes pass after the fix.

Initial evidence is under `/root/.local/state/codex-remote-secure/reviews/preview-share-ui-f8d92121/`; race/lifecycle evidence and screenshots are under `/root/.local/state/codex-remote-secure/reviews/preview-share-ui-race-9a9fafe8/`.

Impeccable was applied in bounded Operate mode against the incumbent interface. Its context helper was not executable in this environment (`Permission denied`), so existing project context and the skill's Operate/craft guidance were read directly before implementation.
