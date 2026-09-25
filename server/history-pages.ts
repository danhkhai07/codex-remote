import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

export type HistoryItem = Record<string, unknown> & { id: string; type: string }
type NativePosition = { turns: string | null; turn?: { id: string; status: string }; items: string | null }
type Entry = { turnId: string; status: string; item: HistoryItem }
export type HistoryWindow = {
  revision: string; older: string | null; messages: number; scanned: number
  latestTurn?: { id: string; status: string }; turns: Array<{ id: string; status: string; items: HistoryItem[] }>
}
type Rpc = (method: string, params: Record<string, unknown>) => Promise<unknown>
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const MAX_SCAN = 80, TEXT = 16_000, TOOL = 2_000
const isMessage = (item: HistoryItem) => item.type === 'userMessage' || item.type === 'agentMessage'

/** Native cursors never become arbitrary paths or cross-thread capabilities. */
export class HistoryPages {
  private instance = randomUUID()
  private pages = new Map<string, { fingerprint: string; at: number; page: HistoryWindow; bytes: number }>()
  private bytes = 0
  private pending = new Map<string, Promise<HistoryWindow>>()
  constructor(private secret: string) {}
  private sign(body: string) { return createHmac('sha256', this.secret).update('history-v1\0' + body).digest('base64url') }
  private token(thread: string, position: NativePosition, item?: string, boundary?: string) {
    const body = Buffer.from(JSON.stringify({ thread, position, item, boundary })).toString('base64url')
    return body + '.' + this.sign(body)
  }
  private decode(token: string, thread: string) {
    if (token.length > 8192) throw Error('Invalid history cursor')
    const [body, signature, extra] = token.split('.')
    const expected = Buffer.from(this.sign(body ?? '')), actual = Buffer.from(signature ?? '')
    if (extra || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw Error('Invalid history cursor')
    const result = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (result.thread !== thread || !result.position || ![result.position.turns, result.position.items].every(v => v === null || typeof v === 'string') || (result.position.turn && (typeof result.position.turn.id !== 'string' || typeof result.position.turn.status !== 'string'))) throw Error('Invalid history cursor')
    return result as { thread: string; position: NativePosition; item?: string; boundary?: string }
  }
  boundary(thread: string, token?: string): string | undefined { return token ? this.decode(token, thread).boundary : undefined }
  withBoundary(thread: string, token: string, boundary: string): string {
    const value = this.decode(token, thread)
    return this.token(thread, value.position, value.item, boundary)
  }
  private compact(item: HistoryItem, token: string): HistoryItem {
    let remaining = isMessage(item) ? TEXT : TOOL, shortened = false, nodes = 0
    const visit = (value: unknown, depth = 0): unknown => {
      if (++nodes > 1024 || depth > 12 || remaining <= 0) { shortened = true; return null }
      if (typeof value === 'string') {
        let keep = value.slice(0, remaining)
        if (/[\uD800-\uDBFF]$/.test(keep)) keep = keep.slice(0, -1)
        remaining -= keep.length
        if (keep.length !== value.length) shortened = true
        return keep
      }
      if (Array.isArray(value)) { if (value.length > 64) shortened = true; return value.slice(0, 64).map(v => visit(v, depth + 1)) }
      if (value && typeof value === 'object') {
        const entries = Object.entries(value); if (entries.length > 64) shortened = true
        return Object.fromEntries(entries.slice(0, 64).map(([key, val]) => [key, visit(val, depth + 1)]))
      }
      return value
    }
    return { ...object(visit(item)), id: item.id, type: item.type, ...(shortened ? { historyDetail: token } : {}) }
  }
  invalidate(thread: string) {
    for (const [key, entry] of this.pages) if (key.startsWith(thread + '\0')) { this.pages.delete(key); this.bytes -= entry.bytes }
  }
  page(thread: string, fingerprint: string, rpc: Rpc, token?: string, fileRevision = false): Promise<HistoryWindow> {
    const key = JSON.stringify([thread, fingerprint, token])
    const current = this.pending.get(key)
    if (current) return current
    if (this.pending.size >= 16) return Promise.reject(Error('History is busy; retry shortly'))
    const operation = this.buildPage(thread, fingerprint, rpc, token, fileRevision).finally(() => this.pending.delete(key))
    this.pending.set(key, operation)
    return operation
  }
  private async buildPage(thread: string, fingerprint: string, rpc: Rpc, token?: string, fileRevision = false): Promise<HistoryWindow> {
    const decoded = token ? this.decode(token, thread) : undefined
    if (decoded?.item) throw Error('An item cursor is not a page cursor')
    const key = thread + '\0' + (token ?? ''), old = this.pages.get(key)
    // Metadata can have second resolution. Short TTL bounds missed native events,
    // and every item/turn event invalidates immediately in the controller.
    if (old?.fingerprint === fingerprint && (fileRevision || Date.now() - old.at < 1000)) return old.page
    let position: NativePosition = decoded?.position ?? { turns: null, items: null }
    let messages = 0, scanned = 0, exhausted = false
    const entries: Entry[] = []
    let latestTurn: HistoryWindow['latestTurn']
    const readTurn = async (cursor: string | null) => {
      const response = object(await rpc('thread/turns/list', { threadId: thread, cursor, limit: 1, sortDirection: 'desc', itemsView: 'notLoaded' }))
      const turn = object(Array.isArray(response.data) ? response.data[0] : null)
      return { turn: typeof turn.id === 'string' && typeof turn.status === 'string' ? { id: turn.id, status: turn.status } : undefined,
        next: typeof response.nextCursor === 'string' ? response.nextCursor : null }
    }
    const latest = await readTurn(null); latestTurn = latest.turn
    while (messages < 20 && scanned < MAX_SCAN && !exhausted) {
      if (!position.turn) {
        const next = !token && scanned === 0 ? latest : await readTurn(position.turns)
        if (!next.turn) { exhausted = true; break }
        position = { turns: next.next, turn: next.turn, items: null }
      }
      const activeTurn = position.turn
      if (!activeTurn) throw Error('Missing native turn')
      const before = { ...position }
      const result = object(await rpc('thread/items/list', { threadId: thread, turnId: activeTurn.id, cursor: position.items, limit: 1, sortDirection: 'desc' }))
      if (!Array.isArray(result.data) || result.data.length > 1) throw Error('Invalid native history page')
      const cursor = typeof result.nextCursor === 'string' ? result.nextCursor : null
      const entry = object(result.data[0]), item = object(entry.item)
      if (typeof entry.turnId === 'string' && typeof item.id === 'string' && typeof item.type === 'string') {
        if (entry.turnId !== activeTurn.id) throw Error('Native history turn mismatch')
        const normalized = item as HistoryItem
        entries.unshift({ turnId: entry.turnId, status: activeTurn.status, item: this.compact(normalized, this.token(thread, before, item.id)) })
        if (isMessage(normalized)) messages++
      }
      scanned++
      if (cursor && cursor === position.items) throw Error('Native history cursor did not advance')
      if (cursor) position = { ...position, items: cursor }
      else if (position.turns) position = { turns: position.turns, items: null }
      else exhausted = true
    }
    const turns: HistoryWindow['turns'] = []
    for (const entry of entries) {
      let turn = turns.find(t => t.id === entry.turnId)
      if (!turn) { turn = { id: entry.turnId, status: entry.status, items: [] }; turns.push(turn) }
      if (!turn.items.some(item => item.id === entry.item.id)) turn.items.push(entry.item)
    }
    const content = { turns, latestTurn, older: exhausted ? null : this.token(thread, position, undefined, decoded?.boundary), messages, scanned }
    const revision = createHmac('sha256', this.secret).update(this.instance).update(JSON.stringify(content)).digest('base64url')
    const page = { ...content, revision }, bytes = Buffer.byteLength(JSON.stringify(page))
    if (old) { this.pages.delete(key); this.bytes -= old.bytes }
    this.pages.set(key, { page, bytes, at: Date.now(), fingerprint }); this.bytes += bytes
    while (this.pages.size > 128 || this.bytes > 16 * 1024 * 1024) {
      const first = this.pages.keys().next().value!
      this.bytes -= this.pages.get(first)!.bytes; this.pages.delete(first)
    }
    return page
  }
  async detail(thread: string, token: string, offset: number, rpc: Rpc) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 512 * 1024 * 1024) throw Error('Invalid detail offset')
    const decoded = this.decode(token, thread)
    if (!decoded.item) throw Error('Missing item cursor')
    const result = object(await rpc('thread/items/list', { threadId: thread, turnId: decoded.position.turn?.id, cursor: decoded.position.items, limit: 1, sortDirection: 'desc' }))
    const entry = object(Array.isArray(result.data) ? result.data[0] : null), item = object(entry.item)
    if (item.id !== decoded.item) throw Error('History changed; reload the page before opening details')
    const text = typeof item.text === 'string' ? item.text : typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : JSON.stringify(item, null, 2)
    // Detail is a window, never an accumulated full output in the browser.
    return { text: text.slice(offset, offset + 32_768), offset, next: offset + 32_768 < text.length ? offset + 32_768 : null }
  }
}
