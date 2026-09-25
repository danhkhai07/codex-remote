import { constants } from 'node:fs'
import { open, mkdir, realpath, lstat, type FileHandle } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, join, relative, sep } from 'node:path'
import { setImmediate as yieldIO } from 'node:timers/promises'
import { HistoryJson, HistoryJsonSyntaxError } from './history-json.js'
import { projectPaginated } from './history-paginated.js'

export type HistoryMetadata = { id: string; cwd: string; path?: string }
export type IndexedItem = { seq: number; turn: string; status: string; id: string; type: string; data: string; start: number; end: number; clipped: number; msg: number }
type Checkpoint = { version: 3; mode: 'legacy' | 'paginated' | null; nextOrdinal: number; recordIndex: number; nextItem: number; explicit: boolean; compacted: boolean; generation: string; identity: string; offset: number; size: number; mtime: number; head: string; tail: string; turn: string | null; verified: boolean; scanned: boolean }
const obj = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const string = (value: unknown, max = 4096) => typeof value === 'string' ? value.slice(0, max) : ''
const visible = `e.suppressed=0`
const BLOCK = 64 * 1024

/** Typed projection: never null-out IDs, content arrays or renderer objects. */
export function historyItem(item: Record<string, unknown>, id: string, fallback = false): { value: Record<string, unknown>; message: boolean } {
  const raw = string(item.type, 128)
  const type = ({ UserMessage: 'userMessage', AgentMessage: 'agentMessage', CommandExecution: 'commandExecution', FileChange: 'fileChange', Plan: 'plan', McpToolCall: 'mcpToolCall', DynamicToolCall: 'dynamicToolCall' } as Record<string, string>)[raw] ?? (raw ? raw[0].toLowerCase() + raw.slice(1) : raw)
  const texts = Array.isArray(item.content) ? item.content.map(obj).filter(v => ['text', 'Text', 'input_text', 'output_text', 'inputText'].includes(String(v.type))).map(v => string(v.text, 16384)) : []
  const text = typeof item.text === 'string' ? string(item.text, 16384) : texts.join(type === 'agentMessage' ? '' : '\n').slice(0, 16384)
  const base = { id, type, ...(typeof item.status === 'string' ? { status: string(item.status, 64) } : {}) }
  if (type === 'userMessage') {
    const images = Array.isArray(item.content) ? item.content.map(obj).filter(v => ['image', 'localImage', 'Image', 'LocalImage'].includes(String(v.type))).slice(0, 16).map(() => ({ type: 'image' })) : []
    return { message: true, value: { ...base, content: [{ type: 'text', text }, ...images] } }
  }
  if (type === 'agentMessage') return { message: true, value: { ...base, text, phase: typeof item.phase === 'string' ? string(item.phase, 64) : null } }
  // Complex tool structures are represented as a bounded, always-valid summary.
  // The original JSON record remains available through authenticated ranges.
  const output = string(item.aggregatedOutput ?? item.stdout ?? item.output, 2048)
  return { message: false, value: { ...base, type: fallback ? 'historyTool' : type || 'historyTool',
    command: typeof item.command === 'string' ? string(item.command, 1024) : Array.isArray(item.command) ? item.command.slice(0, 16).map(v => string(v, 128)).join(' ') : '',
    text: type === 'plan' ? text : output || text.slice(0, 2048) || string(item.tool ?? item.name ?? item.review, 2048) || 'Bản ghi công cụ — mở chi tiết để xem đầy đủ.',
    ...(Number.isFinite(item.exitCode) ? { exitCode: item.exitCode } : {}), changes: [] } }
}

export class RolloutHistory {
  private serial: Promise<unknown> = Promise.resolve()
  private queued = 0
  readonly metrics = { indexBytes: 0, guardBytes: 0, detailBytes: 0, rebuilds: 0, records: 0, malformedRecords: 0 }
  constructor(readonly nativeHome: string, readonly directory: string) {}
  async use<T>(metadata: HistoryMetadata, live: () => void, operation: (view: HistoryView) => Promise<T> | T): Promise<T> {
    if (this.queued >= 16) throw Error('History is busy; retry shortly')
    this.queued++
    const job = this.serial.catch(() => {}).then(async () => {
      live()
      const source = await this.source(metadata)
      let db: DatabaseSync | undefined
      try {
        live()
        await mkdir(this.directory, { recursive: true, mode: 0o700 })
        const dir = await lstat(this.directory)
        if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== process.getuid?.() || (dir.mode & 0o077)) throw Error('History cache must be a private owned directory')
        const name = createHash('sha256').update(metadata.id + '\0' + metadata.cwd + '\0' + source.path).digest('hex') + '.sqlite'
        const file = join(this.directory, name)
        try { const newFile = await open(file, 'wx', 0o600); await newFile.close() } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
        const info = await lstat(file)
        if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077)) throw Error('Invalid history cache file')
        live(); db = new DatabaseSync(file)
        db.exec(`PRAGMA journal_mode=DELETE; PRAGMA cache_size=-2048; PRAGMA synchronous=FULL; PRAGMA max_page_count=32768;
          CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, status TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS entries (seq INTEGER PRIMARY KEY, turn TEXT NOT NULL, id TEXT NOT NULL, type TEXT NOT NULL, canonical INTEGER NOT NULL, msg INTEGER NOT NULL, data TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, clipped INTEGER NOT NULL, fingerprint TEXT NOT NULL, paired INTEGER NOT NULL DEFAULT 0, suppressed INTEGER NOT NULL DEFAULT 0, UNIQUE(turn,id,canonical));
          CREATE INDEX IF NOT EXISTS entries_role ON entries(turn,type,canonical,paired,fingerprint);
          CREATE INDEX IF NOT EXISTS entries_message ON entries(msg,seq);`)
        const checkpoint = await this.sync(db, source.fd, metadata, live); live()
        const view = new HistoryView(db, source.fd, checkpoint, live, this.metrics)
        const value = await operation(view); live()
        // No result from an FD that was replaced or truncated while reading.
        const after = await source.fd.stat(), path = await realpath(source.path); live()
        if (`${after.dev}:${after.ino}` !== checkpoint.identity || after.size < checkpoint.offset || (after.size === checkpoint.size && after.mtimeMs !== checkpoint.mtime) || path !== source.path) throw Error('History changed while reading; retry')
        const current = await lstat(source.path); live()
        if (current.dev !== after.dev || current.ino !== after.ino) throw Error('History rotated while reading; retry')
        return value
      } finally { try { db?.close() } finally { await source.fd.close() } }
    })
    this.serial = job
    try { return await job } finally { this.queued-- }
  }
  private async source(metadata: HistoryMetadata) {
    if (!metadata.path || !isAbsolute(metadata.path) || !metadata.path.endsWith('.jsonl')) throw Error('Native history is not persisted yet; retry shortly')
    const roots = (await Promise.all(['sessions', 'archived_sessions'].map(name => realpath(join(this.nativeHome, name)).catch(() => null)))).filter((v): v is string => Boolean(v))
    const allowed = (path: string) => roots.some(root => { const suffix = relative(root, path); return suffix && suffix !== '..' && !suffix.startsWith('..' + sep) && !isAbsolute(suffix) })
    const path = await realpath(metadata.path)
    if (!allowed(path)) throw Error('Native history is outside session storage')
    const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const stats = await fd.stat(), actual = await realpath(`/proc/self/fd/${fd.fd}`)
      if (!stats.isFile() || actual !== path || !allowed(actual)) throw Error('Invalid native history descriptor')
      return { fd, path }
    } catch (error) { await fd.close(); throw error }
  }
  private async sync(db: DatabaseSync, fd: FileHandle, metadata: HistoryMetadata, live: () => void): Promise<Checkpoint> {
    const snapshot = await fd.stat(); live()
    if (!Number.isSafeInteger(snapshot.size)) throw Error('History file is too large to index safely')
    const identity = `${snapshot.dev}:${snapshot.ino}`
    let checkpoint = JSON.parse(String((db.prepare('SELECT value FROM state WHERE id=1').get() as { value: string } | undefined)?.value ?? 'null')) as Checkpoint | null
    const digest = async (start: number, size: number) => {
      const buffer = Buffer.alloc(size); const read = await fd.read(buffer, 0, size, start); this.metrics.guardBytes += read.bytesRead; live()
      if (read.bytesRead !== size) throw Error('History truncated while indexing')
      return createHash('sha256').update(buffer).digest('hex')
    }
    let valid = checkpoint?.version === 3 && checkpoint.identity === identity && checkpoint.offset <= snapshot.size
    if (valid && checkpoint) {
      valid = checkpoint.head === await digest(0, Math.min(checkpoint.offset, 4096)) && checkpoint.tail === await digest(Math.max(0, checkpoint.offset - 4096), Math.min(checkpoint.offset, 4096))
      if (snapshot.size === checkpoint.size && snapshot.mtimeMs !== checkpoint.mtime) valid = false
    }
    if (!valid || !checkpoint) {
      this.metrics.rebuilds++
      db.exec('BEGIN IMMEDIATE; DELETE FROM entries; DELETE FROM turns; DELETE FROM state; COMMIT;')
      checkpoint = { version: 3, mode: null, nextOrdinal: 0, recordIndex: 0, nextItem: 1, explicit: false, compacted: false, generation: randomUUID(), identity, offset: 0, size: 0, mtime: 0, head: '', tail: '', turn: null, verified: false, scanned: false }
    }
    // An unchanged incomplete tail is not reparsed on every poll/detail request.
    if (checkpoint.scanned && checkpoint.size === snapshot.size && checkpoint.mtime === snapshot.mtimeMs) return checkpoint
    // Persist the reducer state at the SAME record boundary as indexed rows.
    // Legacy ThreadHistoryBuilder helpers are below; paginated records take
    // their own projector before that reducer. Never blend the two identity
    // schemes or infer a display turn from model ResponseItems/TurnContext.
    const knownTurn = (id: string) => db.prepare('SELECT status FROM turns WHERE id=?').get(id) as { status: string } | undefined
    const ensureTurn = (start: number) => {
      if (!checkpoint!.turn) {
        checkpoint!.turn = `rollout-${checkpoint!.recordIndex - 1}`
        checkpoint!.explicit = false; checkpoint!.compacted = false
        db.prepare('INSERT INTO turns VALUES(?,?,?)').run(checkpoint!.turn, start, 'completed')
      }
      return checkpoint!.turn
    }
    const closeTurn = () => { checkpoint!.turn = null; checkpoint!.explicit = false; checkpoint!.compacted = false }
    const nextId = () => `item-${checkpoint!.nextItem++}`
    const insert = db.prepare(`INSERT INTO entries(seq,turn,id,type,canonical,msg,data,start,end,clipped,fingerprint,suppressed) VALUES(?,?,?,?,1,?,?,?,?,?,'',?)
      ON CONFLICT(turn,id,canonical) DO UPDATE SET data=excluded.data,start=excluded.start,end=excluded.end,clipped=excluded.clipped,suppressed=excluded.suppressed,type=excluded.type,msg=excluded.msg`)
    const put = (item: Record<string, unknown>, id: string, turn: string, start: number, end: number, clipped: boolean, hidden = false, requireKnownTurn = true) => {
      if (requireKnownTurn && !knownTurn(turn)) return // A late lifecycle item cannot resurrect a rolled-back turn.
      if (id.length >= 4096 || !id) throw Error('Unsupported native item identity')
      const normalized = historyItem(item, id)
      const data = hidden ? '{}' : JSON.stringify(normalized.value), kind = String(normalized.value.type)
      const lossyContent = Array.isArray(item.content) && item.content.some(value => !['text', 'Text', 'input_text', 'output_text', 'inputText'].includes(String(obj(value).type)))
      const clip = clipped || lossyContent || !normalized.message || JSON.stringify(item).length > data.length + 1024 ? 1 : 0
      const prior = db.prepare('SELECT data,start,end FROM entries WHERE turn=? AND id=? AND canonical=1').get(turn, id) as { data: string; start: number; end: number } | undefined
      if (prior && (prior.data !== data || prior.start !== start || prior.end !== end)) checkpoint!.generation = randomUUID()
      insert.run(start, turn, id, kind, normalized.message && !hidden ? 1 : 0, data, start, end, clip, hidden ? 1 : 0)
    }
    const record = (row: Record<string, unknown>, start: number, end: number, clipped: boolean) => {
      this.metrics.records++; checkpoint!.recordIndex++
      const payload = obj(row.payload), type = String(row.type ?? ''), event = String(payload.type ?? '')
      if (typeof payload.turn_id === 'string' && payload.turn_id.length > 256) throw Error('Unsupported native turn identity length')
      if (!checkpoint!.verified) {
        if (type !== 'session_meta' || payload.id !== metadata.id || payload.cwd !== metadata.cwd) throw Error('Native history identity mismatch')
        if (payload.history_base != null || payload.subagent_history_start_ordinal != null) {
          throw Error('Native referenced/ordinal history requires a compatible reader; no partial history was returned')
        }
        const mode = payload.history_mode ?? 'legacy'
        if (mode !== 'legacy' && mode !== 'paginated') throw Error('Unsupported native history mode')
        checkpoint!.mode = mode
        checkpoint!.verified = true
        if (mode === 'legacy') return
      }
      if (checkpoint!.mode === 'paginated') {
        // Ordinals and byte checkpoints advance together. Fail visibly on a
        // malformed/discontinuous source; never silently renumber native rows.
        if (!Number.isSafeInteger(row.ordinal) || row.ordinal !== checkpoint!.nextOrdinal) throw Error('Paginated history ordinal mismatch; source needs native compatibility review')
        checkpoint!.nextOrdinal++
        if (type === 'session_meta') {
          if (payload.id !== metadata.id || payload.cwd !== metadata.cwd || payload.history_mode !== 'paginated' || payload.history_base != null || payload.subagent_history_start_ordinal != null) throw Error('Native history identity/mode changed')
          return
        }
        const change = projectPaginated(row, metadata.id)
        if (!change) return
        if (change.kind === 'turn') {
          // Native materialized turn rows preserve their first position and the
          // first terminal outcome. A later start/completion cannot reopen it.
          db.prepare(`INSERT INTO turns(id,seq,status) VALUES(?,?,?)
            ON CONFLICT(id) DO UPDATE SET status=excluded.status WHERE turns.status='inProgress'`).run(change.id, start, change.status)
        } else {
          // A completed review item may precede its turn lifecycle record.
          // Preserve its explicit turn ID without inventing a turn-start row.
          put(change.item, change.id, change.turn, start, end, clipped, change.hidden, false)
        }
        return
      }
      if (type === 'session_meta') { if (payload.id !== metadata.id || payload.cwd !== metadata.cwd) throw Error('Native history identity changed'); return }
      if (type === 'compacted') { ensureTurn(start); checkpoint!.compacted = true; return }
      if (type === 'response_item') {
        // Only native hook prompts are projected from ResponseItems. Ordinary
        // bootstrap/imported user context, assistant channels and tool wire data
        // are intentionally NOT a second conversation stream.
        if (event !== 'message' || payload.role !== 'user' || !Array.isArray(payload.content)) return
        const content = payload.content.map(obj)
        const hooks = content.length > 0 && content.every(value => value.type === 'input_text' && /^\s*<hook_prompt\s/.test(String(value.text)))
        if (!hooks) return
        if (clipped || !content.every(value => /^\s*<hook_prompt\s+hook_run_id=(?:"[^"<>]+"|'[^'<>]+')\s*>[^<>]*<\/hook_prompt>\s*$/.test(String(value.text)))) {
          throw Error('Unsupported native hook XML; use a compatible native history reader')
        }
        // Support the normal serialized hook XML subset; richer XML or absent
        // IDs requires native parity work. Never guess a random native identity.
        if (typeof payload.id !== 'string' || !payload.id) throw Error('Native hook prompt needs a stable identity; native compatibility check required')
        put({ type: 'historyTool', text: 'Hook prompt' }, payload.id, ensureTurn(start), start, end, true); return
      }
      if (type !== 'event_msg') return
      if (event === 'task_started' && typeof payload.turn_id === 'string') {
        closeTurn(); checkpoint!.turn = payload.turn_id; checkpoint!.explicit = true
        if (knownTurn(payload.turn_id)) throw Error('Repeated native turn identity; rebuild with compatible native reader')
        db.prepare('INSERT INTO turns VALUES(?,?,?)').run(payload.turn_id, start, 'inProgress'); return
      }
      if (event === 'thread_rolled_back') {
        if (!Number.isSafeInteger(payload.num_turns) || Number(payload.num_turns) < 0) throw Error('Invalid native rollback count')
        closeTurn()
        // Delete only derived rows, in SQL (no array proportional to history).
        db.prepare('DELETE FROM entries WHERE turn IN (SELECT id FROM turns ORDER BY seq DESC LIMIT ?)').run(Number(payload.num_turns))
        db.prepare('DELETE FROM turns WHERE id IN (SELECT id FROM turns ORDER BY seq DESC LIMIT ?)').run(Number(payload.num_turns))
        checkpoint!.nextItem = Number(db.prepare('SELECT count(*) AS n FROM entries').get()!.n) + 1
        checkpoint!.generation = randomUUID(); return
      }
      if (['task_complete', 'turn_aborted', 'task_failed'].includes(event)) {
        const exact = string(payload.turn_id, 256)
        const turn = knownTurn(exact) ? exact : checkpoint!.turn
        if (turn) {
          const prior = knownTurn(turn)!.status
          const status = event === 'turn_aborted' ? 'interrupted' : event === 'task_failed' || payload.error ? 'failed' : ['failed', 'interrupted'].includes(prior) ? prior : 'completed'
          db.prepare('UPDATE turns SET status=? WHERE id=?').run(status, turn)
          if (event !== 'turn_aborted' && turn === checkpoint!.turn) closeTurn()
        }
        return
      }
      if (event === 'error') {
        const info = payload.codex_error_info
        const kind = typeof info === 'string' ? info : Object.keys(obj(info))[0]
        if (checkpoint!.turn && !['thread_rollback_failed', 'active_turn_not_steerable', 'threadRollbackFailed', 'activeTurnNotSteerable'].includes(kind ?? '')) {
          db.prepare('UPDATE turns SET status=? WHERE id=?').run('failed', checkpoint!.turn)
        }
        return
      }
      if (event === 'user_message' || event === 'agent_message') {
        if (typeof payload.message !== 'string') throw Error('Invalid native display message')
        if (event === 'user_message' && checkpoint!.turn && !checkpoint!.explicit) {
          const empty = !db.prepare('SELECT 1 FROM entries WHERE turn=? LIMIT 1').get(checkpoint!.turn)
          if (!(checkpoint!.compacted && empty)) closeTurn()
        }
        if (event === 'agent_message' && !payload.message) return
        const turn = ensureTurn(start), id = nextId()
        const hidden = (payload.channel != null && !['commentary', 'final', 'final_answer'].includes(String(payload.channel))) ||
          (payload.phase != null && !['commentary', 'final', 'final_answer'].includes(String(payload.phase)))
        const images = [...(Array.isArray(payload.images) ? payload.images : []), ...(Array.isArray(payload.local_images) ? payload.local_images : [])].slice(0, 16).map(() => ({ type: 'image' }))
        put(event === 'user_message' ? { type: 'userMessage', content: [{ type: 'text', text: payload.message.trim() }, ...images] } :
          { type: 'agentMessage', text: payload.message, phase: payload.phase }, id, turn, start, end, clipped, hidden); return
      }
      if (event === 'agent_reasoning' || event === 'agent_reasoning_raw_content') {
        if (!payload.text) return
        const turn = ensureTurn(start)
        const last = db.prepare('SELECT type FROM entries WHERE turn=? ORDER BY seq DESC LIMIT 1').get(turn) as { type: string } | undefined
        if (last?.type !== 'reasoning') put({ type: 'reasoning' }, nextId(), turn, start, end, false, true)
        return // Count native identity bookkeeping, retain no internal text or detail.
      }
      if (event === 'entered_review_mode' || event === 'exited_review_mode') {
        const explicit = string(payload.turn_id, 256)
        if (explicit && !knownTurn(explicit)) {
          closeTurn(); checkpoint!.turn = explicit
          db.prepare('INSERT INTO turns VALUES(?,?,?)').run(explicit, start, 'completed')
        }
        put({ ...payload, type: event === 'entered_review_mode' ? 'enteredReviewMode' : 'exitedReviewMode' },
          string(payload.item_id) || nextId(), explicit || ensureTurn(start), start, end, true); return
      }
      if (event === 'context_compacted') { put({ type: 'contextCompaction' }, nextId(), ensureTurn(start), start, end, false); return }
      if (event === 'item_started' || event === 'item_completed') {
        const item = obj(payload.item), kind = String(item.type ?? '')
        const allowed = ['Plan', 'HookPrompt', 'FunctionCallOutput', 'CommandExecution', 'DynamicToolCall', 'CollabAgentToolCall', 'SubAgentActivity', 'Extension', 'EnteredReviewMode', 'ExitedReviewMode']
        if (!allowed.some(name => kind === name || kind === name[0].toLowerCase() + name.slice(1))) return
        if (kind.toLowerCase() === 'plan' && !item.text) return
        const turn = string(payload.turn_id, 256)
        // Dedicated user/agent events supply native item-N IDs; materialized
        // copies (including AgentMessage.content Text[]) must not duplicate them.
        put(item, string(item.id), turn, start, end, clipped); return
      }
      const tools: Record<string, string> = {
        exec_command_begin: 'commandExecution', exec_command_end: 'commandExecution',
        patch_apply_begin: 'fileChange', patch_apply_end: 'fileChange', apply_patch_approval_request: 'fileChange',
        dynamic_tool_call_request: 'dynamicToolCall', dynamic_tool_call_response: 'dynamicToolCall',
        mcp_tool_call_begin: 'mcpToolCall', mcp_tool_call_end: 'mcpToolCall',
        web_search_begin: 'webSearch', web_search_end: 'webSearch', view_image_tool_call: 'imageView',
        collab_agent_spawn_begin: 'collabAgentToolCall', collab_agent_spawn_end: 'collabAgentToolCall',
        collab_agent_interaction_begin: 'collabAgentToolCall', collab_agent_interaction_end: 'collabAgentToolCall',
        collab_waiting_begin: 'collabAgentToolCall', collab_waiting_end: 'collabAgentToolCall',
        collab_close_begin: 'collabAgentToolCall', collab_close_end: 'collabAgentToolCall',
        collab_resume_begin: 'collabAgentToolCall', collab_resume_end: 'collabAgentToolCall',
        image_generation_begin: 'imageGeneration', image_generation_end: 'imageGeneration',
      }
      if (tools[event]) {
        const turn = string(payload.turn_id, 256) || ensureTurn(start)
        put({ ...payload, type: tools[event], aggregatedOutput: payload.aggregated_output ?? payload.stdout ?? payload.output,
          exitCode: payload.exit_code }, string(payload.call_id), turn, start, end, true)
      }
    }
    // Fixed-size input buffer and bounded parser; never readline/JSON.parse a raw line.
    const buffer = Buffer.alloc(BLOCK)
    let offset = checkpoint.offset, lineStart = offset, parser = new HistoryJson(), malformed = false
    let committed = checkpoint.offset
    const save = async () => {
      checkpoint!.scanned = false; checkpoint!.size = snapshot.size; checkpoint!.mtime = snapshot.mtimeMs
      checkpoint!.head = await digest(0, Math.min(checkpoint!.offset, 4096))
      checkpoint!.tail = await digest(Math.max(0, checkpoint!.offset - 4096), Math.min(checkpoint!.offset, 4096))
      live(); db.prepare('INSERT OR REPLACE INTO state(id,value) VALUES(1,?)').run(JSON.stringify(checkpoint))
    }
    db.exec('BEGIN IMMEDIATE')
    try {
      while (offset < snapshot.size) {
        live(); const read = await fd.read(buffer, 0, Math.min(BLOCK, snapshot.size - offset), offset); live()
        this.metrics.indexBytes += read.bytesRead
        if (!read.bytesRead) throw Error('History truncated while indexing')
        let n = 0
        while (n < read.bytesRead) {
          const found = buffer.indexOf(10, n), newline = found >= 0 && found < read.bytesRead ? found : -1
          const end = newline < 0 ? read.bytesRead : newline
          let parsed: ReturnType<HistoryJson['finish']> | undefined
          try {
            if (!malformed) {
              parser.feedBuffer(buffer.subarray(n, end))
              if (newline >= 0 && parser.hasValue) parsed = parser.finish()
            }
          } catch (error) {
            // Native 0.155 paginated materialization skips malformed complete
            // JSONL records, advancing ONLY the byte checkpoint. The next valid
            // record can reuse the ordinal after a torn write. Never recover a
            // header, valid-but-unsupported record, resource/liveness failure or
            // projector error this way. Keep the original source untouched.
            if (!(error instanceof HistoryJsonSyntaxError) || !checkpoint.verified || checkpoint.mode !== 'paginated') throw error
            malformed = true
          }
          if (newline < 0) break
          if (malformed) this.metrics.malformedRecords++
          if (parsed) record(obj(parsed.value), lineStart, offset + newline + 1, parsed.truncated)
          lineStart = offset + newline + 1; checkpoint.offset = lineStart; parser = new HistoryJson(); malformed = false
          n = newline + 1
        }
        offset += read.bytesRead
        if (checkpoint.offset - committed >= 1024 * 1024) {
          await save(); db.exec('COMMIT; BEGIN IMMEDIATE'); committed = checkpoint.offset
        }
        await yieldIO(); live()
      }
      // An incomplete final record is neither committed as an item nor treated as corruption.
      const after = await fd.stat(); live()
      if (`${after.dev}:${after.ino}` !== identity || after.size < snapshot.size || (after.size === snapshot.size && after.mtimeMs !== snapshot.mtimeMs)) throw Error('Native history changed during indexing')
      checkpoint.scanned = true; checkpoint.size = snapshot.size; checkpoint.mtime = snapshot.mtimeMs
      checkpoint.head = await digest(0, Math.min(checkpoint.offset, 4096))
      checkpoint.tail = await digest(Math.max(0, checkpoint.offset - 4096), Math.min(checkpoint.offset, 4096))
      live(); db.prepare('INSERT OR REPLACE INTO state(id,value) VALUES(1,?)').run(JSON.stringify(checkpoint)); db.exec('COMMIT')
      return checkpoint
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
}

export class HistoryView {
  constructor(private db: DatabaseSync, private fd: FileHandle, readonly checkpoint: Checkpoint, private live: () => void, private metrics: { detailBytes: number }) {}
  page(before = Number.MAX_SAFE_INTEGER) {
    before = Math.min(before, this.checkpoint.offset)
    const messages = this.db.prepare(`SELECT e.seq FROM entries e WHERE e.msg=1 AND e.seq<? AND ${visible} ORDER BY e.seq DESC LIMIT 20`).all(before) as Array<{ seq: number }>
    const lower = messages.length === 20 ? messages.at(-1)!.seq : 0
    const rows = this.db.prepare(`SELECT e.*, COALESCE(t.status,'unknown') AS status FROM entries e LEFT JOIN turns t ON t.id=e.turn WHERE e.seq>=? AND e.seq<? AND ${visible} AND e.msg=1 ORDER BY e.seq`).all(lower, before) as IndexedItem[]
    const tools = this.db.prepare(`SELECT e.*,COALESCE(t.status,'unknown') AS status FROM entries e LEFT JOIN turns t ON t.id=e.turn WHERE e.seq>=? AND e.seq<? AND ${visible} AND e.msg=0 ORDER BY e.seq DESC LIMIT 60`).all(lower, before) as IndexedItem[]
    const totalTools = Number(this.db.prepare(`SELECT count(*) AS n FROM entries e WHERE e.seq>=? AND e.seq<? AND e.msg=0 AND ${visible}`).get(lower, before)!.n)
    const previous = this.db.prepare(`SELECT e.seq FROM entries e WHERE e.seq<? AND ${visible} ORDER BY e.seq DESC LIMIT 1`).get(lower)
    const latestTurn = this.db.prepare('SELECT id,status FROM turns ORDER BY seq DESC LIMIT 1').get() as { id: string; status: string } | undefined
    return { rows: [...rows, ...tools].sort((a,b) => a.seq - b.seq), messages: messages.length, lower, upper: before, hiddenTools: totalTools - tools.length, older: previous ? lower : null, latestTurn }
  }
  async detail(lower: number, upper: number, toolsOnly: boolean, offset: number, expected?: { start: number; end: number }) {
    this.live()
    const row = this.db.prepare(`SELECT start,end FROM entries e WHERE seq>=? AND seq<? ${toolsOnly ? 'AND msg=0' : ''} AND end>? AND ${visible} ORDER BY start LIMIT 1`).get(lower, upper, offset) as { start: number; end: number } | undefined
    if (!row) throw Error('History detail is no longer available')
    if (expected && (row.start !== expected.start || row.end !== expected.end)) throw Error('History item changed; reload before opening details')
    if (offset !== 0 && offset < row.start) throw Error('Invalid detail position')
    const start = Math.max(row.start, offset), length = Math.min(32768, row.end - start), buffer = Buffer.alloc(length)
    const read = await this.fd.read(buffer, 0, length, start); this.metrics.detailBytes += read.bytesRead; this.live()
    if (read.bytesRead !== length) throw Error('History detail changed while reading')
    let consumed = length, text: string | undefined
    for (let trim = 0; trim < 4; trim++) {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, consumed)); break }
      catch { consumed-- }
    }
    if (text === undefined || consumed < 1) throw Error('History detail is not UTF-8')
    const next = start + consumed < row.end ? start + consumed :
      (this.db.prepare(`SELECT start FROM entries e WHERE seq>=? AND seq<? ${toolsOnly ? 'AND msg=0' : ''} AND start>=? AND ${visible} ORDER BY start LIMIT 1`).get(lower, upper, row.end) as { start: number } | undefined)?.start ?? null
    return { text, offset: start, next, format: 'native-json' as const }
  }
}
