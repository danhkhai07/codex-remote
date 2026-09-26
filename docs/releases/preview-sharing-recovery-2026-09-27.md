# Sharing rollout recovery after a legitimate Facebook edit

Task a07d3121. Product remains 2662bb5; prepared sharing runner dcf0d4b was
attempted and failed before publication. This fix requires root's focused review
before activation because it changes an expected-content guard. No replay of that
release or earlier R2 is permitted.

## Observed cause and preservation evidence

At 2026-09-26T21:30:52.462Z the existing Services port:5211 record was updated for
the separately authorized Flint caption-icons delivery. Only its summary and
updatedAt changed. Registry SHA changed from
`ef81263ff5c837c11582d3575869a620049562c26780615a93a9d9686752b416` to
`f007146737fa737907f37fed02afba26b2f3a49bcccf8daf656d857a3fce1e71`.
The watcher detected drift and exited at 21:30:55.022Z.

Every other captured baseline field still matched: all backend/client/scripts,
env, owner-key identity, VAPID identity, Hours, both Facebook vhosts, dependency
paths, NEW PID/lifetime and OLD disabled. Status records published=false and
restarted=false; no activation backup, restart-intent, verified or LIVE marker
exists. The exact runtime/preimage comparison and failed-unit journal are kept
under `/root/.local/state/codex-remote-secure/preview-sharing-recovery-a07d3121/`.

Read-only current Flint project evidence confirms task cd2af056 added caption
icons without changing the 14 other assets/Nginx. Its HTML moved from
`03341a7b243b50604b5f0c710fd4eb678f257a8a76f8e418b490f07f844b2eae` to
`b8013cec08a3bc112659efd7d0868e1431a7f659f6c2455b63d72f90d8f015b0`.
Do not undo that valid content or Services edit.

## Focused fix

The old verifier embedded the former Facebook HTML hash. Merely taking a new
registry baseline would allow publication, then fail postverification against
that stale literal. Add the current static index hash to the sealed snapshot and
use that baseline value for the existing loopback byte verification. Every
existing snapshot guard, including the final synchronous before-copy guard,
now also detects a further caption edit while waiting. No web content is written.

No product, payload, config patch, ALL-idle policy, source timing, lock, native
state, registry migration, restart or publication-order change. core.mjs,
readiness.mjs and plan.mjs remain byte-identical to the accepted runner. One
runner file changes; two owned-filesystem workflow controls cover concurrent
caption drift before any effect and a fresh valid caption baseline. Reuse app
and browser evidence by exact hashes; no broad suite or model/share tests.

## New package and recovery boundary

Prepare a new uniquely named release with the same 12 backend + 25 client bytes,
a fresh registry and static-content baseline, and a new immutable seal. Root
reviews this guard delta before arm; task authority to arm without another review
was conditional on no guard/logic change. Do not weaken/remove the guard to force
activation. No attempted release or seal is modified.

Finalizer remains the accepted logic, with only the new private directory,
release/source/seal binding and worktree/branch metadata changed. It writes LIVE
before Services/Vault, updates only the existing app-root Services entry, and
preserves evidence on unknown outcomes. Never restore registry/grants after any
candidate startup. Root uses the supplied commands for one detached ALL-idle
attempt after review, then ends its turn. No own-task exemption or active restart.

Executed: 20/20 Node controls through sequential codex-heavy, syntax and
artifact/source/receipt closure. Read-only loopback Facebook returned current
HTML b8013cec; anonymous p5211 returned 401 and retired public URL returned 410.
All 37 payload files match the accepted dcf0d4b package byte for byte. No product
change or broad check rerun. New release/manifest/seal/check receipts and exact
commands are recorded in the private recovery delivery, not an activation claim.
