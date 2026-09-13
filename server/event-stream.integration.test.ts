import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, it } from 'vitest'
import { EventHub, type RemoteEvent } from './event-hub.js'
import { EventAssembler } from '../src/eventStream.js'

it('delivers megabyte replay and concurrent live output in order over a real HTTP socket', async () => {
  const hub = new EventHub()
  const text = 'hello 🌍\n"\\'.repeat(100_000)
  hub.publish('codex', { text })
  const server = createServer((_req, res) => { hub.subscribe(res, 0) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const abort = new AbortController()
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, {
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
    })
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    hub.publish('state', { state: 'live' })
    const decoder = new TextDecoder()
    const assembler = new EventAssembler()
    const received: RemoteEvent[] = []
    let buffer = ''
    for await (const chunk of response.body!) {
      buffer += decoder.decode(chunk, { stream: true })
      let separator: number
      while ((separator = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, separator)
        buffer = buffer.slice(separator + 2)
        const data = frame.split('\n').find(line => line.startsWith('data: '))?.slice(6)
        if (!data) continue
        const encoded = frame.includes('event: fragment') ? assembler.accept(data) : frame.startsWith('id: ') ? data : null
        if (encoded) received.push(JSON.parse(encoded))
      }
      if (received.length === 2) break
    }
    expect(received).toMatchObject([
      { id: 1, replayed: true, payload: { text } },
      { id: 2, payload: { state: 'live' } },
    ])
    expect(received[1].replayed).toBeUndefined()
  } finally {
    abort.abort()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}, 10_000)
