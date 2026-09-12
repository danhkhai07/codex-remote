import { describe, expect, it } from 'vitest'
import { conversationItems, reconcileTranscript, updateTranscript, type TranscriptItem } from './transcript'
import type { RemoteEvent, Thread } from './types'

function event(method: string, params: Record<string, unknown>): RemoteEvent {
  return { id: 1, at: '', type: 'codex', payload: { method, params: { threadId: 'thread', turnId: 'turn', ...params } } }
}
const thread: Thread = { id: 'thread', cwd: '/workspace', createdAt: 0, updatedAt: 0, status: {}, turns: [] }

describe('live conversation', () => {
  it('caps oversized streaming output and does not regrow the trimmed tail', () => {
    const items = updateTranscript([], event('item/agentMessage/delta', { itemId: 'large', delta: 'x'.repeat(6_000_000) }))
    expect(Buffer.byteLength(JSON.stringify(items), 'utf8')).toBeLessThanOrEqual(5_000_000)
    expect(items[0].historyItemTruncated).toBe(true)
    expect(updateTranscript(items, event('item/agentMessage/delta', { itemId: 'large', delta: 'more' }))).toBe(items)
    const ended = updateTranscript(items, event('turn/completed', {}))
    expect(ended[0].streaming).toBe(false)
  })
  it('replaces stale cached deltas with completed history after reconnect without dropping new output', () => {
    const stale: TranscriptItem = { id: 'answer', turnId: 'finished', type: 'agentMessage', text: 'Partial', streaming: true }
    const current: TranscriptItem = { id: 'next', turnId: 'running', type: 'agentMessage', text: 'Working', streaming: true }
    const history = { ...thread, turns: [{ id: 'finished', status: 'completed', items: [{ id: 'answer', type: 'agentMessage', text: 'Full answer' }] }] }
    const reconciled = reconcileTranscript([stale, current], history)
    expect(reconciled).toEqual([current])
    expect(conversationItems(history, reconciled).map(item => item.text)).toEqual(['Full answer', 'Working'])
    const items = [stale, current]
    expect(reconcileTranscript(items, { ...history, historyUnavailable: true })).toBe(items)
  })
  it('merges long histories in turn order without changing untouched live references', () => {
    const turns = Array.from({ length: 500 }, (_, i) => ({
      id: `t-${i}`, status: 'completed', items: [{ id: 'repeated-id', type: 'agentMessage', text: `stored-${i}` }],
    }))
    const replacement: TranscriptItem = { id: 'repeated-id', turnId: 't-250', type: 'agentMessage', text: 'updated' }
    const appended: TranscriptItem = { id: 'extra', turnId: 'new-turn', type: 'agentMessage', text: 'new' }
    const result = conversationItems({ ...thread, turns }, [replacement, appended])
    expect(result).toHaveLength(501)
    expect(result[249].text).toBe('stored-249')
    expect(result[250]).toBe(replacement)
    expect(result[251].text).toBe('stored-251')
    expect(result[500]).toBe(appended)
    expect(turns[250].items[0].text).toBe('stored-250')
  })

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
