import type { ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { SseWriter } from './sse-writer.js'

export type RemoteEvent = {
  id: number
  at: string
  type: 'codex' | 'request' | 'request-resolved' | 'server-log' | 'state'
  payload: unknown
  replayed?: boolean
}

type Subscriber = {
  writer: SseWriter
  heartbeat: NodeJS.Timeout
}

const SENSITIVE_KEY = /^(authorization|cookie|password|secret|accessToken|refreshToken|idToken|apiKey)$/i

export function sanitizeForBrowser(value: unknown, depth = 0): unknown {
  if (depth > 24) return '[depth limit]'
  if (Array.isArray(value)) return value.map((entry) => sanitizeForBrowser(entry, depth + 1))
  if (!value || typeof value !== 'object') return value

  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : sanitizeForBrowser(entry, depth + 1)
  }
  return output
}

export function encodeEvent(event: RemoteEvent, replayed = false): string[] {
  const data = JSON.stringify(replayed ? { ...event, replayed: true } : event)
  return encodeData(event.id, data)
}

function encodeData(id: number, data: string): string[] {
  if (Buffer.byteLength(data) <= 16_000) return [`id: ${id}\ndata: ${data}\n\n`]
  // Bound SSE frames as well as HTTP writes: proxies can limit individual
  // event lines. JSON envelopes preserve newlines and Unicode losslessly.
  const total = Math.ceil(data.length / 4_000)
  return Array.from({ length: total }, (_, index) => {
    const fragment = JSON.stringify({ id, index, total, data: data.slice(index * 4_000, (index + 1) * 4_000) })
    // Advance Last-Event-ID only once the entire event has been delivered.
    return `${index === total - 1 ? `id: ${id}\n` : ''}event: fragment\ndata: ${fragment}\n\n`
  })
}

export class EventHub {
  readonly epoch = randomUUID()
  readonly #events: Array<{ event: RemoteEvent; bytes: number }> = []
  readonly #subscribers = new Set<Subscriber>()
  #nextId = 1
  #retainedBytes = 0
  #droppedThrough = 0

  constructor(readonly maxReplayBytes = 16 * 1024 * 1024) {}

  get stats(): { retainedEvents: number; retainedBytes: number; subscribers: number } {
    return { retainedEvents: this.#events.length, retainedBytes: this.#retainedBytes, subscribers: this.#subscribers.size }
  }

  publish(type: RemoteEvent['type'], payload: unknown): RemoteEvent {
    const event: RemoteEvent = {
      id: this.#nextId++,
      at: new Date().toISOString(),
      type,
      payload: sanitizeForBrowser(payload),
    }
    const data = JSON.stringify(event)
    const bytes = Buffer.byteLength(data)
    this.#events.push({ event, bytes })
    this.#retainedBytes += bytes
    while (this.#events.length > 1_000 || this.#retainedBytes > this.maxReplayBytes) {
      const removed = this.#events.shift()!
      this.#retainedBytes -= removed.bytes
      this.#droppedThrough = removed.event.id
    }

    const encoded = this.#subscribers.size ? encodeData(event.id, data) : []
    for (const subscriber of this.#subscribers) {
      subscriber.writer.write(encoded)
    }
    return event
  }

  subscribe(res: ServerResponse, afterId: number, previousEpoch?: string): () => void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.flushHeaders()
    const writer = new SseWriter(res)
    const subscriber: Subscriber = {
      writer,
      heartbeat: setInterval(() => writer.write(['event: heartbeat\ndata: {}\n\n']), 15_000),
    }
    subscriber.heartbeat.unref()
    this.#subscribers.add(subscriber)
    const unsubscribe = () => {
      clearInterval(subscriber.heartbeat)
      this.#subscribers.delete(subscriber)
      writer.close()
      res.off('close', unsubscribe)
    }
    res.once('close', unsubscribe)
    // Named events survive intermediaries that consume SSE comments.
    writer.write(['event: ready\ndata: {}\n\n'])
    // A device cursor can outlive a gateway restart, while event IDs restart at
    // one. Treat a cursor from a future ID as a new epoch and replay the backlog.
    const reset = Boolean(previousEpoch && previousEpoch !== this.epoch) || afterId >= this.#nextId || afterId < this.#droppedThrough
    const replayAfterId = reset ? 0 : afterId
    writer.write([`event: stream-state\ndata: ${JSON.stringify({ epoch: this.epoch, reset })}\n\n`])
    for (const { event } of this.#events) {
      if (event.id > replayAfterId) {
        writer.write(encodeEvent(event, replayAfterId === 0))
      }
    }

    return unsubscribe
  }
}
