# Shared conversation context

Codex Remote keeps shared notes and exported conversation text in the configured context vault (default `/root/VAULTS/Codex-Context`). `CODEX_REMOTE_CONTEXT_VAULT` selects another absolute location.

- `Shared/Context.md` holds facts and preferences shared by every conversation.
- `Groups/<id>/Context.md` holds notes shared by conversations assigned to that folder.
- `Conversations/<id>/Context.md` holds the conversation's working notes and handoff.
- `Index.md` and the group/conversation indexes link the generated user/assistant transcripts.

Before each turn, the server supplies fresh, bounded excerpts from shared, group, and conversation notes in a separate context message. The user's message remains unchanged. Codex can read the linked files and relevant histories when it needs more detail. This shares available context without loading every conversation into each prompt.

Edit `Context.md` notes deliberately, preserving other conversations' contributions. Generated indexes, transcript exports, and `.state` are managed by the application. Deleting a folder from the UI removes the grouping but retains its notes on disk.

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
