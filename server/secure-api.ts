import type { SecureKey } from './secure-wire.js'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { decodeProtectedHeader } from 'jose'
import { getSession, type SessionPayload } from './auth.js'
import type { RemoteConfig } from './config.js'
import { SessionRegistry } from './session-registry.js'
import { readOwnerKey, type OwnerKeyFile } from './secure-key.js'
import { SecureResponse } from './secure-response.js'
import { channelKey, context, importOwner, jsonBytes, MAX_REQUEST_BYTES, randomId, seal, text, unseal, wireLines, type Challenge } from './secure-wire.js'
type Channel = { request: SecureKey; response: SecureKey; session: SessionPayload; expires: number; seen: Set<string>; active: Set<ServerResponse>; unwatch: () => void }
type Pending = { challenge: Challenge; session: SessionPayload }
type Dispatch = (req: IncomingMessage, res: ServerResponse) => Promise<void>
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(value)
const minimal = (res: ServerResponse, status: number, value: object = { error: 'Secure API unavailable' }) => {
  if (res.destroyed || res.writableEnded) return
  if (res.headersSent) { res.destroy(); return }
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value))
}
async function smallJson(req: IncomingMessage) {
  const parts: Buffer[] = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > 4096) throw Error(); parts.push(Buffer.from(chunk)) }
  return JSON.parse(Buffer.concat(parts).toString()) as Record<string, unknown>
}
export class SecureApi {
  #material: OwnerKeyFile
  #owner: Promise<SecureKey>
  #pending = new Map<string, Pending>()
  #channels = new Map<string, Channel>()
  #handshakes = new Set<string>()
  #active = 0
  #bytes = 0
  #timer: NodeJS.Timeout
  constructor(readonly config: RemoteConfig, readonly sessions: SessionRegistry, readonly roots: string[]) {
    this.#material = readOwnerKey(config.secureKeyFile!, roots); this.#owner = importOwner(this.#material.key)
    this.#timer = setInterval(() => { try { this.#refresh(); this.#prune() } catch { this.closeChannels() } }, 1000); this.#timer.unref()
  }
  #refresh() {
    const next = readOwnerKey(this.config.secureKeyFile!, this.roots)
    if (JSON.stringify(next) !== JSON.stringify(this.#material)) {
      this.closeChannels(); this.#pending.clear()
      if (next.generation === this.#material.generation) throw Error('Rotate key generation too')
      this.#material = next; this.#owner = importOwner(next.key)
    }
  }
  #drop(key: string) {
    const channel = this.#channels.get(key)
    this.#channels.delete(key)
    if (channel) { channel.unwatch(); for (const response of channel.active) response.destroy() }
  }
  closeChannels() { for (const key of this.#channels.keys()) this.#drop(key) }
  close() { clearInterval(this.#timer); this.closeChannels(); this.#pending.clear() }
  #prune() {
    for (const [key, value] of this.#pending) if (value.challenge.expiresAt <= Date.now() || !this.sessions.valid(value.session)) this.#pending.delete(key)
    for (const [key, value] of this.#channels) if (value.expires <= Date.now() || !this.sessions.valid(value.session)) this.#drop(key)
  }
  get stats() { return { challenges: this.#pending.size, channels: this.#channels.size, active: this.#active, bufferedBytes: this.#bytes } }
  #budget = (delta: number) => { if (this.#bytes + delta > 64 * 1024 * 1024) return false; this.#bytes = Math.max(0, this.#bytes + delta); return true }
  async handle(req: IncomingMessage, res: ServerResponse, dispatch: Dispatch): Promise<void> {
    let timer: NodeJS.Timeout | undefined
    try {
      this.#refresh(); this.#prune()
      const url = new URL(req.url!, this.config.publicOrigin)
      if (url.pathname === '/api/secure/setup' && req.method === 'GET') {
        minimal(res, 200, { required: true, version: 1, app: this.#material.app, generation: this.#material.generation }); return
      }
      const session = getSession(req, this.config.sessionSecret, this.config.publicOrigin.protocol === 'https:', this.config.password)
      if (!session || !this.sessions.valid(session)) { minimal(res, 401); return }
      if (req.headers.origin !== this.config.publicOrigin.origin || req.method !== 'POST') { minimal(res, 403); return }
      // A 25 MiB upload grows to about 34 MiB on the wire. Allow bounded slow
      // uploads; challenge/handshake still have a short admission deadline.
      timer = setTimeout(() => res.destroy(), url.pathname === '/api/secure/request' ? 300_000 : 30_000); timer.unref()
      if (url.pathname === '/api/secure/challenge') {
        if (this.#pending.size >= 128 || [...this.#pending.values()].filter(p => p.session.nonce === session.nonce).length >= 4) { minimal(res, 429); return }
        const challenge: Challenge = { v: 1, id: randomId(), channel: randomId(), salt: randomId(32), app: this.#material.app, generation: this.#material.generation, binding: createHash('sha256').update(session.nonce + ':' + session.credentialVersion).digest('base64url'), expiresAt: Date.now() + 30_000 }
        this.#pending.set(challenge.id, { challenge, session }); minimal(res, 200, challenge); return
      }
      if (url.pathname === '/api/secure/handshake') {
        if (this.#handshakes.size >= 8 || this.#handshakes.has(session.nonce)) { minimal(res, 429); return }
        this.#handshakes.add(session.nonce)
        try {
        const data = await smallJson(req), entry = typeof data.id === 'string' ? this.#pending.get(data.id) : undefined
        if (!entry || entry.session.nonce !== session.nonce || typeof data.proof !== 'string') { minimal(res, 401); return }
        this.#pending.delete(entry.challenge.id) // consume before asynchronous authentication
        const challenge = entry.challenge, owner = await this.#owner
        await unseal(await channelKey(owner, challenge, 'proof'), context(challenge.channel, 'proof', challenge.id, 0, 'proof'), data.proof)
        // Retire idle channels left by closed/reloaded pages, only after valid proof.
        for (const [key, value] of this.#channels) {
          if (value.active.size === 0 && (this.#channels.size + this.#handshakes.size >= 64 || (value.session.nonce === session.nonce && [...this.#channels.values()].filter(c => c.session.nonce === session.nonce).length >= 8))) this.#drop(key)
        }
        if (this.#channels.size + this.#handshakes.size > 64 || [...this.#channels.values()].filter(c => c.session.nonce === session.nonce).length >= 8) { minimal(res, 429); return }
        this.#refresh()
        if (challenge.expiresAt <= Date.now() || challenge.generation !== this.#material.generation || !this.sessions.valid(session)) throw Error()
        const channel: Channel = { request: await channelKey(owner, challenge, 'request'), response: await channelKey(owner, challenge, 'response'), session, expires: Math.min(session.expiresAt * 1000, Date.now() + 15 * 60_000), seen: new Set(), active: new Set(), unwatch: () => {} }
        this.#refresh()
        if (challenge.generation !== this.#material.generation || !this.sessions.valid(session)) throw Error()
        this.#channels.set(challenge.channel, channel)
        channel.unwatch = this.sessions.watch(session, () => this.#drop(challenge.channel))
        const proof = await seal(channel.response, context(challenge.channel, 'response', challenge.id, 0, 'ready'), jsonBytes({ ready: true, expiresAt: channel.expires }))
        this.#refresh()
        if (this.#channels.get(challenge.channel) !== channel || !this.sessions.valid(session) || channel.expires <= Date.now()) throw Error()
        minimal(res, 200, { channel: challenge.channel, proof }); return
        } finally { this.#handshakes.delete(session.nonce) }
      }
      if (url.pathname !== '/api/secure/request') { minimal(res, 404); return }
      const channelId = req.headers['x-secure-channel'], requestId = req.headers['x-secure-request']
      if (!id(channelId) || !id(requestId)) { minimal(res, 400); return }
      const channel = this.#channels.get(channelId)
      if (!channel || channel.session.nonce !== session.nonce || channel.expires <= Date.now()) { minimal(res, 412); return }
      if (channel.seen.has(requestId)) { minimal(res, 409); return }
      if (channel.seen.size >= 2048) { minimal(res, 412); return }
      if (this.#active >= 32 || channel.active.size >= 12) { minimal(res, 429); return }
      channel.seen.add(requestId); channel.active.add(res); this.#active++
      let released = false, inputBytes = 0
      const release = () => { if (released) return; released = true; channel.active.delete(res); this.#active--; this.#budget(-inputBytes); inputBytes = 0 }
      res.once('close', release)
      const valid = () => this.#channels.get(channelId) === channel && this.sessions.valid(session) && channel.expires > Date.now()
      try {
        const lines = wireLines(req), first = await lines.next()
        if (first.done || !valid()) throw Error()
        const head = JSON.parse(text.decode(await unseal(channel.request, context(channelId, 'request', requestId, 0, 'head'), first.value))) as { method: string; path: string; headers: Record<string, string>; resource: string; revision?: string }
        if (!['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(head.method) || typeof head.path !== 'string' || head.path.length > 16384 || !head.path.startsWith('/api/') || head.path.startsWith('/api/secure/') || head.path === '/api/session/login' || /[\r\n\\#]/.test(head.path) || !id(head.resource) || (head.revision !== undefined && !id(head.revision))) throw Error()
        const allowed = new Set(['content-type', 'x-csrf-token', 'range', 'last-event-id'])
        if (!head.headers || Object.entries(head.headers).some(([k, v]) => !allowed.has(k) || typeof v !== 'string' || v.length > 1024 || /[\r\n]/.test(v))) throw Error()
        const parts: Buffer[] = []; let sequence = 1, count = 0, complete = false
        for await (const line of lines) {
          if (complete || !valid()) throw Error()
          const kind = decodeProtectedHeader(line).k
          if (kind !== 'body' && kind !== 'end') throw Error()
          const value = await unseal(channel.request, context(channelId, 'request', requestId, sequence++, kind), line)
          if (kind === 'end') {
            const end = JSON.parse(text.decode(value)); if (end.bytes !== inputBytes || end.chunks !== count) throw Error(); complete = true
          } else {
            if (value.length > 65536 || inputBytes + value.length > MAX_REQUEST_BYTES || !this.#budget(value.length)) throw Error()
            inputBytes += value.length; count++; parts.push(Buffer.from(value))
          }
        }
        this.#refresh()
        if (!complete || !valid()) throw Error()
        clearTimeout(timer); timer = undefined
        const inner = Readable.from(parts) as IncomingMessage
        Object.assign(inner, { method: head.method, url: head.path, headers: { ...head.headers, host: req.headers.host, cookie: req.headers.cookie, origin: req.headers.origin, 'content-length': String(inputBytes) }, socket: req.socket })
        // Logout may revoke its own channel; only its minimal completion may finish.
        const logout = head.path === '/api/session/logout' && head.method === 'POST'
        if (logout) channel.active.delete(res)
        const response = new SecureResponse(res, channel.response, channelId, requestId, head.resource, logout ? () => true : valid,
          head.method === 'GET' && !['/api/events', '/api/session'].includes(head.path.split('?')[0]), head.revision, this.#budget, JSON.stringify([head.method, head.path, head.headers.range ?? '', head.headers['content-type'] ?? '']))
        res.once('close', () => inner.destroy())
        await dispatch(inner, response as unknown as ServerResponse)
        // The response/stream owns lifetime now. Input is no longer needed by dispatcher.
        this.#budget(-inputBytes); inputBytes = 0
      } catch { release(); minimal(res, 400) }
    } catch { minimal(res, 401) }
    finally { clearTimeout(timer) }
  }
}
