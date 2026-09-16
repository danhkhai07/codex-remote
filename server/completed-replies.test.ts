import { expect, it } from 'vitest'
import { completedReplyIds } from './completed-replies.js'

it('counts a completed answer once even with multiple assistant items', () => {
  const items = [
    { type: 'agentMessage', phase: 'commentary', text: 'Working…' },
    { type: 'agentMessage', phase: 'final_answer', text: 'Done' },
    { type: 'agentMessage', text: 'More details' },
  ]
  expect(completedReplyIds({ id: 'a', status: 'completed', items })).toEqual(['reply:a'])
  for (const status of ['inProgress', 'failed', 'interrupted', undefined]) {
    expect(completedReplyIds({ id: 'a', status, items })).toEqual([])
  }
  expect(completedReplyIds({ id: 'a', status: 'completed', items: items.slice(0, 1) })).toEqual([])
  expect(completedReplyIds({ id: 'a', status: 'completed', items: [{ type: 'agentMessage', text: ' ' }] })).toEqual([])
})
