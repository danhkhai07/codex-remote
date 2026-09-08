import type { ServerResponse } from 'node:http'

export type RemoteEvent = {
  id: number
  at: string
  type: 'codex' | 'request' | 'request-resolved' | 'server-log' | 'state'
  payload: unknown
  replayed?: boolean
}

type Subscriber = {
  res: ServerResponse
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
  if (Buffer.byteLength(data) <= 16_000) return [`id: ${event.id}\ndata: ${data}\n\n`]
  // Bound SSE frames as well as HTTP writes: proxies can limit individual
  // event lines. JSON envelopes preserve newlines and Unicode losslessly.
  const total = Math.ceil(data.length / 4_000)
  return Array.from({ length: total }, (_, index) => {
    const fragment = JSON.stringify({ id: event.id, index, total, data: data.slice(index * 4_000, (index + 1) * 4_000) })
    // Advance Last-Event-ID only once the entire event has been delivered.
    return `${index === total - 1 ? `id: ${event.id}\n` : ''}event: fragment\ndata: ${fragment}\n\n`
  })
}

export class EventHub {
  readonly #events: RemoteEvent[] = []
  readonly #subscribers = new Set<Subscriber>()
  #nextId = 1

  publish(type: RemoteEvent['type'], payload: unknown): RemoteEvent {
    const event: RemoteEvent = {
      id: this.#nextId++,
      at: new Date().toISOString(),
      type,
      payload: sanitizeForBrowser(payload),
    }
    this.#events.push(event)
    if (this.#events.length > 1_000) this.#events.splice(0, this.#events.length - 1_000)

    const encoded = encodeEvent(event)
    for (const subscriber of this.#subscribers) {
      for (const frame of encoded) subscriber.res.write(frame)
    }
    return event
  }

  subscribe(res: ServerResponse, afterId: number): () => void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.flushHeaders()
    // Named events survive intermediaries that consume SSE comments.
    res.write('event: ready\ndata: {}\n\n')
    // A device cursor can outlive a gateway restart, while event IDs restart at
    // one. Treat a cursor from a future ID as a new epoch and replay the backlog.
    const replayAfterId = afterId >= this.#nextId ? 0 : afterId
    for (const event of this.#events) {
      if (event.id > replayAfterId) {
        for (const frame of encodeEvent(event, replayAfterId === 0)) res.write(frame)
      }
    }

    const subscriber: Subscriber = {
      res,
      heartbeat: setInterval(() => res.write('event: heartbeat\ndata: {}\n\n'), 15_000),
    }
    subscriber.heartbeat.unref()
    this.#subscribers.add(subscriber)

    return () => {
      clearInterval(subscriber.heartbeat)
      this.#subscribers.delete(subscriber)
    }
  }
}
