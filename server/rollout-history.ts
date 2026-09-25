import { constants } from 'node:fs'
import { open, mkdir, realpath, lstat, type FileHandle } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, join, relative, sep } from 'node:path'
import { setImmediate as yieldIO } from 'node:timers/promises'
import { HistoryJson } from './history-json.js'

export type HistoryMetadata = { id: string; cwd: string; path?: string }
export type IndexedItem = { seq: number; turn: string; status: string; id: string; type: string; data: string; start: number; end: number; clipped: number; msg: number }
type Checkpoint = { version: 1; generation: string; identity: string; offset: number; size: number; mtime: number; head: string; tail: string; turn: string | null; verified: boolean }
const obj = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const string = (value: unknown, max = 4096) => typeof value === 'string' ? value.slice(0, max) : ''
const visible = `e.suppressed=0`
const BLOCK = 64 * 1024

/** Typed projection: never null-out IDs, content arrays or renderer objects. */
export function historyItem(item: Record<string, unknown>, id: string, fallback = false): { value: Record<string, unknown>; message: boolean } {
  const raw = string(item.type, 128)
  const type = ({ UserMessage: 'userMessage', AgentMessage: 'agentMessage', CommandExecution: 'commandExecution', FileChange: 'fileChange', Plan: 'plan', McpToolCall: 'mcpToolCall', DynamicToolCall: 'dynamicToolCall' } as Record<string, string>)[raw] ?? raw
  const texts = Array.isArray(item.content) ? item.content.map(obj).filter(v => ['text', 'Text', 'input_text', 'output_text', 'inputText'].includes(String(v.type))).map(v => string(v.text, 16384)) : []
  const text = typeof item.text === 'string' ? string(item.text, 16384) : texts.join('\n').slice(0, 16384)
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
  readonly metrics = { indexBytes: 0, guardBytes: 0, detailBytes: 0, rebuilds: 0, records: 0 }
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
    let valid = checkpoint?.version === 1 && checkpoint.identity === identity && checkpoint.offset <= snapshot.size
    if (valid && checkpoint) {
      valid = checkpoint.head === await digest(0, Math.min(checkpoint.offset, 4096)) && checkpoint.tail === await digest(Math.max(0, checkpoint.offset - 4096), Math.min(checkpoint.offset, 4096))
      if (snapshot.size === checkpoint.size && snapshot.mtimeMs !== checkpoint.mtime) valid = false
    }
    if (!valid || !checkpoint) {
      this.metrics.rebuilds++
      db.exec('BEGIN IMMEDIATE; DELETE FROM entries; DELETE FROM turns; DELETE FROM state; COMMIT;')
      checkpoint = { version: 1, generation: randomUUID(), identity, offset: 0, size: 0, mtime: 0, head: '', tail: '', turn: null, verified: false }
    }
    // An unchanged incomplete tail is not reparsed on every poll/detail request.
    if (checkpoint.size === snapshot.size && checkpoint.mtime === snapshot.mtimeMs) return checkpoint
    const writeTurn = db.prepare('INSERT INTO turns(id,seq,status) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status')
    const insert = db.prepare(`INSERT INTO entries(seq,turn,id,type,canonical,msg,data,start,end,clipped,fingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(turn,id,canonical) DO UPDATE SET data=excluded.data,start=excluded.start,end=excluded.end,clipped=excluded.clipped,fingerprint=excluded.fingerprint`)
    const record = (row: Record<string, unknown>, start: number, end: number, clipped: boolean) => {
      this.metrics.records++
      const payload = obj(row.payload), type = String(row.type ?? '')
      if (typeof payload.turn_id === 'string' && payload.turn_id.length > 256) throw Error('Unsupported native turn identity length')
      if (!checkpoint!.verified) {
        if (type !== 'session_meta' || payload.id !== metadata.id || payload.cwd !== metadata.cwd) throw Error('Native history identity mismatch')
        checkpoint!.verified = true; return
      }
      if (type === 'session_meta') { if (payload.id !== metadata.id || payload.cwd !== metadata.cwd) throw Error('Native history identity changed'); return }
      if (type === 'turn_context' && typeof payload.turn_id === 'string') {
        checkpoint!.turn = string(payload.turn_id, 256)
        db.prepare('INSERT OR IGNORE INTO turns(id,seq,status) VALUES(?,?,?)').run(checkpoint!.turn, start, 'inProgress')
      }
      if (type === 'event_msg' && payload.type === 'task_started' && typeof payload.turn_id === 'string') {
        checkpoint!.turn = string(payload.turn_id, 256); writeTurn.run(checkpoint!.turn, start, 'inProgress'); return
      }
      if (type === 'event_msg' && ['task_complete', 'turn_aborted', 'task_failed'].includes(String(payload.type)) && typeof payload.turn_id === 'string') {
        writeTurn.run(string(payload.turn_id, 256), start, payload.type === 'task_complete' ? 'completed' : payload.type === 'task_failed' ? 'failed' : 'interrupted'); return
      }
      let item: Record<string, unknown> | undefined, turn = checkpoint!.turn, canonical = 0
      if (type === 'event_msg' && payload.type === 'item_completed') {
        item = obj(payload.item); turn = typeof payload.turn_id === 'string' ? string(payload.turn_id, 256) : turn; canonical = 1
        if (['Reasoning', 'reasoning'].includes(String(item.type))) return // Never expand internal reasoning payloads.
      } else if (type === 'response_item' && payload.type === 'message' && ['user', 'assistant'].includes(String(payload.role))) {
        item = { ...payload, type: payload.role === 'user' ? 'userMessage' : 'agentMessage' }
      } else if (type === 'response_item' && ['function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output'].includes(String(payload.type))) {
        item = { ...payload, id: `legacy:${start}:${string(payload.call_id, 128)}`, type: 'historyTool', text: string(payload.arguments ?? payload.output, 2048) }
      }
      if (!item) return
      if (!turn) throw Error('Native history item has no turn identity')
      if (typeof item.id === 'string' && item.id.length >= 4096) throw Error('Unsupported native item identity length')
      const id = typeof item.id === 'string' && item.id ? item.id : `record:${start}`
      const normalized = historyItem(item, id, canonical === 0 && item.type === 'historyTool')
      db.prepare('INSERT OR IGNORE INTO turns(id,seq,status) VALUES(?,?,?)').run(turn, start, 'inProgress')
      const data = JSON.stringify(normalized.value), kind = String(normalized.value.type)
      const lossyContent = Array.isArray(item.content) && item.content.some(value => !['text', 'Text', 'input_text', 'output_text', 'inputText'].includes(String(obj(value).type)))
      const clip = clipped || lossyContent || !normalized.message || JSON.stringify(item).length > data.length + 1024 ? 1 : 0
      const prior = db.prepare('SELECT seq,data FROM entries WHERE turn=? AND id=? AND canonical=?').get(turn, id, canonical) as { seq: number; data: string } | undefined
      if (prior && prior.data !== data) checkpoint!.generation = randomUUID()
      // Native may persist both response_item and item_completed. Pair at most
      // ONE exact, untruncated message; never suppress all legacy items in a turn.
      const fingerprint = normalized.message && !clip ? createHash('sha256').update(JSON.stringify({ type: kind,
        text: kind === 'agentMessage' ? normalized.value.text : normalized.value.content })).digest('hex') : ''
      insert.run(start, turn, id, kind, canonical, normalized.message ? 1 : 0, data, start, end, clip, fingerprint)
      if (!prior && normalized.message) {
        const counterpart = db.prepare(`SELECT seq FROM entries WHERE turn=? AND type=? AND canonical=? AND paired=0
          AND (id=? OR (? <> '' AND fingerprint=?)) ORDER BY seq DESC LIMIT 1`).get(turn, kind, 1 - canonical, id, fingerprint, fingerprint) as { seq: number } | undefined
        if (counterpart) {
          db.prepare('UPDATE entries SET paired=1, suppressed=CASE WHEN canonical=0 THEN 1 ELSE 0 END WHERE seq IN (?,?)').run(start, counterpart.seq)
          // Old windows/cursors may contain the fallback identity just replaced.
          if (counterpart.seq < committed) checkpoint!.generation = randomUUID()
        }
      }
    }
    // Fixed-size input buffer and bounded parser; never readline/JSON.parse a raw line.
    const buffer = Buffer.alloc(BLOCK)
    let offset = checkpoint.offset, lineStart = offset, parser = new HistoryJson()
    let committed = checkpoint.offset
    const save = async () => {
      checkpoint!.size = snapshot.size; checkpoint!.mtime = snapshot.mtimeMs
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
          parser.feedBuffer(buffer.subarray(n, end))
          if (newline < 0) break
          if (parser.hasValue) { const parsed = parser.finish(); record(obj(parsed.value), lineStart, offset + newline + 1, parsed.truncated) }
          lineStart = offset + newline + 1; checkpoint.offset = lineStart; parser = new HistoryJson()
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
      checkpoint.size = snapshot.size; checkpoint.mtime = snapshot.mtimeMs
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
    const rows = this.db.prepare(`SELECT e.*, t.status FROM entries e JOIN turns t ON t.id=e.turn WHERE e.seq>=? AND e.seq<? AND ${visible} AND e.msg=1 ORDER BY e.seq`).all(lower, before) as IndexedItem[]
    const tools = this.db.prepare(`SELECT e.*,t.status FROM entries e JOIN turns t ON t.id=e.turn WHERE e.seq>=? AND e.seq<? AND ${visible} AND e.msg=0 ORDER BY e.seq DESC LIMIT 60`).all(lower, before) as IndexedItem[]
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
