import { describe, expect, it } from 'vitest'
import { conversationItems, updateTranscript, type TranscriptItem } from './transcript'
import type { RemoteEvent, Thread } from './types'

function event(method: string, params: Record<string, unknown>): RemoteEvent {
  return { id: 1, at: '', type: 'codex', payload: { method, params: { threadId: 'thread', turnId: 'turn', ...params } } }
}
const thread: Thread = { id: 'thread', cwd: '/workspace', createdAt: 0, updatedAt: 0, status: {}, turns: [] }

describe('live conversation', () => {
  it('keeps the prompt, commentary, command and next response in arrival order', () => {
    let items: TranscriptItem[] = []
    for (const e of [
      event('item/completed', { item: { id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'Fix the layout' }] } }),
      event('item/agentMessage/delta', { itemId: 'first', delta: 'I will inspect.' }),
      event('item/completed', { item: { id: 'first', type: 'agentMessage', text: 'I will inspect.' } }),
      event('item/started', { item: { id: 'cmd', type: 'commandExecution', command: 'npm test', status: 'inProgress' } }),
      event('item/commandExecution/outputDelta', { itemId: 'cmd', delta: 'Tests passed' }),
      event('item/agentMessage/delta', { itemId: 'second', delta: 'Found the issue.' }),
    ]) items = updateTranscript(items, e)
    expect(items.map(item => item.id)).toEqual(['user', 'first', 'cmd', 'second'])
    expect(items[1]).toMatchObject({ text: 'I will inspect.', streaming: false })
    expect(items[2]).toMatchObject({ command: 'npm test', aggregatedOutput: 'Tests passed' })
    expect(items[3]).toMatchObject({ text: 'Found the issue.', streaming: true })
    const completed = updateTranscript(items, event('turn/completed', {}))
    expect(completed.map(item => item.id)).toEqual(items.map(item => item.id))
    expect(completed.every(item => item.streaming === false)).toBe(true)
    expect(conversationItems({ ...thread, turns: [{ id: 'turn', status: 'completed', items: completed }] }, completed)).toHaveLength(4)
  })

  it('retains early output through more than 600 deltas and replaces completed snapshots', () => {
    let items = updateTranscript([], event('item/agentMessage/delta', { itemId: 'one', delta: 'Start ' }))
    for (let i = 0; i < 700; i++) items = updateTranscript(items, event('item/agentMessage/delta', { itemId: 'one', delta: 'x' }))
    expect(items[0].text).toBe('Start ' + 'x'.repeat(700))
    items = updateTranscript(items, event('item/completed', { item: { id: 'one', type: 'agentMessage', text: 'Final' } }))
    expect(items).toHaveLength(1)
    expect(items[0].text).toBe('Final')
  })
})
