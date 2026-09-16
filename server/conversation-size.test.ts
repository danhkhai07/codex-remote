import { describe, expect, it } from 'vitest'
import { jsonBytes, limitConversation, limitItems, MAX_CONVERSATION_BYTES } from './conversation-size.js'

const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8')
describe('5 MB conversation limit', () => {
  it('keeps small histories unchanged, including more than 400 items / 100 turns', () => {
    const thread = { id: 'A', cwd: '/workspace', turns: Array.from({ length: 120 }, (_, n) => ({ id: `${n}`, status: 'completed', items: Array.from({ length: 5 }, () => ({ text: 'hi' })) })) }
    expect(limitConversation(thread)).toBe(thread)
    expect(limitConversation(thread).turns).toHaveLength(120)
  })
  it('keeps the newest turns and removes the chronological beginning without mutating the source', () => {
    const thread = { id: 'A', cwd: '/workspace', turns: Array.from({ length: 8 }, (_, n) => ({ id: `${n}`, status: n === 7 ? 'inProgress' : 'completed', items: [{ type: 'agentMessage', text: `${n}`.repeat(1_000_000) }] })) }
    const clipped = limitConversation(thread)
    expect(size(clipped)).toBeLessThanOrEqual(MAX_CONVERSATION_BYTES)
    expect(clipped.turns.at(-1)!.items[0].text).toBe('7'.repeat(1_000_000))
    expect(clipped.turns.some(turn => turn.id === '0')).toBe(false)
    expect(clipped).toMatchObject({ historyCacheTruncated: true, historyTruncation: 'head', latestTurn: { id: '7', status: 'inProgress' } })
    expect(thread.turns).toHaveLength(8)
    expect(thread.turns[7].items[0].text).toHaveLength(1_000_000)
  })
  it('shortens an individual huge Unicode item without breaking JSON or surrogate pairs', () => {
    const thread = { id: 'A', cwd: '/workspace', turns: [{ id: 'turn', status: 'completed', items: [{ id: 'item', type: 'agentMessage', text: 'Việt 🚗\n"'.repeat(700_000) }] }] }
    const clipped = limitConversation(thread)
    expect(size(clipped)).toBeLessThanOrEqual(MAX_CONVERSATION_BYTES)
    expect(size(clipped)).toBeGreaterThan(MAX_CONVERSATION_BYTES - 100)
    expect(JSON.parse(JSON.stringify(clipped))).toEqual(clipped)
    expect(clipped.turns[0].items[0]).toMatchObject({ id: 'item', type: 'agentMessage' })
    expect(clipped.turns[0].items[0].text.startsWith('…')).toBe(true)
    expect(clipped.turns[0].items[0].text).not.toContain('\uFFFD')
  })
  it('also bounds oversized metadata and preserves control fields', () => {
    const thread = { id: 'A', cwd: '/workspace', preview: 'x'.repeat(6_000_000), turns: [{ id: 'latest', status: 'completed', items: [] }] }
    const clipped = limitConversation(thread)
    expect(size(clipped)).toBeLessThanOrEqual(MAX_CONVERSATION_BYTES)
    expect(clipped).toMatchObject({ id: 'A', cwd: '/workspace', turns: [], latestTurn: { id: 'latest', status: 'completed' } })
  })
  it('accounts for JSON escapes, array commas, and UTF-8 bytes in live output', () => {
    const items = [{ id: 'a', type: 'commandExecution', turnId: 't', aggregatedOutput: '\\"🚗'.repeat(1000) }, { id: 'b', text: 'hidden' }]
    const clipped = limitItems(items, 1000)
    expect(clipped.truncated).toBe(true)
    expect(size(clipped.items)).toBeLessThanOrEqual(1000)
    expect(clipped.items.at(-1)).toEqual({ id: 'b', text: 'hidden' })
    expect(clipped.items[0]).toMatchObject({ id: 'a', type: 'commandExecution', turnId: 't' })
    expect(jsonBytes({ text: 'Tiếng Việt 🚗' })).toBe(size({ text: 'Tiếng Việt 🚗' }))
  })
})
