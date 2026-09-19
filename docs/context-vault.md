# Shared knowledge vault

Codex Remote uses an Obsidian vault to accumulate the user's information, intentions, preferences, reusable patterns, ideas, projects, and decisions across conversations. The default location is `~/VAULTS/Codex-Context` (`/root/VAULTS/Codex-Context` on this server); `CODEX_REMOTE_CONTEXT_VAULT` selects another absolute location.

Open that folder as a vault in Obsidian and start at `00_Home.md`. The vault contains Markdown notes, YAML properties, internal links, templates, and a minimal `.obsidian` configuration. It needs no community plugin. Obsidian supports both [wikilinks and Markdown internal links](https://obsidian.md/help/links), with [properties stored in YAML frontmatter](https://obsidian.md/help/properties).

```text
Codex-Context/
├── 00_Home.md             # Human-maintained entry point
├── Index.md               # Generated map of topic notes and groups
├── Profile/               # User facts, preferences, and constraints
├── Patterns/              # Reusable approaches and observed patterns
├── Projects/              # Goals, requirements, and domain understanding
├── Ideas/                 # Ideas, motivation, and open questions
├── Decisions/             # Decisions, rationale, and superseded choices
├── References/            # Useful information and authoritative sources
├── Inbox/                 # Observations that need clarification or a home
├── Templates/             # Knowledge, pattern, idea, and decision templates
├── Shared/Context.md      # Concise common orientation and links
├── Groups/<id>/Context.md # Knowledge links and scope for a conversation group
├── Conversations/<id>/    # Short task handoff and generated source history
├── Sources.md             # Generated index of source conversations
└── .obsidian/             # Obsidian preferences (existing settings preserved)
```

## Read and capture knowledge

Before each turn, Codex receives the capture workflow plus bounded excerpts of the shared orientation, profile summary, knowledge map, group context, and task handoff. The note excerpts total at most 24 KB; workflow instructions and paths add overhead. Detailed topic notes and source transcripts are read from disk when relevant. This keeps the entire historical archive out of the prompt.

The workflow instructs Codex to read relevant existing knowledge at task start and update topic notes before finishing a substantive task that establishes reusable knowledge, or whenever the user asks it to remember something. It should merge into the existing subject note, link related topics and its source conversation, and record scope and date. An explicit user decision is `confirmed`; an inferred recurring pattern is `observed`; an idea remains `proposed` until decided. Corrections supersede old knowledge. Routine acknowledgements and transient status messages need no new note.

This capture is performed by the active Codex agent with its file tools. Exporting a transcript does not itself extract knowledge, and the gateway does not start extra model turns to summarize every message. Existing histories are evidence for deliberate distillation, not automatically confirmed facts. A group's Context.md connects its relevant project and topic notes; detailed knowledge lives independently of conversation membership.

The agent can write topic folders even in workspace-write mode. The application refreshes the topic map before each turn, preserving human-written notes, source histories, assignments, and Obsidian settings. It only regenerates designated indexes and source exports. Deleting a conversation folder retains its context on disk.

`Knowledge-Workflow.md` documents the note lifecycle and `Templates/` provides note shapes. Keep `Profile/Context.md` and `Shared/Context.md` short because they are read each turn. Read before editing, merge concurrent updates, and cite source evidence. Avoid copying secrets or treating assistant suggestions as user decisions.

## Import existing conversations

Build the server, then run the importer from the repository directory:

```sh
npm run build:server
node --env-file-if-exists=.env scripts/import-context-vault.mjs
```

The importer starts its own Codex app-server client. It only lists and reads existing threads; it does not restart the running gateway, resume conversations, or submit model turns. It paginates both active and archived threads in the configured workspace roots, processing one thread at a time. Rerunning it merges exports by turn and message ID and preserves existing context notes.

For a small initial check or a different vault location:

```sh
node --env-file-if-exists=.env scripts/import-context-vault.mjs --limit 2 --vault /absolute/path/to/vault
```

The importer first requests the full thread history. If persisted history cannot be read through the API, it tries the explicit rollout path returned by Codex metadata. This fallback only reads JSONL files inside the configured Codex home's `sessions` or `archived_sessions` directories and checks the session ID and workspace. It exports recognized user and assistant messages, excluding tool output, reasoning, system/developer messages, and compaction records. It does not fetch paths or links mentioned in conversation text.

Import progress and any failed thread IDs are recorded in `<vault>/.state/import-status.json`, without transcript text. `complete` means all listed histories were available, `limited` means the requested limit was reached, and `partial` reports missing histories or errors. Unavailable histories still receive a metadata entry. A partial import exits with status 1; inspect the report before assuming all old context was recovered. Original Codex rollouts remain unchanged.
