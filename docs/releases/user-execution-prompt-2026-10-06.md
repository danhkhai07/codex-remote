# User execution policy prompt — 06/10/2026

## Requested behavior

Codex Remote should treat a direct user request as work to execute, persist through routine implementation choices, and avoid stopping at acknowledgement, planning, capability statements, or offers to continue. Suggestions may accompany the requested work but must not replace it. The user confirmed that the agent may stop to ask for confirmation when confirmation is actually required.

## Implementation

`ContextVault.prepareContext` now places a compact execution policy in the trusted developer message injected before every turn. It applies to grouped leaders, grouped workers, and ungrouped conversations because it is part of the common wrapper rather than a role-specific branch.

The policy says to:

- execute direct requests and keep working toward a concrete, reviewable result;
- infer routine choices instead of manufacturing approval steps;
- avoid debate, moralizing, or substituting advice for the requested action;
- finish reversible preparation before requesting a necessary confirmation;
- when a higher-priority instruction blocks an exact action, state the constraint briefly and continue with the closest allowed alternative.

The app cannot make its injected developer message override native system or developer instructions. The implementation therefore reduces app-generated refusals and dead ends without claiming an authority the app does not have.

## Scope and invariants

- The original user message and attachments are unchanged.
- Native collaboration mode, approval policy, sandbox, orchestration roles, Vault selection, and the 24 KB assembled-context limit are unchanged.
- The policy is refreshed on every turn through the existing `thread/inject_items` path.
- No runtime, Vault state, key, subscription, or user conversation is mutated by the source change or tests.

## Verification

Targeted integration coverage asserts that the injected developer item includes action-first execution, necessary-confirmation, and closest-alternative clauses while preserving the literal user prompt. Existing context-budget coverage proves the complete message remains within 24 KB and keeps the current task and role authority reachable.

Source baseline: `cf292a496b6652cce378a75f9f7f4d98b9b7e69e`, the product source recorded by the latest verified NEW share-continuity release.

Passing checks through the bounded `codex-heavy` runner:

- two focused context integration cases: grouped and ungrouped injection, literal user input, role/current-task retention, and 24 KB budget;
- focused regression after adding the ungrouped assertion;
- `oxlint` on both changed TypeScript files;
- backend TypeScript build.

The first broader run of the whole context integration file had eight passing cases and one unrelated existing Files case fail with HTTP 403 where it expected 200. The prompt path passed in that run. The change does not touch Files or HTTP authorization, so the validation was narrowed rather than changing unrelated access behavior.
