import { describe, expect, it } from 'vitest'
import { compactThreadHistory, isCachedThread, ThreadHistoryCache } from './threadHistoryCache'
import type { Thread } from './types'
import { MAX_CONVERSATION_BYTES } from '../server/conversation-size'

const thread = (id: string): Thread => ({ id, cwd: '/workspace', name: id, createdAt: 0, updatedAt: 0, status: {}, turns: [{ id: `turn-${id}`, status: 'completed', items: [{ id: 'answer', type: 'agentMessage', text: `History ${id}` }] }] })

describe('recent conversation history cache', () => {
  it('keeps eight recent conversations and evicts the least recently used', () => {
    const cache = new ThreadHistoryCache()
    for (let i = 0; i < 8; i++) cache.remember(thread(String(i)))
    expect(cache.get('0')?.turns?.[0].items[0].text).toBe('History 0')
    cache.remember(thread('8'))
    expect(cache.get('1')).toBeUndefined()
    expect(cache.get('0')).toBeDefined()
    expect(cache.snapshot()).toHaveLength(8)
  })

  it('restores multiple histories and preserves content on metadata-only responses', () => {
    const cache = new ThreadHistoryCache()
    cache.restore([thread('A'), thread('B'), { id: 'invalid', turns: null }])
    cache.remember({ ...thread('B'), name: 'Renamed', turns: [], historyUnavailable: true })
    expect(cache.get('B')).toMatchObject({ name: 'Renamed', turns: [{ items: [{ text: 'History B' }] }] })
    expect(cache.get('A')).toBeDefined()
    cache.delete('A')
    expect(cache.get('A')).toBeUndefined()
    cache.clear()
    expect(cache.snapshot()).toEqual([])
  })

  it('caps histories at 5 MB, trims the beginning, and marks partial cache', () => {
    const large = thread('large')
    large.turns![0].items = Array.from({ length: 1000 }, (_, i) => ({ id: String(i), text: `Message ${i} ` + 'x'.repeat(6000) }))
    const cached = compactThreadHistory(large)
    expect(cached.historyCacheTruncated).toBe(true)
    expect(new TextEncoder().encode(JSON.stringify(cached)).length).toBeLessThanOrEqual(MAX_CONVERSATION_BYTES)
    expect(cached.turns![0].items[0]?.id).not.toBe('0')
    expect(cached.turns![0].items.at(-1)?.id).toBe('999')
    expect(large.turns![0].items).toHaveLength(1000)
  })

  it('rejects malformed cache before React tries to render it', () => {
    expect(isCachedThread({ ...thread('A'), name: {} })).toBe(false)
    expect(isCachedThread({ ...thread('A'), turns: [{ id: 'turn', status: 'completed', items: [null] }] })).toBe(false)
    expect(isCachedThread(thread('A'))).toBe(true)
  })
})
