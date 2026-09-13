import { EventEmitter } from 'node:events'
import type { ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { SseWriter } from './sse-writer.js'

function socket(write: (frame: string) => boolean) {
  const response = Object.assign(new EventEmitter(), {
    writableLength: 0,
    write: vi.fn(write),
    destroy: vi.fn(() => response.emit('close')),
  })
  return { response, res: response as unknown as ServerResponse }
}

describe('SSE backpressure', () => {
  it('pauses after write(false), then delivers queued live frames in order on drain', () => {
    const { response, res } = socket(() => false)
    const writer = new SseWriter(res)
    writer.write(['first', 'second'])
    writer.write(['third'])
    expect(response.write.mock.calls.map(([frame]) => frame)).toEqual(['first'])
    response.write.mockImplementation(() => true)
    response.emit('drain')
    expect(response.write.mock.calls.map(([frame]) => frame)).toEqual(['first', 'second', 'third'])
    expect(response.destroy).not.toHaveBeenCalled()
    writer.close()
    expect(response.listenerCount('drain')).toBe(0)
  })

  it('disconnects an overflowing slow client without blocking a healthy client', () => {
    const slow = socket(() => false)
    const fast = socket(() => true)
    const slowWriter = new SseWriter(slow.res, 10)
    const fastWriter = new SseWriter(fast.res, 10)
    for (const writer of [slowWriter, fastWriter]) writer.write(['12345', '67890', 'abcde', 'fghij'])
    expect(slow.response.destroy).toHaveBeenCalledOnce()
    expect(fast.response.write).toHaveBeenCalledTimes(4)
    expect(fast.response.destroy).not.toHaveBeenCalled()
    slow.response.emit('drain')
    expect(slow.response.write).toHaveBeenCalledTimes(1)
    fastWriter.close()
  })

  it('counts the socket buffer and UTF-8 bytes against the limit', () => {
    const { response, res } = socket(() => true)
    response.writableLength = 8
    const writer = new SseWriter(res, 10)
    writer.write(['🌍'])
    expect(response.destroy).toHaveBeenCalledOnce()
    expect(response.write).not.toHaveBeenCalled()
  })

  it('times out a stalled socket and cancels the watchdog on close or recovery', () => {
    vi.useFakeTimers()
    try {
      const stalled = socket(() => false)
      const recovered = socket(() => false)
      const closed = socket(() => false)
      for (const { res } of [stalled, recovered, closed]) new SseWriter(res, 100, 1000).write(['frame'])
      recovered.response.emit('drain')
      closed.response.emit('close')
      vi.advanceTimersByTime(1000)
      expect(stalled.response.destroy).toHaveBeenCalledOnce()
      expect(recovered.response.destroy).not.toHaveBeenCalled()
      expect(closed.response.destroy).not.toHaveBeenCalled()
      recovered.response.emit('close')
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
})
