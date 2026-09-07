import { describe, expect, it, vi } from 'vitest'
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
  it('flushes the handshake and sends named heartbeats only while subscribed', () => {
    vi.useFakeTimers()
    const write = vi.fn(() => true)
    const flushHeaders = vi.fn()
    const response = { writeHead: vi.fn(), write, flushHeaders } as unknown as ServerResponse
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
    const response = {
      writeHead: () => response,
      flushHeaders: () => {},
      write: (value: string) => { writes.push(value); return true },
    } as unknown as ServerResponse

    const unsubscribe = hub.subscribe(response, 0)
    hub.publish('state', { state: 'busy' })
    unsubscribe()

    const output = writes.join('')
    expect(output).toMatch(/"state":"ready"}.*"replayed":true/)
    expect(output).toContain('"state":"busy"')
    expect(output).not.toMatch(/"state":"busy"}.*"replayed":true/)
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
