# LIVE Vault retrieval audit — 2026-09-26

Audit only. No product change, deployment, native/model turn, real transcript read,
or task/state rewrite. This does **not** establish the cause of every reported
instance of forgetting. The leader separately examines real note contents and
trace `c2d2e4fb-e9c0-480f-94e7-552af0621f22`; this report does not reuse that trace.

## Exact code and evidence

- Source base: `4ee45dbd559c9c975a0c26fb1fb2d2af3d3920a0` (latest verified LIVE
  frontend, backend inherited from `d6990d3`). Worktree `cr-vault-retrieval-audit`.
- Runtime: `/root/RUNNING-SERVICES/codex-remote-secure/dist-server`; gateway
  PID `2937958`. Runtime is a publication directory, not a Git checkout.
- Probe emits **only in memory**, then requires byte equality for JS **and maps**
  of knowledge-context, context-vault, knowledge-store, knowledge-metadata,
  knowledge-vault, vault-files, controller, orchestration, http-app and index:
  **20/20 exact**, including map bytes. Maps reference `../server/*.ts` and do
  not embed sourcesContent; source identity is established by exact re-emission,
  not by trusting those path strings.
- It imports installed modules but gives every store/controller a disposable
  directory and fake native driver; does not load production config or Vault.
- Private receipts: `/root/.local/state/codex-remote-secure/reviews/vault-retrieval-f1371177/`:
  `probe-final.json` (module hashes, 17 characterization controls), `check.log`
  (29 existing tests), `links-check.log` (final probe + lint); prior budget-check.log retained.
- Actual task receipt: `gpt-6-astra`, `xhigh`, Full Access. No model override.

## What actually reaches the model

| Stage | Observed behavior | Source / matching runtime JS lines |
| --- | --- | --- |
| New thread | `thread/start` creates native thread; creation alone does not select/inject notes. | controller.ts:303 / controller.js:306 |
| Resume/open | `thread/read` metadata and `thread/resume(excludeTurns:true)`; resume alone does not inject Vault. Existing native history remains native. | controller.ts:416 / controller.js:427 |
| New user turn | Lock/busy/access checks; resolve model/skills and resume if needed; pass **current submitted text + cwd** to prepareContext. Attachments' contents and full previous chat are not retrieval queries. | controller.ts:489,535,562 / controller.js:517,580,612 |
| Worker delegation/result wakeup | Scheduler constructs Task-ID/title/instruction text, or notice/report text. Both enter the same controller startTurn and get a **fresh worker/leader-specific** selection, not a copy of the leader's selected notes. | orchestration.ts:614,659; controller.ts:87 / orchestration.js:747,821; controller.js:70 |
| Group/title | previewContext reads current group assignment and stored thread name/cwd from Vault metadata. Name contributes to **note ranking**, but excerpt ranking uses submitted text alone. | context-vault.ts:212; knowledge-context.ts:51,131 / context-vault.js:259; knowledge-context.js:51,166 |
| Selection | Read maintained note files; rank and excerpt; append static workflow/orientation and current role context. | context-vault.ts:224 / context-vault.js:270 |
| Native injection | `thread/inject_items` with a **developer message**, separate from original user input. Wrapper says note contents are background, current user instructions win, and this snapshot supersedes older ones. | controller.ts:559–570 / controller.js:609–621 |
| Trace/start | Await inject acknowledgement, record trace, then `turn/start`. Trace lacks native turn ID, start outcome and model-read acknowledgement. | controller.ts:568–590 / controller.js:619–642 |
| Steering/continued work | This web app's send UI rejects while active; no `turn/steer` path exists in the reviewed app. Native/external steering, tool loops, and native automatic continuations do not pass the gateway's prepareContext again. | App.tsx:1489–1499; no turn/steer dispatcher in server/src |

The last row is a code-path boundary, not a test of native compaction or a promise
that all native clients behave identically. Reopening a thread and beginning a
new turn are different actions. Editing a note during a running turn does not
push it into that turn; the agent can explicitly read the current file/CLI.

## Retrieval algorithm and true limits

`knowledge-context.ts:5–141` / runtime `knowledge-context.js:3–174`:

1. **Lexical, no embeddings/semantic search/model call.** Fold Vietnamese accents,
   lowercase, ASCII alphanumeric terms, drop one-character/common words. Title,
   path and alias exact term matches get 6 each; body substring matches add at
   most 8. Cwd/repository match adds25; group scope substring match adds12.
   Ordinary candidates need score≥6. Generic “tiếp tục” may leave little query.
2. Shared Context → current conversation handoff → Profile Context → current group
   Context → **all** confirmed/global Profile notes are added first. Topic notes
   are sorted by relevance/path and only top8 added. Index is last. Other
   conversation handoffs are scanned but not automatically selected.
3. Initial caps: shared5000, handoff4500, profile1800, group2000, each global
   preference3000, ranked topic4000, link-only topic2500, map1400 bytes.
   These are **not hard per-note maxima**: unused allocation expands earlier
   notes in priority order. Allocation reserves estimated note body+300, not
   measured useful excerpt, so unused rendered space is not redistributed again.
4. `[[wiki links]]` from initially selected orientation/handoff/global notes can
   boost already-scored topics by8. Shared/handoff/group links can admit a topic
   with score10 even without keyword relevance. No recursive graph traversal,
   no ordinary Markdown links, no automatic source transcript fetch. Anchors
   are stripped for note selection; they do not force the named section.
   Frontmatter `related` wiki syntax can be seen by the same textual matcher.
5. Split at blank lines, carry only latest heading, score each paragraph. For
   **handoff only**, current/next heading adds30 and a date contributes ~2.026;
   selected blocks stay score-ordered. Other notes restore source paragraph
   order after selection. This is not structural Markdown section parsing.
6. **24,000 UTF-8 bytes** covers rendered note snippets, each source/status/scope
   header, truncation markers and separators. It excludes wrapper/workflow,
   orchestration context, user text, attachments and existing native history.
   The small fake controller example uses 2,416 excerpt bytes but injects7,867
   bytes including wrapper/role. A separate dense fixture proves the Vault
   message itself can exceed24,000 while excerpts remain within budget: 23,303 excerpt bytes → 28,202 Vault
   message bytes, before role context. See
   `probe-final.json` for exact measured totals and synthetic path-dependent
   wrapper sizes. It is not a total prompt/token/context-window guarantee.
7. File scan reads maintained Markdown recursively in the seven topic folders,
   designated control files and group/conversation Context files. Source exports
   and generated indexes are excluded except the separately supplied Index.
   Each note is limited to256,000 bytes; no aggregate candidate-count/byte cap.

## Findings and minimal next fixes (not implemented)

All reproductions below ran against **installed JS**, with synthetic notes.
Priority is retrieval correctness/workflow impact, not a security severity claim.

### V1 — P2: obsolete section body remains eligible

Runtime `knowledge-context.js:11–22` (source :15–26). Input:
`## Superseded`, blank line, `OLD_SECTION_RULE`, blank line, `## Current`,
`CURRENT_RULE`. Ordinary query excludes the obsolete heading but includes its
body and even prepends `### Superseded` back onto it. Control: whole-note
`status: superseded` and a single `**Superseded:** INLINE_OLD_RULE` are excluded.

Minimal fix: carry section status through descendants until the next sibling or
ancestor heading; preserve hierarchy/source span. Acceptance: excluded section
children/subheadings stay excluded while current siblings remain, unless an
explicit history request asks for that historical evidence.

The separate `historical()` matcher (`.js:7`) enables old guidance for **any**
submitted text containing `history`, including “fix history API”. Test confirms
this behavior; distinguish historical-policy requests from code-topic words,
or label selected historical evidence explicitly instead of treating one global
substring match as permission to mix all obsolete guidance.

### V2 — P2: a selected rule note can contain no rule content

Runtime `knowledge-context.js:32–46` (source :34–47). Input `# Rules` followed by
a 30KB single paragraph. Title fits; paragraph doesn't; `if (!text)` fallback is
disabled by the title. Result: **150-byte** excerpt with source metadata, title
and capped marker; no `IMPORTANT_CONTENT` from the paragraph, despite24KB budget.
This is not loss from disk. “Source selected” is a weak measure of useful recall.

Minimal fix: reserve a meaningful content excerpt when selected paragraphs don't
fit, with explicit source ranges and truncation; avoid accepting a heading-only
selection as useful. Acceptance: at least a bounded meaningful paragraph prefix
is present, Unicode remains valid, and the total budget still holds.

### V3 — P2: budget and diagnostics can silently lose relevant topics

Runtime `knowledge-context.js:76–78,140–158`; `knowledge-store.js:81–124`
(source knowledge-context.ts:68,109–123; knowledge-store.ts:66–92).
Nine confirmed/global3.5KB Profile notes consume allocation; the directly
matched project and Index are omitted. Bodies larger than per-note allocation
can then be skipped, wasting most of that reserved space. Mandatory candidates
are prioritizations, not guaranteed useful content or minimum topic/map room.

A separate >256KB note appears in Knowledge issues, but is removed before the
retrieval selector sees it: it appears in **neither snippets nor trace.omitted**.
This prevents a trace-only reader explaining why it was absent.

Minimal fixes: reserve a small relevant-topic/map allowance, redistribute actual
unused rendered bytes, and pass oversized/invalid candidate reasons to trace.
Acceptance: budget conflict fixture retains essential rules plus meaningful
project context or explicitly records why not; oversized note has a trace reason.

### V4 — P2: repeated links amplify relevance and displace another topic

Runtime `knowledge-context.js:116–132` (source :93–101). Eight strong topic
matches beat a link-only note (score10). Repeat the **same target link three
times in one Shared note**: score becomes26 through +8 per occurrence; it now
wins and evicts one strong topic from the top8. Synthetic probe confirms the
membership change, independently of the leader's real trace inspection.

Minimal fix: deduplicate targets per source note before applying the link boost;
consider a cap across sources. Acceptance: repeated text/aliases/anchor links to
one target in one source don't change score or top8 membership. Multiple distinct
sources can still count according to an explicit policy.

### V5 — P2: physical worktree layout can defeat repository relevance

Runtime `knowledge-context.js:8,96` (source :11,82). `/repo/alpha-worktrees/task`
maps to `/repo/alpha`, but `/root/WORKTREES/cr-task` does not. Identical repository
note, generic query: first selects it, second doesn't. This app uses separately
located worktrees, so “repository/worktree match” is narrower than its label.
Do not assume this explains any particular live trace without its cwd evidence.

Minimal fix: supply validated repository identity from the trusted workspace
metadata, or maintain explicit repository aliases. Acceptance: both common Git
worktree layouts match while unrelated repositories stay separate. No arbitrary
shell invocation per note needed.

### V6 — P3: excerpts rewrite visual structure; current-first is a heuristic

Runtime `knowledge-context.js:23–42` (source :27–43). A single `## Current status`
heading with two paragraphs becomes **three** occurrences in the excerpt; the
current paragraph is emitted before the original document title in handoff mode.
A forty-term overlap in an old block outranks the +30 current bonus. Dates in
paragraph text are neither a reliable last-update order nor authority.

Minimal fix: rank structured sections for selection, then render each heading
once with explicit provenance/order; reserve actual current summary when one is
designated. Acceptance: no fabricated duplicate heading, source order/current
summary policy is explicit, old keyword-heavy blocks cannot crowd it out.

### V7 — P3: trace identifies injection, not successful turn/use

Runtime `controller.js:614–625`, `knowledge-store.js:224–232` (source :564–572,
store:172–181). Fake native acknowledges injection and rejects turn/start:
trace remains. Rejected injection leaves no new trace and prevents turn/start.
Retry prepares/injects a new snapshot; no RPC idempotent rollback removes the
old accepted injection. Trace stores full snippets/revisions and first500 UTF-16
characters of task, but no turn ID/success/usage. Only **100 traces globally**,
so101 injections can evict the sole trace for another conversation.

Minimal fix: distinguish prepared/injected/start-accepted states, associate the
accepted turn ID, retain bounded per-thread diagnostics, and keep model usage
unproven. Do not retry an ambiguous native start just to improve trace fidelity.

## Freshness, transcript export, versioning and model responsibilities

- Retrieval has **no note-content cache**: each prepare/preview calls documents
  and reads current files. Synthetic edit appears on the next call without
  waiting30s. The30s timer (`index.ts:32–38` / runtime :30–39) observes external
  edits/deletions for version history, not prompt refresh. It runs also at boot.
- Generated export (`context-vault.ts:247–323` / runtime :291–385) saves observed
  user/assistant text, not tools/developer messages, merges partial reads, never
  replaces complete text with shorter clipped text, and regenerates indexes.
  Completion attempts a full native thread read in the background
  (`controller.ts:181–200,703–708` / runtime :177–203,763–770), catches failure,
  while completed-item events preserve available messages. This can be incomplete;
  it is not native history itself and does not automatically create topic notes.
  No actual full-history request was made during this audit. RPC timeout60s and
 32MB message check are transport behavior, not a retrieval/recall guarantee.
- `KnowledgeStore.save` checks SHA256 content revision immediately before atomic
  replacement in one synchronous gateway writer (`.ts:118–130` / `.js:160–174`).
  Proven stale API writer gets409; fresh write preserves observed versions.
  External/Obsidian/direct filesystem writers are not transactional with this
  check. Two unobserved direct writes retain only the later one at next scan;
  tested. No guarantee of off-machine backup, semantic merge or cross-process CAS.
- `supersedes`, duplicate decision keys and old `updated` fields cause issues in
  snapshot; they do **not** automatically rewrite the old note/status or settle
  contradictory claims (`knowledge-store.ts:97–114` / `.js:133–155`). Synthetic
  old+new confirmed notes both remain eligible until status/content is maintained.
- Readable source revisions don't ensure the agent follows them. The wrapper
  instructs read-more, explicit conflicts and note maintenance; no backend gate
  enforces read-all-selected, reread-before-answer, or useful knowledge capture
  before completion/archive. Orchestration explicitly says note-save verification
  is the workflow's responsibility. Agents need concise current handoffs, explicit
  scopes/status, meaningful aliases/links and checked merges; overgrown historical
  handoffs amplify the code limits rather than curing them.
- On scan/parse/injection/trace-write failure, startTurn propagates the error;
  no automatic “send with stale cached knowledge” fallback was found. Export and
  periodic observation errors are logged/caught separately. Preview does regenerate
  indexes/observe versions, but does not send a native turn or add an injection
  trace. No claim of a completely side-effect-free preview.

## Verification and boundary

Through codex-heavy sequential1worker: 17 installed-module characterization
controls; 29 existing tests in knowledge-context/store/integration and context-vault/
integration; focused oxlint zero errors/warnings. No full app suite needed for
report/probe-only work. Unit `codex-heavy-6d0b69fcb5ef4d288b5ccd4011155492.service`
ran first probe+29tests; final budget/link probe receipt is in links-check.log.

Reproduce from this worktree (temporary Vaults are deleted):

```sh
codex-heavy --label vault-retrieval-audit --timeout 240 -- \
  node scripts/vault-retrieval-audit.mjs \
  /root/RUNNING-SERVICES/codex-remote-secure/dist-server /tmp/vault-audit.json
```

This exact-source probe aborts on runtime/source drift. Passing characterization
means the documented behavior was reproduced, **not** that the defects are fixed.
No product implementation, runtime artifact, configuration, native transcript,
Hours, owner key or production task was changed. Only this report/probe and
authorized checked Vault reference/self-handoff are delivered. Leader retains
the decision on prioritized fixes; none are described as live.
