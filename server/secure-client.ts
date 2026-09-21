import type { SecureKey } from './secure-wire.js'
import { decodeProtectedHeader } from 'jose'
import { channelKey, context, FRAME_BYTES, importOwner, jsonBytes, MAX_REQUEST_BYTES, randomId, seal, text, unseal, webBytes, wireLines, type Challenge, type SecureMetadata } from './secure-wire.js'
import type { ResponseMeta } from './secure-response.js'
export class SecureTransportError extends Error { constructor(readonly status: number, message: string) { super(message) } }
type Ready = { id: string; request: SecureKey; response: SecureKey; expires: number }
export class SecureTransport {
  #owner?: SecureKey
  #channel?: Ready
  #connecting?: Promise<void>
  #epoch = 0
  #requests = new Set<AbortController>()
  constructor(readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis), readonly origin = '', readonly publicHeaders: ConstructorParameters<typeof Headers>[0] = {}) {}
  get unlocked() { return Boolean(this.#owner) }
  get owner() { return this.#owner }
  async setup(): Promise<SecureMetadata> {
    const res = await this.#public('/api/secure/setup')
    if (!res.ok) throw new SecureTransportError(res.status, 'Secure setup unavailable')
    const value = await res.json() as SecureMetadata
    if (!value || value.version !== 1 || typeof value.required !== 'boolean' || (value.required && (![value.app, value.generation].every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(id))))) throw Error('Invalid secure setup')
    return value
  }
  #public(path: string, init: RequestInit = {}) {
    const headers = new Headers(this.publicHeaders); new Headers(init.headers).forEach((v, k) => headers.set(k, v))
    return this.fetcher(this.origin + path, { ...init, headers, credentials: 'same-origin', cache: 'no-store' })
  }
  async unlock(value: string) {
    this.lock(); const epoch = this.#epoch, owner = await importOwner(value)
    if (epoch !== this.#epoch) throw Error('Unlock cancelled')
    this.#owner = owner
    try { await this.connect(); if (epoch !== this.#epoch) throw Error('Unlock cancelled') } catch (error) { if (epoch === this.#epoch) this.lock(); throw error }
  }
  lock() { this.#epoch++; this.#owner = undefined; this.#channel = undefined; this.#connecting = undefined; for (const controller of this.#requests) controller.abort(); this.#requests.clear() }
  async connect() {
    if (this.#channel && this.#channel.expires > Date.now() + 5000) return
    if (this.#connecting) return this.#connecting
    const epoch = this.#epoch, owner = this.#owner
    if (!owner) throw new SecureTransportError(423, 'Unlock first')
    const assertLive = () => { if (epoch !== this.#epoch || owner !== this.#owner) throw Error('Handshake cancelled') }
    const operation = (async () => {
      assertLive()
      const result = await this.#public('/api/secure/challenge', { method: 'POST' })
      assertLive()
      if (!result.ok) throw new SecureTransportError(result.status, 'Sign in before unlocking')
      const challenge = await result.json() as Challenge; assertLive()
      if (challenge.v !== 1 || challenge.expiresAt <= Date.now()) throw Error('Invalid challenge')
      const proof = await seal(await channelKey(owner, challenge, 'proof'), context(challenge.channel, 'proof', challenge.id, 0, 'proof'), jsonBytes({ challenge: challenge.id }))
      assertLive()
      const response = await this.#public('/api/secure/handshake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: challenge.id, proof }) })
      assertLive()
      if (!response.ok) throw new SecureTransportError(response.status, 'Unlock key rejected or session expired')
      const ready = await response.json() as { channel: string; proof: string }
      const responseKey = await channelKey(owner, challenge, 'response')
      const ack = JSON.parse(text.decode(await unseal(responseKey, context(challenge.channel, 'response', challenge.id, 0, 'ready'), ready.proof)))
      const requestKey = await channelKey(owner, challenge, 'request')
      if (ready.channel !== challenge.channel || ack.ready !== true || !Number.isFinite(ack.expiresAt) || epoch !== this.#epoch) throw Error('Stale handshake')
      this.#channel = { id: ready.channel, request: requestKey, response: responseKey, expires: ack.expiresAt }
    })()
    this.#connecting = operation
    try { await operation } finally { if (this.#connecting === operation) this.#connecting = undefined }
  }
  async request(path: string, init: RequestInit = {}, cache?: { resource: string; revision?: string }): Promise<{ response: Response; meta: ResponseMeta }> {
    const epoch = this.#epoch
    await this.connect()
    if (epoch !== this.#epoch || init.signal?.aborted) throw Error('Secure request cancelled')
    const channel = this.#channel!, requestId = randomId(), resource = cache?.resource ?? randomId()
    const controller = new AbortController(); this.#requests.add(controller)
    const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal
    let transferred = false
    let dispatched = false
    const cleanup = () => this.#requests.delete(controller)
    try {
      const method = init.method ?? 'GET', headers = Object.fromEntries(new Headers(init.headers).entries())
      let sequence = 0, bytes = 0, chunks = 0
      const parts: string[] = [(await seal(channel.request, context(channel.id, 'request', requestId, sequence++, 'head'), jsonBytes({ method, path, headers, resource, revision: cache?.revision }))) + '\n']
      if (init.body !== undefined && init.body !== null) {
        const body = new Response(init.body).body!
        for await (const chunk of webBytes(body)) {
          for (let offset = 0; offset < chunk.length; offset += FRAME_BYTES) {
            const part = chunk.slice(offset, offset + FRAME_BYTES)
            bytes += part.length; chunks++
            if (bytes > MAX_REQUEST_BYTES || signal.aborted || epoch !== this.#epoch) throw Error('Upload exceeds limit or was cancelled')
            parts.push((await seal(channel.request, context(channel.id, 'request', requestId, sequence++, 'body'), part)) + '\n')
          }
        }
      }
      parts.push((await seal(channel.request, context(channel.id, 'request', requestId, sequence++, 'end'), jsonBytes({ bytes, chunks }))) + '\n')
      if (signal.aborted || epoch !== this.#epoch) throw Error('Secure request cancelled')
      dispatched = true
      const result = await this.#public('/api/secure/request', { method: 'POST', signal, headers: { 'Content-Type': 'application/x-codex-secure', 'X-Secure-Channel': channel.id, 'X-Secure-Request': requestId }, body: new Blob(parts) })
      if (!result.ok) {
        if (result.status === 412 && epoch === this.#epoch && this.#channel === channel) this.#channel = undefined
        throw new SecureTransportError(result.status, result.status === 409 ? 'Duplicate request rejected; check current state before retrying.' : 'Secure request rejected. Reconnect or unlock again.')
      }
      if (!result.body || epoch !== this.#epoch) throw Error('Secure request cancelled')
      const lines = wireLines(webBytes(result.body)), first = await lines.next()
      if (first.done) throw Error('Missing secure response')
      const meta = JSON.parse(text.decode(await unseal(channel.response, context(channel.id, 'response', requestId, 0, 'head'), first.value))) as ResponseMeta
      if (epoch !== this.#epoch || signal.aborted) throw Error('Secure request cancelled')
      if (meta.resource !== resource || !Number.isInteger(meta.status) || meta.status < 200 || meta.status > 599 || !meta.headers) throw Error('Invalid response metadata')
      let nextSequence = 1, received = 0, count = 0
      const stream = new ReadableStream<Uint8Array>({
        pull: async target => {
          try {
            if (signal.aborted || epoch !== this.#epoch) throw Error('Secure stream closed')
            const next = await lines.next()
            if (next.done) throw Error('Truncated secure response')
            const kind = decodeProtectedHeader(next.value).k
            if (kind !== 'body' && kind !== 'end') throw Error('Invalid response framing')
            const value = await unseal(channel.response, context(channel.id, 'response', requestId, nextSequence++, kind), next.value)
            if (signal.aborted || epoch !== this.#epoch) throw Error('Secure stream closed')
            if (kind === 'end') {
              const end = JSON.parse(text.decode(value))
              if (end.bytes !== received || end.chunks !== count || !(await lines.next()).done) throw Error('Invalid response completion')
              if (signal.aborted || epoch !== this.#epoch) throw Error('Secure stream closed')
              target.close(); cleanup()
            } else { if (value.length > FRAME_BYTES) throw Error('Oversized response'); received += value.length; count++; target.enqueue(value) }
          } catch (error) { controller.abort(); cleanup(); target.error(!['GET', 'HEAD'].includes(method) ? new SecureTransportError(0, 'Result is uncertain after connection loss. Check current state before retrying this action.') : error) }
        },
        cancel: async () => { controller.abort(); cleanup(); await lines.return(undefined) },
      })
      transferred = true
      const responseHeaders = new Headers(meta.headers)
      if (meta.unchanged) responseHeaders.delete('content-length')
      // Bodyless HTTP statuses still require an authenticated tunnel end frame.
      if ([204, 205, 304].includes(meta.status)) {
        if ((await new Response(stream).arrayBuffer()).byteLength) throw Error('Unexpected body for a bodyless response')
        return { response: new Response(null, { status: meta.status, headers: responseHeaders }), meta }
      }
      return { response: new Response(stream, { status: meta.status, headers: responseHeaders }), meta }
    } catch (error) {
      if (dispatched && init.method && !['GET', 'HEAD'].includes(init.method) && !(error instanceof SecureTransportError)) throw new SecureTransportError(0, 'Result is uncertain after connection loss. Check current state before retrying this action.')
      throw error
    } finally { if (!transferred) { controller.abort(); cleanup() } }
  }
}
