import { describe, expect, it } from 'vitest'
import { commandSummary, compactOutputEvents, eventThreadId, eventTurnId, filterThreads, itemText, outputEventCategory, rateLimitLines, threadTitle } from './model'

describe('Codex Remote presentation model', () => {
  it('uses explicit names, previews, and a stable fallback for thread titles', () => {
    const base = { id: '1', cwd: '/workspace', createdAt: 1, updatedAt: 1, status: {} }
    expect(threadTitle({ ...base, name: 'Named thread', preview: 'ignored' })).toBe('Named thread')
    expect(threadTitle({ ...base, preview: 'A'.repeat(80) })).toHaveLength(70)
    expect(threadTitle(base)).toBe('New conversation')
  })

  it('extracts thread ids and visible text from protocol payloads', () => {
    expect(eventThreadId({
      id: 1,
      at: new Date(0).toISOString(),
      type: 'codex',
      payload: { method: 'turn/started', params: { threadId: 'thr_1' } },
    })).toBe('thr_1')
    expect(eventTurnId({
      id: 2,
      at: new Date(0).toISOString(),
      type: 'codex',
      payload: { method: 'turn/started', params: { turn: { id: 'turn_1' } } },
    })).toBe('turn_1')
    expect(itemText({ type: 'userMessage', content: [{ type: 'text', text: 'hello' }] })).toBe('hello')
  })

  it('filters conversations by title, workspace, or model', () => {
    const threads = [
      { id: '1', name: 'Repair mobile layout', cwd: '/workspace/shop', model: 'gpt-5', createdAt: 1, updatedAt: 1, status: {} },
      { id: '2', name: 'Review API', cwd: '/workspace/backend', model: 'o3', createdAt: 1, updatedAt: 1, status: {} },
    ]

    expect(filterThreads(threads, 'mobile')).toEqual([threads[0]])
    expect(filterThreads(threads, 'BACKEND')).toEqual([threads[1]])
    expect(filterThreads(threads, 'gpt-5')).toEqual([threads[0]])
    expect(filterThreads(threads, '  ')).toBe(threads)
  })

  it('keeps command summaries compact while preserving meaningful text', () => {
    expect(commandSummary('npm   run\ncheck:remote')).toBe('npm run check:remote')
    expect(commandSummary('abcdefghijklmnopqrstuvwxyz', 12)).toBe('abcdefghijk…')
  })

  it('groups consecutive output deltas without hiding event payloads', () => {
    const at = new Date(0).toISOString()
    const events = [
      { id: 1, at, type: 'codex' as const, payload: { method: 'item/agentMessage/delta', params: { delta: 'Hello ' } } },
      { id: 2, at, type: 'codex' as const, payload: { method: 'item/agentMessage/delta', params: { delta: 'world' } } },
      { id: 3, at, type: 'codex' as const, payload: { method: 'turn/completed', params: {} } },
    ]

    expect(compactOutputEvents(events)).toMatchObject([
      { id: 1, method: 'item/agentMessage/delta', preview: 'Hello world', count: 2, category: 'agent', events: [{ id: 1 }, { id: 2 }] },
      { id: 3, method: 'turn/completed', count: 1, category: 'system' },
    ])
    expect(outputEventCategory({ id: 4, at, type: 'request', payload: { method: 'item/commandExecution/requestApproval' } })).toBe('requests')
  })

  it('formats multi-window account usage limits with remaining quota and resets', () => {
    expect(rateLimitLines({
      rateLimitsByLimitId: {
        codex: {
          limitId: 'codex',
          limitName: 'Codex',
          primary: { usedPercent: 24.6, windowDurationMins: 300, resetsAt: 123 },
          secondary: { usedPercent: 80, windowDurationMins: 10_080 },
        },
      },
      rateLimitResetCredits: { availableCount: 2 },
    }, (epoch) => `at-${epoch}`)).toEqual([
      { label: 'Codex', value: '25% used · 75% left · 5h window · resets at-123' },
      { label: 'Codex secondary', value: '80% used · 20% left · 7d window' },
      { label: 'Reset credits', value: '2' },
    ])
  })
})
