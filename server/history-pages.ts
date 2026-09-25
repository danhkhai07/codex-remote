import { createHmac, timingSafeEqual } from 'node:crypto'
import { RolloutHistory, type HistoryMetadata } from './rollout-history.js'

export type HistoryItem = Record<string, unknown> & { id: string; type: string }
export type HistoryWindow = {
  revision: string; generation: string; older: string | null; messages: number; scanned: number
  latestTurn?: { id: string; status: string }; turns: Array<{ id: string; status: string; items: HistoryItem[] }>
}
type Cursor = { thread: string; generation: string; before?: number; lower?: number; upper?: number; tools?: boolean; start?: number; end?: number; boundary?: string }

/** Only server-issued, per-thread, per-rollout-generation positions are accepted.
 * There are no path/range parameters that can address an arbitrary file. */
export class HistoryPages {
  constructor(private secret: string, private source: RolloutHistory) {}
  private sign(body: string) { return createHmac('sha256', this.secret).update('history-index-v1\0' + body).digest('base64url') }
  private token(value: Cursor) {
    const body = Buffer.from(JSON.stringify(value)).toString('base64url')
    return body + '.' + this.sign(body)
  }
  private decode(token: string, thread: string): Cursor {
    if (token.length > 2048) throw Error('Invalid history cursor')
    const [body, signature, extra] = token.split('.')
    const expected = Buffer.from(this.sign(body ?? '')), actual = Buffer.from(signature ?? '')
    if (extra || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw Error('Invalid history cursor')
    const value = JSON.parse(Buffer.from(body, 'base64url').toString()) as Cursor
    if (value.thread !== thread || typeof value.generation !== 'string' || value.generation.length > 64 ||
      [value.before, value.lower, value.upper, value.start, value.end].some(n => n !== undefined && (!Number.isSafeInteger(n) || n < 0)) ||
      (value.boundary !== undefined && (typeof value.boundary !== 'string' || value.boundary.length > 512))) throw Error('Invalid history cursor')
    return value
  }
  boundary(thread: string, token?: string) { return token ? this.decode(token, thread).boundary : undefined }
  withBoundary(thread: string, token: string, boundary: string) { return this.token({ ...this.decode(token, thread), boundary }) }
  async page(metadata: HistoryMetadata, live: () => void, token?: string): Promise<HistoryWindow> {
    const cursor = token ? this.decode(token, metadata.id) : undefined
    if (cursor && (cursor.before === undefined || cursor.lower !== undefined)) throw Error('Invalid history page cursor')
    return this.source.use(metadata, live, view => {
      if (cursor && cursor.generation !== view.checkpoint.generation) throw Error('History was rewritten; reload the latest messages')
      const selected = view.page(cursor?.before), generation = view.checkpoint.generation
      const turns: HistoryWindow['turns'] = []
      for (const row of selected.rows) {
        let turn = turns.find(t => t.id === row.turn)
        if (!turn) { turn = { id: row.turn, status: row.status, items: [] }; turns.push(turn) }
        const item = JSON.parse(row.data) as HistoryItem
        // Clipped messages and tool summaries retain bounded original-source detail.
        if (row.clipped) item.historyDetail = this.token({ thread: metadata.id, generation, lower: row.seq, upper: row.seq + 1, start: row.start, end: row.end })
        turn.items.push(item)
      }
      if (selected.hiddenTools > 0) {
        const item: HistoryItem = { id: `tools:${selected.lower}:${selected.upper}`, type: 'historyTools',
          text: `${selected.hiddenTools} bản ghi công cụ khác trong đoạn này. Mở chi tiết để xem từng phần.`,
          historyDetail: this.token({ thread: metadata.id, generation, lower: selected.lower, upper: selected.upper, tools: true }) }
        if (turns[0]) turns[0].items.unshift(item)
        else turns.push({ id: `tools:${selected.lower}`, status: 'completed', items: [item] })
      }
      const content = { turns, latestTurn: selected.latestTurn, generation,
        older: selected.older === null ? null : this.token({ thread: metadata.id, generation, before: selected.older, boundary: cursor?.boundary }),
        messages: selected.messages, scanned: selected.rows.length }
      return { ...content, revision: createHmac('sha256', this.secret).update(JSON.stringify(content)).digest('base64url') }
    })
  }
  async detail(metadata: HistoryMetadata, token: string, offset: number, live: () => void) {
    if (!Number.isSafeInteger(offset) || offset < 0) throw Error('Invalid detail offset')
    const cursor = this.decode(token, metadata.id)
    if (cursor.lower === undefined || cursor.upper === undefined || cursor.upper <= cursor.lower || cursor.before !== undefined) throw Error('Invalid item cursor')
    return this.source.use(metadata, live, view => {
      if (cursor.generation !== view.checkpoint.generation) throw Error('History was rewritten; reload before opening details')
      return view.detail(cursor.lower!, cursor.upper!, Boolean(cursor.tools), offset, cursor.start !== undefined && cursor.end !== undefined ? { start: cursor.start, end: cursor.end } : undefined)
    })
  }
}
