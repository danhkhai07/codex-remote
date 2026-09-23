# Working hours assets

The dashboard and generator are maintained here. The OLD deployment used
`/root/VAULTS/Flint-Software/Working-Hours/`; that instance is retired. For NEW,
use the instance adapter and paths below, never the OLD generator invocation.
Never copy runtime JSON, CSV, or session records into this repository.

Daily totals no longer have confirmed/estimated categories. Saving a total records
an automatic-estimate baseline; later increases in the estimate add to the saved
value, clamped to 0–24 hours. Automatic estimates retain their existing 15-minute
refresh interval. Legacy totals retain their value at the first API read and then
continue tracking. The editor only saves a daily total; there is no confirmation
category or restore-estimate action.

The timer starts from the adjusted total and resets the estimate baseline when
stopped. The shared revision still rejects concurrent manual writes.

Checks: `npm run check` and `python3 working-hours/test-update.py`.

Explicit auto pause (2026-09-21): `pause` / `resume` use the existing authenticated,
CSRF-protected revisioned API. Missing `autoPaused` means false. Pausing stores all
current totals, closes the manual timer, and persists `pausedAt`. Resume records a
closed `pauseWindows` entry and sets `estimateSince` to the server's resume time;
it never starts a manual timer. Daily edits retain the selected pause state.

The generator now exports merged raw `activityIntervals` in milliseconds in the
private `data.json`. Both readers count only interval portions after
`estimateSince`; saved totals are checkpoints and `estimateBaselines` are relative
to that epoch. During pause no estimate delta is added. Late log discovery,
midnight crossings, repeated pause windows, and stale generated snapshots cannot
reintroduce pre-resume time. Logs before resume that were not yet present at pause
are deliberately excluded: pause freezes the displayed total, resume starts now.
Legacy generated data without raw intervals is accepted until the first explicit
pause; after it, the server safely freezes until the updated generator runs.

The source of truth for deployment is this directory, not generated `index.html`.
The existing root cron invokes the vault `update.py` every 15 minutes under
`.update.lock`; the generator also uses `.writer.lock`. Keep both locks during
source replacement/regeneration. Do not stop cron, activity tracking, or turns.
State is only written by the server and must never be copied from a build fixture.

Browser regression (after build; all requests intercepted, no listener or real
credentials):
`PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs HOURS_SCREENSHOTS=/private/output node scripts/working-hours-browser.mjs`.
Run it through `codex-heavy`. It covers the actual built `/working-hours` and
FileViewer bridges at desktop, 390 px and 320 px, including pending/double-click,
failed saves, conflicts/reload, and pause of a running manual timer.

The compact `Hôm nay` total is presentation-only. It reads the same merged daily
row as the cards and timer, remains visible while another date or chart range is
selected, and follows the Asia/Ho_Chi_Minh day boundary. A running timer updates
it from the existing split totals; pause freezes it and resume never backfills.

Rollback limitation: old continuous code does not understand pause/epoch state.
Once a user has paused or resumed, never restore the old backend/generator or an
old state backup blindly; that can add paused time and discard later edits. Prefer
a forward fix. A pre-use rollback requires verified unchanged state revision and
restores the complete matching backend + generator/template + frontend set.
# NEW remote instance dashboard

The frontend's shared `WORK_TIMER_PATH` in `src/workTimerStorage.ts` points to
`/root/.local/state/codex-remote-secure/hours/index.html`. Both WorkingHoursPage
and FileViewer use it; changing the instance location must update that single
constant together with the NEW generator `--hours` and backend
`CODEX_REMOTE_WORK_HOURS_FILE` deployment configuration. The backend API does
not currently expose its Hours file location, so this focused frontend fix
uses the confirmed NEW publication path, without a new endpoint or aliases.

The previous frontend opened OLD generated HTML but attached the NEW API
bridge. On a successful shared refresh, `applyOverrides()` discards embedded
hours and uses API totals/timer. Thus the old path did not by itself prove that
displayed totals were OLD: dates/metadata came from that document, while shared
totals and commands used NEW. Offline/standalone HTML remains a snapshot.
This correction changes no totals, pause state, timer or history in either tree.
OLD HTML can still be opened as an ordinary file, but no longer receives the
privileged timer bridge; no OLD path alias is installed.

Deployment remains coordinated with the other frontend candidates: publish
the rebuilt combined client, preserve all current backend artifacts, update
both NEW runtime `working-hours/dashboard.template.html` and isolated Hours
ROOT `dashboard.template.html`, and regenerate the derived dashboard through
the NEW adapter under existing publication/generator locks. Do not run the
original generator against OLD or copy a whole checkout into the publication.

Validation: `scripts/working-hours-browser.mjs` requires the exact NEW path
for every HTML/info request and covers pause, running timer, selected older
dates/months and midnight at +07. `scripts/working-hours-secure-browser.mjs`
uses the built app with actual login/unlock, SecureApi and HTTP file handlers;
only the exact NEW logical path is mapped to a temporary fixture file. It
checks `/working-hours` and `/files?path=...` at desktop/390/320 widths, shared
2h15m replacing embedded 99h (no double count), and unchanged paused state.
All keys/data are fake; no native/model activity or production Hours actions.
