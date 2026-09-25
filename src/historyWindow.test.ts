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

it('keeps the reader anchored during live changes and invalidates only stale cursors', async () => {
  const { refreshHistoryWindow } = await import('./historyWindow')
  const older = { ...thread(0, 20), historyWindow: { ...thread(0, 20).historyWindow!, generation: 'old', browsingOlder: true } }
  const next = { ...thread(30, 50), historyWindow: { ...thread(30, 50).historyWindow!, generation: 'old' } }
  expect(refreshHistoryWindow(older, next)).toBe(older)
  const rewritten = { ...next, historyWindow: { ...next.historyWindow, generation: 'new' } }
  const result = refreshHistoryWindow(older, rewritten)
  expect(result.turns).toBe(older.turns)
  expect(result.historyWindow).toMatchObject({ invalidated: true, older: null })
  expect(prependHistory(older, rewritten).historyWindow?.invalidated).toBe(true)
  expect(refreshHistoryWindow(next, rewritten)).toBe(rewritten)
})
it('does not replace a paused latest window when revalidation would discard its anchor', async () => {
  const { refreshHistoryWindow } = await import('./historyWindow')
  const current = thread(0, 20), next = thread(40, 60)
  const frozen = refreshHistoryWindow(current, next, true)
  expect(frozen.turns).toBe(current.turns)
  expect(frozen.historyWindow?.browsingOlder).toBe(true)
  expect(refreshHistoryWindow(current, next, false)).toBe(next)
})
