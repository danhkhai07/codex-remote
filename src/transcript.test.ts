import { describe, expect, it } from 'vitest'
import { conversationItems, reconcileTranscript, updateTranscript, type TranscriptItem } from './transcript'
import type { RemoteEvent, Thread } from './types'

function event(method: string, params: Record<string, unknown>): RemoteEvent {
  return { id: 1, at: '', type: 'codex', payload: { method, params: { threadId: 'thread', turnId: 'turn', ...params } } }
}
const thread: Thread = { id: 'thread', cwd: '/workspace', createdAt: 0, updatedAt: 0, status: {}, turns: [] }

describe('live conversation', () => {
  it('caps oversized streaming output while retaining new deltas', () => {
    const items = updateTranscript([], event('item/agentMessage/delta', { itemId: 'large', delta: 'x'.repeat(6_000_000) }))
    expect(Buffer.byteLength(JSON.stringify(items), 'utf8')).toBeLessThanOrEqual(5_000_000)
    expect(items[0].historyItemTruncated).toBe(true)
    const updated = updateTranscript(items, event('item/agentMessage/delta', { itemId: 'large', delta: 'more' }))
    expect(String(updated[0].text).endsWith('more')).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(updated), 'utf8')).toBeLessThanOrEqual(5_000_000)
    const next = updateTranscript(updated, event('item/agentMessage/delta', { itemId: 'new', delta: 'Newest answer' }))
    expect(next.at(-1)).toMatchObject({ id: 'new', text: 'Newest answer' })
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
  it('does not append an old cached message after the newest paginated answer', () => {
    const oldLink: TranscriptItem = { id: 'link', turnId: 'yesterday', type: 'userMessage', text: 'Canva URL', streaming: false }
    const omittedTool: TranscriptItem = { id: 'tool', turnId: 'today', type: 'commandExecution', command: 'old command', streaming: false }
    const inFlight: TranscriptItem = { id: 'reply', turnId: 'next', type: 'agentMessage', text: 'New reply', streaming: true }
    const recent = { ...thread, historyWindow: { revision: 'r1', older: 'cursor', messages: 20 },
      latestTurn: { id: 'next', status: 'inProgress' },
      turns: [{ id: 'today', status: 'completed', items: [{ id: 'answer', type: 'agentMessage', text: 'Today answer' }] }] }
    const reconciled = reconcileTranscript([oldLink, omittedTool, inFlight], recent, true)
    expect(reconciled).toEqual([inFlight])
    expect(conversationItems(recent, reconciled).map(item => item.text)).toEqual(['Today answer', 'New reply'])
    // A turn started while the request was in flight must survive until the next sync.
    expect(reconcileTranscript([oldLink, inFlight], recent, false)).toEqual([oldLink, inFlight])
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

  it('omits empty reasoning and internal placeholders without changing visible order or IDs', () => {
    const stored = {
      ...thread,
      turns: [{ id: 'turn', status: 'completed', items: [
        { id: 'user', type: 'userMessage', text: 'Question' },
        { id: 'answer', type: 'agentMessage', text: 'Final answer' },
        ...Array.from({ length: 12 }, (_, index) => ({ id: `reasoning-${index}`, type: 'reasoning', summary: [] })),
        { id: 'compaction', type: 'contextCompaction' },
        { id: 'unknown-empty', type: 'internalBookkeeping' },
        { id: 'public-summary', type: 'reasoning', summary: [{ text: 'Published summary' }] },
        { id: 'tool', type: 'commandExecution', command: 'npm test', status: 'completed' },
        { id: 'mcp', type: 'mcpToolCall', status: 'completed' },
      ] }],
    }
    const live: TranscriptItem[] = [
      { id: 'answer', turnId: 'turn', type: 'agentMessage', text: 'Final answer' },
      { id: 'late-empty', turnId: 'turn', type: 'reasoning', summary: [] },
    ]

    const visible = conversationItems(stored, live)
    expect(visible.map(item => item.id)).toEqual(['user', 'answer', 'public-summary', 'tool', 'mcp'])
    expect(visible.map(item => item.type)).toEqual(['userMessage', 'agentMessage', 'reasoning', 'commandExecution', 'mcpToolCall'])
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

it('streams and completes native plan text as a plan item', () => {
  const event = (method: string, extra: Record<string, unknown>): RemoteEvent => ({ id: 1, type: 'codex', at: '', payload: { method, params: { threadId: 'chat', turnId: 'turn', itemId: 'plan', ...extra } } })
  let items = updateTranscript([], event('item/plan/delta', { delta: 'First ' }))
  items = updateTranscript(items, event('item/plan/delta', { delta: 'step' }))
  expect(items[0]).toMatchObject({ type: 'plan', text: 'First step', streaming: true })
  items = updateTranscript(items, event('item/completed', { item: { id: 'plan', type: 'plan', text: 'First step.' } }))
  expect(items[0]).toMatchObject({ type: 'plan', text: 'First step.', streaming: false })
})
