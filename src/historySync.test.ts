import { afterEach, describe, expect, it, vi } from 'vitest'
import { scheduleHistorySync } from './historySync'

afterEach(() => vi.useRealTimers())

describe('history reconciliation', () => {
  it('uses live events with lightweight list refreshes, retaining a five-minute consistency check', () => {
    vi.useFakeTimers()
    const history = vi.fn()
    const metadata = vi.fn()
    const stop = scheduleHistorySync(true, history, metadata)
    expect(history).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(4 * 60_000)
    expect(history).toHaveBeenCalledOnce()
    expect(metadata).toHaveBeenCalledTimes(16)
    vi.advanceTimersByTime(60_000)
    expect(history).toHaveBeenCalledTimes(2)
    stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('recovers every 15 seconds without SSE, immediately reconciles on reconnect, and stops on hide', () => {
    vi.useFakeTimers()
    const history = vi.fn()
    const metadata = vi.fn()
    const stopRecovery = scheduleHistorySync(false, history, metadata)
    vi.advanceTimersByTime(30_000)
    expect(history).toHaveBeenCalledTimes(3)
    expect(metadata).not.toHaveBeenCalled()
    stopRecovery()
    const stopLive = scheduleHistorySync(true, history, metadata)
    expect(history).toHaveBeenCalledTimes(4)
    vi.advanceTimersByTime(15_000)
    expect(history).toHaveBeenCalledTimes(4)
    stopLive()
    vi.advanceTimersByTime(10 * 60_000)
    expect(history).toHaveBeenCalledTimes(4)
  })
})
