import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ServerResponse } from 'node:http'
import { encodeEvent, EventHub, sanitizeForBrowser } from './event-hub.js'
import { EventAssembler } from '../src/eventStream.js'

describe('sanitizeForBrowser', () => {
  it('redacts credentials without dropping ordinary Codex output', () => {
    expect(sanitizeForBrowser({
      tokenUsage: { total: 42 },
      password: 'private',
      nested: { authorization: 'Bearer private', text: 'visible output' },
    })).toEqual({
      tokenUsage: { total: 42 },
      password: '[redacted]',
      nested: { authorization: '[redacted]', text: 'visible output' },
    })
  })
})

describe('EventHub replay metadata', () => {
  it('bounds retained bytes even below 1000 events and signals an evicted cursor', () => {
    const hub = new EventHub(1000)
    for (let i = 0; i < 100; i++) {
      hub.publish('codex', { text: '🌍'.repeat(80) })
      expect(hub.stats.retainedBytes).toBeLessThanOrEqual(1000)
    }
    expect(hub.stats.retainedEvents).toBeLessThan(3)
    const write = vi.fn(() => true)
    const unsubscribe = hub.subscribe(mockResponse({ write }), 1, hub.epoch)
    expect(write.mock.calls.map(call => call[0]).join('')).toContain('"reset":true')
    unsubscribe()
    expect(hub.stats.subscribers).toBe(0)
  })

  it('streams an event larger than the replay budget without retaining it or hiding the gap', () => {
    const hub = new EventHub(500)
    const write = vi.fn(() => true)
    const unsubscribe = hub.subscribe(mockResponse({ write }), 0)
    hub.publish('state', { state: 'before' })
    hub.publish('codex', { text: 'x'.repeat(2000) })
    expect(write.mock.calls.map(call => call[0]).join('')).toContain('x'.repeat(2000))
    expect(hub.stats.retainedBytes).toBe(0)
    hub.publish('state', { state: 'after' })
    const reconnect = vi.fn(() => true)
    const detach = hub.subscribe(mockResponse({ write: reconnect }), 1, hub.epoch)
    expect(reconnect.mock.calls.map(call => call[0]).join('')).toContain('"reset":true')
    detach()
    unsubscribe()
  })

  it('also evicts tiny events by count and cleans up when the response closes', () => {
    const hub = new EventHub()
    for (let i = 0; i < 1005; i++) hub.publish('state', {})
    expect(hub.stats.retainedEvents).toBe(1000)
    const response = mockResponse()
    const unsubscribe = hub.subscribe(response, 1004, hub.epoch)
    response.emit('close')
    expect(hub.stats.subscribers).toBe(0)
    expect(response.listenerCount('drain')).toBe(0)
    unsubscribe()
  })

  it('resets an old server epoch even when its cursor is below the current event count', () => {
    const hub = new EventHub()
    for (let i = 0; i < 5; i++) hub.publish('state', { state: 'ready' })
    const write = vi.fn(() => true)
    const response = mockResponse({ write })
    const unsubscribe = hub.subscribe(response, 2, 'previous-server')
    unsubscribe()
    expect(write).toHaveBeenCalledWith(`event: stream-state\ndata: ${JSON.stringify({ epoch: hub.epoch, reset: true })}\n\n`)
    expect(write.mock.calls.map(call => call[0]).join('')).toContain('"id":1')
  })
  it('flushes the handshake and sends named heartbeats only while subscribed', () => {
    vi.useFakeTimers()
    const write = vi.fn(() => true)
    const flushHeaders = vi.fn()
    const response = mockResponse({ write, flushHeaders })
    const unsubscribe = new EventHub().subscribe(response, 0)
    try {
      expect(flushHeaders).toHaveBeenCalledOnce()
      expect(write).toHaveBeenCalledWith('event: ready\ndata: {}\n\n')
      vi.advanceTimersByTime(30_000)
      expect(write.mock.calls.filter(call => call[0] === 'event: heartbeat\ndata: {}\n\n')).toHaveLength(2)
      unsubscribe()
      write.mockClear()
      vi.advanceTimersByTime(30_000)
      expect(write).not.toHaveBeenCalled()
    } finally {
      unsubscribe()
      vi.useRealTimers()
    }
  })

  it('marks the initial backlog without marking subsequent live events', () => {
    const hub = new EventHub()
    hub.publish('state', { state: 'ready' })
    const writes: string[] = []
    const response = mockResponse({
      writeHead: () => {},
      flushHeaders: () => {},
      write: (value: string) => { writes.push(value); return true },
    })

    const unsubscribe = hub.subscribe(response, 0)
    hub.publish('state', { state: 'busy' })
    unsubscribe()

    const output = writes.join('')
    expect(output).toMatch(/"state":"ready"}.*"replayed":true/)
    expect(output).toContain('"state":"busy"')
    expect(output).not.toMatch(/"state":"busy"}.*"replayed":true/)
  })

  it('replays from a new epoch when a device cursor is ahead after restart', () => {
    const hub = new EventHub()
    hub.publish('state', { state: 'ready' })
    const writes: string[] = []
    const response = mockResponse({
      writeHead: () => {},
      flushHeaders: () => {},
      write: (value: string) => { writes.push(value); return true },
    })

    const unsubscribe = hub.subscribe(response, 500)
    unsubscribe()

    expect(writes.join('')).toMatch(/"state":"ready"}.*"replayed":true/)
  })

  it('transports megabyte events in bounded frames and preserves Unicode and replay metadata', () => {
    const event = { id: 42, at: 'now', type: 'codex' as const, payload: { text: 'hello 🌍\ndata: "\\'.repeat(100_000) } }
    const frames = encodeEvent(event, true)
    const assembler = new EventAssembler()
    let result: string | null = null
    for (const [index, frame] of frames.entries()) {
      expect(Buffer.byteLength(frame)).toBeLessThan(32_000)
      expect(frame.includes('id: 42\n')).toBe(index === frames.length - 1)
      result = assembler.accept(frame.slice(frame.indexOf('data: ') + 6).trimEnd())
      if (index !== frames.length - 1) expect(result).toBeNull()
    }
    expect(JSON.parse(result!)).toEqual({ ...event, replayed: true })
  })

  it('discards partial events and resumes them without mixing payloads', () => {
    const assembler = new EventAssembler()
    const first = JSON.stringify({ id: 1, index: 0, total: 2, data: 'first' })
    const last = JSON.stringify({ id: 1, index: 1, total: 2, data: 'last' })
    expect(assembler.accept(first)).toBeNull()
    assembler.reset()
    expect(assembler.accept(last)).toBeNull()
    expect(assembler.accept(first)).toBeNull()
    expect(assembler.accept(last)).toBe('firstlast')
    expect(assembler.accept('null')).toBeNull()
    expect(assembler.accept('{')).toBeNull()
  })
})

function mockResponse(overrides: Record<string, unknown> = {}): ServerResponse {
  const res = Object.assign(new EventEmitter(), {
    writableLength: 0,
    writeHead: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(() => true),
    ...overrides,
  })
  return res as unknown as ServerResponse
}
