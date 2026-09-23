# User correction: today belongs in the activity chart

Task `669d66d4-0f75-4c0a-a36e-35bf82718d7c`. The user rejected the header chip;
that assistant-designed interpretation is superseded. Source
`27f50a75658de599158d984a2d4624468d86de9f`, based on live Hours
`7b8fd6b631d6649d84f942cc78538e20c1ea3659`, removes chip HTML/CSS/formatting
and shows today's row in the existing Daily activity chart instead.

- 7/30-day chart ranges include today and say so in the range labels.
- Today's existing axis label includes its duration; no new tag or overlay.
- All history includes today even with no history, unknown hours or known zero.
  Unknown remains striped/Unknown and is not treated as recorded zero.
- Previous calendar month remains strictly historical; today is never silently
  appended to that month's chart or total.
- Initial display, range changes and +07 day changes reveal the latest column
  on narrow scrollable charts. Ordinary refresh does not force scroll position.
- Complete-day averages and recent-day tables retain their original ranges;
  accounting, shared totals, timer, pause/resume, NEW path and spacing are unchanged.

## Validation and publication boundary

Build artifacts reused from the verified live lineage: no client/backend source
change, no rebuild or broad test suite needed. Bounded codex-heavy browser checks
passed at1280/390/320 for exact NEW routes, chart values, no chip, pause/running,
other edit date, previous month, midnight, unknown/zero/empty all-history and
complete-day averages. Actual login/unlock fixture used the real encrypted API,
HTTP file handlers and temporary WorkHoursStore; no real model or Hours actions.
The first encrypted test could not load a dependency through an old worktree
symlink; copied unchanged backend test artifacts and used rollout dependencies,
then passed. Screenshots caught today's column outside the mobile viewport;
follow-up source fixes range/day scroll positioning and equal axis label height.

Private evidence: `/root/.local/state/codex-remote-secure/reviews/hours-chart-669d66d4`.
Publication/backup/live verification:
`/root/.local/state/codex-remote-secure/releases/hours-chart-669d66d4`.

Only both NEW template destinations were published, then the unchanged NEW
adapter refreshed derived files once under `.writer.lock` and the heavy queue,
while holding the shared publication lock. Fresh complete client/backend hashes,
generator/adapter/config/key identity and service records were unchanged;
the shared Hours state file record was unchanged across publication. API GETs
during actual verification retain normal estimator synchronization semantics.
No restart, OLD write, state restore, migration, pause/resume or timer command.

Template SHA256 transitions from
`b2b5f55f45f151391e274cc8b3f20c62eab025b9bc22f094b4ec470422537b81` to
`703ad317215c7b1b9e7059169c1613d0128cb2a0d993a94e601f33e352e06df0`.
The destinations are NEW runtime `working-hours/dashboard.template.html` and
isolated `/root/.local/state/codex-remote-secure/hours/dashboard.template.html`.
Derived NEW `hours/index.html` is read dynamically; existing open dashboard frames
need a reload to receive changed HTML. Future CR1 integration must preserve this
template revision; do not restore the obsolete chip template with a client rollout.

See `LIVE.json` and `verified.json` in the private release directory for actual
public/local and encrypted Hours/Files delivery evidence and screenshots.
Chromium viewport emulation is not physical Safari verification. No absent
Hours/Files Services entry is recreated.
