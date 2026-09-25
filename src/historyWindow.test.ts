import { expect, it } from 'vitest'
import { prependHistory } from './historyWindow'
import { conversationItems } from './transcript'
import type { Thread } from './types'
const thread = (start: number, end: number): Thread => ({ id: 'thread', cwd: '/fake', createdAt: 0, updatedAt: 0, status: 'idle',
  turns: [{ id: 'same-turn', status: 'completed', items: Array.from({ length: end - start }, (_, n) => ({ id: String(start + n), type: 'agentMessage', text: String(start + n) })) }],
  historyWindow: { revision: 'v1', messages: end - start, older: 'cursor' } })
it('deduplicates the shared turn boundary and does not inject latest output into old window', () => {
  const current = thread(20, 40), older = thread(0, 21), combined = prependHistory(current, older)
  expect(combined.turns?.[0].items.map(i => i.id)).toEqual(Array.from({ length: 40 }, (_, n) => String(n)))
  expect(conversationItems(combined, [{ id: 'live', turnId: 'new', type: 'agentMessage', text: 'New output' }])).toHaveLength(40)
  expect(current.turns?.[0].items).toHaveLength(20)
})
it('bounds DOM window without modifying full history or accepting a different conversation', () => {
  const current = thread(200, 400), older = thread(0, 200)
  expect(prependHistory(current, older).turns?.flatMap(t => t.items)).toHaveLength(240)
  expect(prependHistory(current, { ...older, id: 'different' })).toBe(current)
})
