# Vault context selection — candidate, not deployed

Task: 54920a9f-c37e-4321-af24-c10ebc7da772. Base: `37d63118520fb96280f089af4dab49a6061a88bc`.
This implements the selection findings in `docs/vault-retrieval-audit-2026-09-26.md` (audit commit `f3aa613`), without changing maintained notes implicitly, native transcripts, model context, role permissions, authentication or orchestration policy. The actual task receipt is `gpt-6-astra / high / fullAccess:true`; no model override was made.

## Selection and assembly

- A heading hierarchy excludes a superseded/archived section and all its descendants, while retaining current sibling sections. An ordinary “history API” query does not enable obsolete policy. Explicit historical-policy queries can retrieve that evidence.
- An excerpt includes useful body content, rather than claiming a heading alone is context. Oversized first paragraphs receive a UTF-8 prefix and an explicit partial marker. Source line ranges are recorded; real headings are emitted once.
- Current/next sections precede older material even when older paragraphs contain more query keywords. Retained paragraphs preserve source order within those groups.
- A link target receives at most one bonus, regardless of repeated links, aliases or anchors. Link discovery and lexical scoring use eligible sections.
- Confirmed global preferences share a 3,000-byte pool. Relevant task notes and the lookup map reserve space before that pool is spent. Notes above the existing 256 KB read limit now appear in trace omissions.
- Git worktrees resolve their actual common repository via bounded, read-only metadata and a validated worktree backlink. Conventional main/worktree layouts work regardless of sibling directory naming; unusual bare/separate-git-dir arrangements fall back to cwd matching.
- Notes use at most 16,000 UTF-8 bytes. The **entire assembled developer message** is capped at 24,000 bytes, including source labels, separators, wrapper and complete role instructions. Role authority is never truncated: if role plus mandatory wrapper alone exceeds the cap, the request fails explicitly before injection/start. Excerpt clipping is not policy enforcement; sources remain authoritative and the prompt requires reading clipped rules before acting.
- The per-turn orientation is shorter. It keeps user/scope precedence, confirmed/proposed distinctions, revision-checked merges, secret handling, generated-file restrictions and current-first handoff guidance. The full workflow remains available in maintained Vault sources.

Trace `prepared` means preview/assembly; `acknowledged` means native injection returned successfully. `execution: not-observed` is explicit even when the following turn/start fails. This does **not** assert that the model used a rule or complied with it. Existing global retention of 100 traces is unchanged.

## Native snapshot lifecycle

Installed CLI 0.155.0 schema generation and the [official app-server documentation](https://learn.chatgpt.com/docs/app-server) were checked without starting a model turn. `thread/inject_items` appends persisted model-visible items; its inspected parameters are only `threadId` and `items`. There is no selective replacement field in that schema. `thread/compact/start` targets the whole thread and is asynchronous, not a replacement operation for just Vault snapshots.

This candidate therefore keeps fresh per-turn injection but shrinks it and states that new guidance supersedes old guidance **in meaning only**. It never invokes compaction/rollback or removes prior injected items. Existing native history can still contain repeated snapshots. An explicit supported compaction workflow is a separate lifecycle change; it is not simulated with unsupported replacement or implicit pruning.

## Reproducible evidence

Private evidence: `/root/.local/state/codex-remote-secure/reviews/vault-context-54920a9f/`.
`metrics.json` contains baseline/candidate module hashes and fixed synthetic-note measurements from `scripts/vault-context-measure.mjs`. Baseline modules match the clean live-lineage source checkout and installed runtime. All figures measure assembled UTF-8 bytes, **not tokens, billing or model recall**. No private message content or real trace was copied into fixtures.

| Fixed fixture | Before | After | Coverage |
| --- | ---: | ---: | --- |
| Short current task | 7,290 | 4,275 | Active task, owner rule and role retained; obsolete body removed |
| Nine global notes plus project | 6,825 | 7,223 | Increases 398 bytes because missing task content is restored |
| Giant rule paragraph | 7,215 | 6,488 | Previously absent owner rule body now present |
| Dense paragraphs plus large role | 38,645 | 18,904 | Entire role retained; previously missing task rule restored |

The measurements deliberately retain the increase case. Reducing bytes by silently dropping relevant user rules would not satisfy this task. Dense-role measurements, exact check logs and module closure are recorded in the same evidence directory.

Checks: 115 focused tests across retrieval/store/ContextVault/controller/orchestration/secure lifecycle; server build and lint. Final selector recheck (23 passed), full typecheck, full lint and repeated metrics passed after the final optimization. Tests include actual disposable Git worktrees, superseded descendants, duplicate links, starvation, long Unicode paragraphs, current-first ordering, oversized-note diagnostics, wrapper/role budget and injection failure/turn failure distinctions. No broad model-usage audit or real model turn was performed.

## Integration boundary and limits

Minimal runtime delta: `context-vault`, `controller`, `knowledge-context`, `knowledge-store`, `knowledge-vault` and new `knowledge-repository`, each JS + source map (12 files). `knowledge-types.ts` is a source/API type change with byte-identical emitted JS/map. No client build or orchestration prompt change belongs to this candidate. Parent integration should run its required combined check once and preserve concurrent CR4 orchestration changes.

Retrieval remains lexical, not semantic. Bounded excerpts cannot guarantee every arbitrarily large user note fits; omissions and partial markers expose that limitation. Notes still need concise maintained rules and current handoffs. No claim is made that all “forgetting” was explained or fixed. No runtime/config/key/Hours/share mutation, deployment, restart or automatic compaction is part of this delivery.
