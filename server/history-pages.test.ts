import { describe, it, expect, vi } from 'vitest'
import { HistoryPages, type HistoryItem } from './history-pages.js'

function fixture() {
  const turns: Array<{ id: string; status: string; items: HistoryItem[] }> = Array.from({ length: 40 }, (_, n) => ({ id: `t${n}`, status: n === 3 ? 'interrupted' : 'completed', items: [
    { id: `u${n}`, type: 'userMessage', content: [{ type: 'inputText', text: `Question ${n}` }] },
    ...Array.from({ length: 3 }, (_, k) => ({ id: `tool${n}-${k}`, type: 'commandExecution', aggregatedOutput: 'x'.repeat(4000) })),
    { id: `a${n}`, type: 'agentMessage', phase: 'final_answer', text: `Answer ${n}` },
  ] }))
  const rpc = vi.fn(async (method: string, p: Record<string, unknown>) => {
    if (method === 'thread/turns/list') {
      expect(p.itemsView).toBe('notLoaded'); expect(p.limit).toBe(1)
      const index = p.cursor ? Number(String(p.cursor).slice(1)) : turns.length - 1
      const turn = turns[index]
      return { data: turn ? [{ id: turn.id, status: turn.status, items: [] }] : [], nextCursor: index > 0 ? `t${index - 1}` : null }
    }
    expect(method).toBe('thread/items/list'); expect(p.limit).toBe(1)
    const turn = turns.find(t => t.id === p.turnId)!
    const index = p.cursor ? Number(String(p.cursor).slice(1)) : turn.items.length - 1
    return { data: [{ turnId: turn.id, item: turn.items[index] }], nextCursor: index > 0 ? `i${index - 1}` : null }
  })
  return { turns, rpc, pages: new HistoryPages('fake-only'.repeat(8)) }
}

describe('message windows over supported native pagination', () => {
  it('counts twenty messages, keeps associated tools, retrieves older windows without full reads', async () => {
    const { pages, rpc } = fixture()
    const first = await pages.page('thread', 'v1', rpc)
    expect(first.messages).toBe(20)
    expect(first.turns.flatMap(t => t.items).filter(i => i.type === 'commandExecution').length).toBe(30)
    expect(first.turns[0].items[0].id).toBe('u30')
    expect(first.older).toBeTruthy()
    const older = await pages.page('thread', 'v1', rpc, first.older!)
    expect(older.messages).toBe(20)
    expect(older.turns[0].items[0].id).toBe('u20')
    expect(rpc.mock.calls.every(([method]) => method !== 'thread/read')).toBe(true)
    await expect(pages.page('different-thread', 'v1', rpc, first.older!)).rejects.toThrow('Invalid history cursor')
  })
  it('preserves interrupted status and partial-turn cursor; does not count tools', async () => {
    const { pages, rpc, turns } = fixture()
    turns.splice(4)
    turns[3].items = Array.from({ length: 27 }, (_, n) => ({ id: `long${n}`, type: 'agentMessage', phase: 'final_answer', text: `Part ${n}` }))
    const first = await pages.page('thread', 'v1', rpc)
    expect(first.messages).toBe(20); expect(first.turns[0].status).toBe('interrupted')
    const older = await pages.page('thread', 'v1', rpc, first.older!)
    expect(older.messages).toBe(13)
    const ids = [...older.turns, ...first.turns].flatMap(t => t.items.map(i => i.id))
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('reuses revision cache, invalidates for append/events and bounds dense tool scans', async () => {
    const { pages, rpc, turns } = fixture()
    const first = await pages.page('thread', 'v1', rpc, undefined, true), calls = rpc.mock.calls.length
    expect(await pages.page('thread', 'v1', rpc, undefined, true)).toEqual(first)
    expect(rpc.mock.calls.length).toBe(calls)
    pages.invalidate('thread')
    turns.at(-1)!.items = Array.from({ length: 100 }, (_, n) => ({ id: `tool${n}`, type: 'commandExecution', aggregatedOutput: 'Large'.repeat(10000) }))
    const next = await pages.page('thread', 'v2', rpc)
    expect(next.scanned).toBe(80); expect(next.messages).toBe(0); expect(next.older).toBeTruthy()
    expect(Buffer.byteLength(JSON.stringify(next))).toBeLessThan(600_000)
    expect(next.revision).not.toBe(first.revision)
  })
  it('keeps giant details out of page response and provides bounded detail windows', async () => {
    const { pages, rpc, turns } = fixture()
    turns.at(-1)!.items.at(-1)!.text = 'Unicode Việt '.repeat(100_000)
    const page = await pages.page('thread', 'v1', rpc)
    const item = page.turns.at(-1)!.items.at(-1)!
    expect(String(item.text).length).toBeLessThanOrEqual(16000)
    expect(typeof item.historyDetail).toBe('string')
    const detail = await pages.detail('thread', String(item.historyDetail), 0, rpc)
    expect(detail.text.length).toBe(32768); expect(detail.next).toBe(32768)
    await expect(pages.detail('other', String(item.historyDetail), 0, rpc)).rejects.toThrow()
    await expect(pages.detail('thread', String(item.historyDetail), -1, rpc)).rejects.toThrow()
    turns.at(-1)!.items.at(-1)!.id = 'replacement'
    await expect(pages.detail('thread', String(item.historyDetail), 0, rpc)).rejects.toThrow('History changed')
  })
})

it('rejects delayed native work when request authorization is withdrawn', async () => {
  const { pages, rpc } = fixture()
  let revoked = false
  const guarded = async (method: string, params: Record<string, unknown>) => {
    if (revoked) throw Error('revoked')
    const response = await rpc(method, params)
    if (method === 'thread/items/list') revoked = true
    if (revoked) throw Error('revoked')
    return response
  }
  await expect(pages.page('thread', 'v1', guarded)).rejects.toThrow('revoked')
  const fresh = await pages.page('thread', 'v1', rpc)
  expect(fresh.messages).toBe(20)
})
