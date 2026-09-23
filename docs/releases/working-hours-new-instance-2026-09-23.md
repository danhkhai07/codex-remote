# Working Hours NEW publication — 2026-09-23

**LIVE verified** on public and loopback. Deployment marker `LIVE.json` SHA256
`69f6cf0b24992698f302b421088427031071989411d2d0e1f03656461985d585`.

Task `c9f7285e-9941-4a54-a1b4-5afa4235f97f`. Product source
`7b8fd6b631d6649d84f942cc78538e20c1ea3659`, including today chip `de807078`
and shared NEW dashboard/Files bridge path `f83dd808`.
Rollout worktree `/root/WORKTREES/cr-hours-rollout`, branch
`deploy/working-hours-new-instance`. Prior live source
`9ca8c1855633135d095ddec0c8c8c90b3b5f5e5b` is an ancestor; all 25 files from
its accepted live manifest matched before publication. No concurrent frontend
changes were overwritten. The only production source delta is the Hours path
constant plus Hours template. Other differences are tests/docs.

## Publication

Evidence/backup/marker directory (root private):
`/root/.local/state/codex-remote-secure/releases/hours-c9f7285e`.

Clean lockfile install, typecheck, client build and PWA validation passed through
codex-heavy (`401aa97c3e454a549c133f920246d6c9`). An initial dependency link
was missing; no build ran in that attempt. New clean worktree dependencies
replaced the link; production dependencies were not touched.

Publication reused the reviewed cooperative deployment lock and destination
preimage/parent guards. Private backup includes the complete prior client,
both templates, and derived Hours outputs; no state DB or key payload is in
the payload or Git. The adapter was invoked once under `.writer.lock` and
the global heavy-job queue. Its ordinary refresh did not change the shared
Hours state file (exact file record compared immediately before/after).

Both template destinations now have SHA256
`b2b5f55f45f151391e274cc8b3f20c62eab025b9bc22f094b4ec470422537b81`:

- `/root/RUNNING-SERVICES/codex-remote-secure/working-hours/dashboard.template.html`
- `/root/.local/state/codex-remote-secure/hours/dashboard.template.html`

NEW derived dashboard: `/root/.local/state/codex-remote-secure/hours/index.html`.
Adapter: NEW `scripts/remote-instance/hours-update.py`, generator
`working-hours/update.py`, native NEW `native`, Hours NEW `hours` under the
isolated state root. Generator SHA remains
`c02407485a8459b2f6b66248758cd3881556e307cd5fa1938c98a0713a67b0ae`.
Template and HTTP file reads are dynamic; no service restart is required.

Client assets were added first, entry last; existing hashed assets retained.
One unchanged docx source map was reused from the accepted live build after
verifying identical corresponding JS and map version/names/mappings/source
contents; only build-location paths differed. Exact candidate and retained
client hashes are in `candidate.json` and `published.json`.

The first publication stopped after two immutable assets because the reviewed
writeJson helper uses exclusive creation and rejected a repeated journal name.
The old client entry remained active. `failure.json` preserves the exact two
assets and template writes. `resume.mjs` verified the entire original client,
exact additions, templates and invariants under a fresh shared lock, then
finished the remaining assets and entry. No generator replay, state restoration
or automatic rollback occurred. `phase-*.json` uses distinct journal names.

New entry `index-0ryuT-KQ.js`; index.html SHA256
`d9cf905637c8b9ffb8971a0431b65fddbd92acc246e51800033a5189ec07c6ab`.
NEW service PID remained `1978365`. Backend, scripts, env, key identity,
aggregate activity baseline and OLD/NEW service identities passed exact
pre/post invariant checks. Hours JS/map remain
`b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93` /
`6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8`.

## Verification and next frontend rollout

`verified.json` and `LIVE.json` record successful public/loopback byte checks of
index, main JS/CSS and worker; encrypted Files HTML preview/content match NEW
derived HTML. Actual public Hours and Files browser checks passed at 1280, 390
and 320 pixels, with today total visible and measured spacing 22/16/16 pixels.
The verification used an
owned short-lived authenticated session, encrypted HTML reads and the public
app at desktop/390/320. No real pause/resume/timer buttons are clicked. Passive
API reads retain their existing auto-estimator synchronization semantics.
The owned session was logged out and browser closed. Screenshots are
`live-hours-{1280,390,320}.png` and `live-files-{1280,390,320}.png`; these use
Chromium viewport emulation, not a physical Safari device. NEW stays active
at PID1978365, OLD inactive/disabled (PID0). No absent Hours/Files service entry
is recreated.

CR1/CR2 must integrate this source lineage and preserve both NEW Hours template
destinations. Do not redeploy a pre-Hours whole client. Source publication is
not a Git checkout switch; main and OLD are unchanged. Do not restore an Hours
state snapshot for a frontend failure. If recovery is necessary, inspect the
fresh publication state under the shared lock; fix forward or restore only
reviewed client/template bytes with compatible routing, never revert newer data.
