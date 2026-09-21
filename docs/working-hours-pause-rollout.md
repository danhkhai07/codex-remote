# Working hours pause: review and isolated rollout

Task `54af600c-9470-40d3-b69a-e18bf520cce4`, branch
`feat/working-hours-pause`, based on main `25e43c7`. NOT deployed by the worker.
The two continuous-estimation baseline commits were imported separately from
`b3c051a` / `3d3bec9`; this prevents main's older source overwriting the live
continuous behavior. The separate test-runner fix matches `d3471a0`.

## Exact install scope

- Backend: **only** `dist-server/work-hours.js`, `dist-server/work-hours.js.map`.
- Client: built `dist` assets, with `index.html` switched last; retain old hashed
  assets for open tabs. This updates both allowed dashboard message bridges.
- Vault sources: `working-hours/update.py` and `dashboard.template.html` into
  `/root/VAULTS/Flint-Software/Working-Hours/`.
- Generator-owned outputs: `data.json`, `index.html`, `daily-hours.csv`,
  `confirmed-hours.csv`, `Daily-Log.md` only through the actual generator.
  Do not install fixture outputs or overwrite `working-hours-state.json`, its
  backup, settings, manual revision history, or session files.
- No other backend module, API router, security module, controller or scheduler
  changes. No new route/service is required; update existing Working Hours
  `/services` metadata after verified publication. Browser fixtures intercept all
  requests without listening on a port, so they do not create hosted services.

Runtime work-hours.js before this feature:
`a9a74ac46cd4c72b5ff350188d3edf648d8b4ffe2a5fbf4a494f68fab691bd91`.
Candidate compiled work-hours.js:
`b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93`.
The prepared release manifest pins both modules/maps, client tree, source files,
and excluded runtime modules. A new build must refresh its own manifest/seal.
Never modify an old security release seal to accept this change. Security and
other candidates must integrate the continuous baseline plus this feature, then
prepare a new release which preserves this NEW runtime hash.

## Activation by leader after review

1. Verify pushed candidate, review diff and tests. Integrate source into main
   under the leader's merge authorization. If main/client/runtime moved, reconcile
   and stage a new candidate; never overwrite intervening security/client work.
2. Pin source commit, current backend PID/start, complete runtime and client
   hashes, cron command and vault source hashes in a NEW ALL-idle deployment
   runner. Use two complete idle/zero-pending checks; recheck these baselines
   immediately before installation. No active-turn interruption.
3. Under `.update.lock` then `.writer.lock`, take a fresh root-only backup of the
   vault source/output files and authoritative state + `.backup` (if present).
   Record state revision privately, then release both locks before waiting for
   restart. Never print data or commit it to Git. The
   preparation snapshot is evidence only, not the rollback database.
4. Install only the two backend artifacts with atomic renames. Invoke the stock
   `scripts/restart-when-idle.mjs` from the production checkout in the separate
   ALL-idle watcher; verify a fresh healthy gateway process. This IS a backend
   change; disk copy alone does not load the new class.
5. Atomically install candidate template and generator after reacquiring both locks and checking source drift,
   then release `.writer.lock` before running `update.py` (it takes this lock
   itself). Keep the outer `.update.lock` until generation completes, so cron
   cannot race. Run the scan with `codex-heavy`, preserve the existing 15-minute
   schedule, and never call pause/resume/start/stop during deployment. Generation
   reads state and only writes its own exports.
6. Publish the tested client assets; switch index last. Retain old hashed assets.
   Verify local/public HTML and entry asset hashes, sandbox frames and the new
   button in `/working-hours` and the fixed-path FileViewer. A read-only GET of
   shared state must retain the pre-install pause value (legacy missing=false),
   revision, timer and totals. Natural estimate increases are not a failed check.
7. Verify the new work-hours module/map hashes and every excluded backend hash,
   process identity/health, generated source/output identities and Services.
   Mark complete only after all checks. End the leader turn to let idle occur.

Existing open tabs must reload the application to obtain the updated bridge.
An old tab's bridge rejects pause/resume rather than silently changing data.
The backend still accepts old timer/edit commands while enforcing paused state.

## Rollback

Before the first user pause/resume, verify state revision has not changed since
backup; restore matched module/map, client entry and vault source/output backups
with the same locks/idle watcher. Keep old and new hashed assets. Do not roll back
other runtime modules or restore the whole `dist-server` directory.

After a user pause/resume, the old continuous module/generator cannot interpret
`estimateSince` and would re-add paused time. Preserve the current authoritative
state and prefer a forward fix. A database restore would lose later edits and
needs explicit recovery review; it is not an automatic rollback. If partial
publication fails, hide/revert the client entry while retaining the compatible
pause-aware backend and generator. Never simulate pause by stopping cron/agents.

## Validation

`codex-heavy --label work-hours-pause-check -- bash -c 'VITEST_MAX_WORKERS=1 npm run check && python3 working-hours/test-update.py'`

The browser script uses the actual built page and FileViewer with a real store in
an isolated temporary directory, fake time, and all network requests intercepted.
It never contacts production and never starts a model turn. Run after build via
`codex-heavy`, setting `PLAYWRIGHT_MODULE` and optional `HOURS_SCREENSHOTS` inside
the command. Evidence and final commit are in the prepared stage manifest.
