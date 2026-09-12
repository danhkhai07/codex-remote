import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { turnHasEnded, useInterrupt } from './useInterrupt'
import { api } from './api'

// Hook orchestration tests without a DOM: state updates are captured while
// timers, network responses, and completion notifications remain controllable.
const harness = vi.hoisted(() => ({ state: {} as Record<string, { phase: string }>, cleanups: [] as Array<() => void> }))
vi.mock('react', () => ({
  useState: () => [harness.state, (update: (current: typeof harness.state) => typeof harness.state) => { harness.state = update(harness.state) }],
  useRef: (current: unknown) => ({ current }),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => (() => void)) => { harness.cleanups.push(effect()) },
}))
vi.mock('./api', () => ({ api: { interrupt: vi.fn(), thread: vi.fn() } }))

describe('stop confirmation', () => {
  it('uses preserved latest-turn status when history was shortened', () => {
    expect(turnHasEnded({ turns: [], latestTurn: { id: 'target', status: 'completed' } }, 'target')).toBe(true)
    expect(turnHasEnded({ turns: [], latestTurn: { id: 'other', status: 'completed' } }, 'target')).toBe(false)
    expect(turnHasEnded({ turns: [], latestTurn: { id: 'target', status: 'inProgress' } }, 'target')).toBe(false)
  })
  it('requires the exact turn to reach a terminal status', () => {
    expect(turnHasEnded({ turns: [{ id: 'old', status: 'completed' }, { id: 'new', status: 'inProgress' }] }, 'new')).toBe(false)
    for (const status of ['completed', 'interrupted', 'failed']) {
      expect(turnHasEnded({ turns: [{ id: 'target', status }] }, 'target')).toBe(true)
    }
  })
  it('does not treat missing or unavailable history as a successful stop', () => {
    expect(turnHasEnded({}, 'target')).toBe(false)
    expect(turnHasEnded({ turns: [] }, 'target')).toBe(false)
    expect(turnHasEnded({ historyUnavailable: true, turns: [{ id: 'target', status: 'completed' }] }, 'target')).toBe(false)
  })
})

describe('Stop orchestration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    harness.state = {}
    harness.cleanups = []
    vi.mocked(api.interrupt).mockResolvedValue({})
    vi.mocked(api.thread).mockImplementation(async id => ({ thread: { id, cwd: '/workspace', createdAt: 0, updatedAt: 0, status: {}, turns: [{ id: `turn-${id}`, status: 'inProgress', items: [] }] } }))
  })
  afterEach(() => {
    for (const cleanup of harness.cleanups) cleanup()
    vi.useRealTimers()
  })

  it('responds immediately, deduplicates clicks and does not confuse acknowledgement with stopping', async () => {
    const confirmed = vi.fn()
    const action = useInterrupt('csrf', confirmed)
    const pending = action.stop('A', 'turn-A')
    await action.stop('A', 'turn-A')
    expect(harness.state.A.phase).toBe('stopping')
    expect(api.interrupt).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(confirmed).not.toHaveBeenCalled()
    action.confirm('A', 'turn-A')
    await pending
    expect(harness.state.A).toBeUndefined()
    expect(confirmed).toHaveBeenCalledExactlyOnceWith('A', 'turn-A')
  })

  it('recovers lost SSE/acknowledgement by polling the exact turn', async () => {
    vi.mocked(api.interrupt).mockRejectedValue(new Error('Network disconnected'))
    const confirmed = vi.fn()
    const action = useInterrupt('csrf', confirmed)
    const pending = action.stop('A', 'turn-A')
    await vi.advanceTimersByTimeAsync(1_000)
    vi.mocked(api.thread).mockResolvedValue({ thread: { id: 'A', cwd: '/', createdAt: 0, updatedAt: 0, status: {}, turns: [{ id: 'turn-A', status: 'interrupted', items: [] }] } })
    await vi.advanceTimersByTimeAsync(1_000)
    await pending
    expect(confirmed).toHaveBeenCalledExactlyOnceWith('A', 'turn-A')
  })

  it('bounds waiting, offers retry, and keeps operations independent per conversation', async () => {
    const action = useInterrupt('csrf', vi.fn())
    const first = action.stop('A', 'turn-A')
    const second = action.stop('B', 'turn-B')
    expect(harness.state.A.phase).toBe('stopping')
    expect(harness.state.B.phase).toBe('stopping')
    action.confirm('B', 'turn-B')
    await second
    await vi.advanceTimersByTimeAsync(20_000)
    await first
    expect(harness.state.A.phase).toBe('error')
    expect(harness.state.B).toBeUndefined()
    const retry = action.stop('A', 'turn-A')
    expect(harness.state.A.phase).toBe('stopping')
    expect(api.interrupt).toHaveBeenCalledTimes(3)
    action.confirm('A', 'turn-A')
    await retry
  })
})
