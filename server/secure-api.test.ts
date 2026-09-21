import { mkdtemp, mkdir, writeFile, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it, vi } from 'vitest'
import { createRemoteHttpServer } from './http-app.js'
import { CodexAppServer } from './codex-app-server.js'
import { RemoteController } from './controller.js'
import { SecureTransport } from './secure-client.js'
import { SecureApi } from './secure-api.js'
import { SessionRegistry } from './session-registry.js'
import { createSession } from './auth.js'
import { channelKey, context, importOwner, jsonBytes, randomId, seal, type Challenge } from './secure-wire.js'
import type { RemoteConfig } from './config.js'
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.splice(0).reverse()) await fn() })
async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  return (server.address() as AddressInfo).port
}
async function fixture(simple = false) {
  const root = await mkdtemp(join(tmpdir(), 'secure-api-test-')); cleanup.push(() => rm(root, { recursive: true, force: true }))
  const files = join(root, 'files'); await mkdir(files)
  const material = { version: 1, app: randomId(), generation: randomId(), key: randomId(32) }, file = join(root, 'owner-key.json')
  await writeFile(file, JSON.stringify(material), { mode: 0o600 })
  const config: RemoteConfig = { host: '127.0.0.1', port: 0, publicOrigin: new URL('http://localhost'), password: 'FAKE secure fixture password', sessionSecret: 'fake-secret'.repeat(5), sessionTtlSeconds: 600, codexBin: 'unused', production: true, workspaceRoots: [files], fileRoots: [files], secureApiRequired: true, secureKeyFile: file, sessionStateFile: join(root, 'sessions.json') }
  const registry = new SessionRegistry(config.sessionSecret, config.sessionStateFile, config.password)
  const issued = createSession(config.sessionSecret, 600, config.password)
  const cookie = 'codex_remote_session=' + issued.token
  const controller = new RemoteController(config, new CodexAppServer('unused'))
  let sideEffects = 0, secure: SecureApi | undefined
  const hooks: { dispatch?: (req: IncomingMessage, res: ServerResponse) => Promise<void> } = {}
  if (simple) secure = new SecureApi(config, registry, [files])
  const server = simple ? createServer((req, res) => { void secure!.handle(req, res, async (inside, result) => { if (inside.method === 'POST') sideEffects++; if (hooks.dispatch) return hooks.dispatch(inside, result); result.setHeader('Content-Type', 'application/json'); result.end(JSON.stringify({ path: inside.url, sideEffects })) }) }) : createRemoteHttpServer(config, controller, files, null)
  const port = await listen(server); config.port = port; config.publicOrigin = new URL('http://127.0.0.1:' + port)
  cleanup.push(async () => secure?.close())
  const headers = { Cookie: cookie, Origin: config.publicOrigin.origin }
  const transport = new SecureTransport(fetch, config.publicOrigin.origin, headers)
  cleanup.push(async () => transport.lock())
  const call = (path: string, options: RequestInit = {}) => fetch(config.publicOrigin.origin + path, { ...options, headers: { ...headers, ...options.headers } })
  return { root, files, material, file, config, registry, issued, transport, controller, secure, call, hooks, effects: () => sideEffects }
}
it('requires separate proof, encrypts business requests/responses, preserves CSRF and file rules', async () => {
  const f = await fixture(), path = join(f.files, 'note.txt')
  await writeFile(path, 'PRIVATE TEST CANARY')
  expect((await f.call('/api/files/content?path=' + encodeURIComponent(path))).status).toBe(403)
  await expect(f.transport.unlock(randomId(32))).rejects.toThrow()
  await f.transport.unlock(f.material.key)
  const session = await (await f.transport.request('/api/session')).response.json()
  expect(session.csrf).toBe(f.issued.payload.csrf)
  expect(await (await f.transport.request('/api/files/content?path=' + encodeURIComponent(path))).response.text()).toBe('PRIVATE TEST CANARY')
  expect((await f.transport.request('/api/session/logout', { method: 'POST', body: '{}' })).response.status).toBe(403)
  await writeFile(join(f.files, '.env'), 'FAKE SECRET')
  expect((await f.transport.request('/api/files/content?path=' + encodeURIComponent(join(f.files, '.env')))).response.status).toBe(403)
  await chmod(f.file, 0o644)
  expect((await f.call('/api/secure/setup')).status).toBe(401)
})
it('revalidates current bytes before unchanged and denies deleted cached resources', async () => {
  const f = await fixture(), path = join(f.files, 'note.txt'), resource = randomId()
  await writeFile(path, 'version one'); await f.transport.unlock(f.material.key)
  const url = '/api/files/content?path=' + encodeURIComponent(path)
  const first = await f.transport.request(url, {}, { resource }); expect(await first.response.text()).toBe('version one'); expect(first.meta.revision).toBeTruthy()
  const second = await f.transport.request(url, {}, { resource, revision: first.meta.revision }); expect(second.meta.unchanged).toBe(true); expect(await second.response.text()).toBe('')
  await writeFile(path, 'version two')
  expect(await (await f.transport.request(url, {}, { resource, revision: first.meta.revision })).response.text()).toBe('version two')
  await rm(path)
  const denied = await f.transport.request(url, {}, { resource, revision: first.meta.revision }); expect(denied.response.status).toBe(404); expect(denied.meta.unchanged).not.toBe(true)
})
it('streams larger files and ranges without automatic cache or changed bytes', async () => {
  const f = await fixture(), path = join(f.files, 'large.txt'), bytes = Buffer.alloc(9 * 1024 * 1024, 65)
  await writeFile(path, bytes); await f.transport.unlock(f.material.key)
  const url = '/api/files/content?download=1&path=' + encodeURIComponent(path)
  const result = await f.transport.request(url); expect(result.meta.revision).toBeUndefined()
  expect(Buffer.from(await result.response.arrayBuffer()).equals(bytes)).toBe(true)
  const range = await f.transport.request(url, { headers: { range: 'bytes=5-10' } }); expect(range.response.status).toBe(206); expect(await range.response.text()).toBe('AAAAAA')
  const head = await f.transport.request(url, { method: 'HEAD' }); expect(head.response.headers.get('content-length')).toBe(String(bytes.length)); expect((await head.response.arrayBuffer()).byteLength).toBe(0)
})
it.each([204, 205])('preserves bodyless status %s after authenticating response completion', async status => {
  const f = await fixture(true); await f.transport.unlock(f.material.key)
  f.hooks.dispatch = async (_req, res) => { res.statusCode = status; res.end() }
  const result = await f.transport.request('/api/no-content')
  expect(result.response.status).toBe(status); expect(result.response.body).toBeNull()
})
it('binds one-use proof, rejects concurrent replay/tamper/truncation/reordering before dispatch', async () => {
  const f = await fixture(true), challenge = await (await f.call('/api/secure/challenge', { method: 'POST' })).json() as Challenge
  const owner = await importOwner(f.material.key), proof = await seal(await channelKey(owner, challenge, 'proof'), context(challenge.channel, 'proof', challenge.id, 0, 'proof'), jsonBytes({}))
  const handshake = () => f.call('/api/secure/handshake', { method: 'POST', body: JSON.stringify({ id: challenge.id, proof }) })
  expect((await handshake()).status).toBe(200); expect((await handshake()).status).toBe(401)
  const key = await channelKey(owner, challenge, 'request')
  const build = async (request: string) => [await seal(key, context(challenge.channel, 'request', request, 0, 'head'), jsonBytes({ method: 'POST', path: '/api/mutation', headers: {}, resource: randomId() })), await seal(key, context(challenge.channel, 'request', request, 1, 'end'), jsonBytes({ bytes: 0, chunks: 0 }))]
  const send = (request: string, parts: string[]) => f.call('/api/secure/request', { method: 'POST', headers: { 'X-Secure-Channel': challenge.channel, 'X-Secure-Request': request }, body: parts.join('\n') + '\n' })
  const request = randomId(), packets = await build(request)
  const results = await Promise.all([send(request, packets), send(request, packets)])
  expect(results.map(r => r.status).sort()).toEqual([200, 409]); await Promise.all(results.map(r => r.arrayBuffer())); expect(f.effects()).toBe(1)
  for (const kind of ['truncate', 'reorder', 'tamper', 'crossrequest']) {
    const fresh = randomId(), p = await build(fresh)
    if (kind === 'truncate') p.pop()
    if (kind === 'reorder') p.reverse()
    if (kind === 'tamper') p[0] = p[0].slice(0, -5) + 'xxxxx'
    expect((await send(kind === 'crossrequest' ? randomId() : fresh, p)).status).toBe(400)
  }
  expect(f.effects()).toBe(1)
})
it('invalidates active streams and old channels on logout/expiry/key rotation', async () => {
  const f = await fixture(); await f.transport.unlock(f.material.key)
  const stream = await f.transport.request('/api/events'), reader = stream.response.body!.getReader()
  await reader.read()
  const logout = await f.transport.request('/api/session/logout', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': f.issued.payload.csrf }, body: '{}' })
  expect(await logout.response.json()).toEqual({ ok: true })
  await expect((async () => { while (!(await reader.read()).done) { /* drain verified records */ } })()).rejects.toThrow()
  await expect(f.transport.request('/api/session')).rejects.toMatchObject({ status: 401 })
  const rotated = await fixture(); await rotated.transport.unlock(rotated.material.key)
  await writeFile(rotated.file, JSON.stringify({ ...rotated.material, generation: randomId(), key: randomId(32) }))
  await expect(rotated.transport.request('/api/session')).rejects.toMatchObject({ status: 412 })
})
it('bounds pending challenges per session and expires them before reuse', async () => {
  const f = await fixture(true)
  for (let i = 0; i < 4; i++) expect((await f.call('/api/secure/challenge', { method: 'POST' })).status).toBe(200)
  expect((await f.call('/api/secure/challenge', { method: 'POST' })).status).toBe(429)
  expect(f.secure!.stats.challenges).toBe(4)
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31000)
  expect((await f.call('/api/secure/challenge', { method: 'POST' })).status).toBe(200)
  expect(f.secure!.stats.challenges).toBe(1)
})
it('rejects expired sessions and password-only restart with both cookie and old channel material', async () => {
  const f = await fixture(true); await f.transport.unlock(f.material.key)
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 601000)
  await expect(f.transport.request('/api/anything')).rejects.toMatchObject({ status: 401 })
  vi.restoreAllMocks()
  const changed = new SessionRegistry(f.config.sessionSecret, f.config.sessionStateFile, 'NEW FAKE PASSWORD')
  const next = new SecureApi({ ...f.config, password: 'NEW FAKE PASSWORD' }, changed, [f.files])
  cleanup.push(async () => next.close())
  const port = await listen(createServer((req, res) => { void next.handle(req, res, async (_req, inside) => inside.end('private')) }))
  const response = await fetch('http://127.0.0.1:' + port + '/api/secure/challenge', { method: 'POST', headers: { Origin: f.config.publicOrigin.origin, Cookie: 'codex_remote_session=' + f.issued.token } })
  expect(response.status).toBe(401)
})
it('detects tampered/truncated response completion and reports uncertain mutation without retry', async () => {
  const f = await fixture(true)
  const sender: typeof fetch = async (input, init) => {
    const response = await fetch(input, init)
    if (String(input).endsWith('/api/secure/request') && response.ok) {
      const packets = (await response.text()).trimEnd().split('\n'); packets.pop()
      return new Response(packets.join('\n') + '\n', { status: 200 })
    }
    return response
  }
  const client = new SecureTransport(sender, f.config.publicOrigin.origin, { Origin: f.config.publicOrigin.origin, Cookie: 'codex_remote_session=' + f.issued.token })
  await client.unlock(f.material.key)
  const result = await client.request('/api/mutation', { method: 'POST', body: '{}' })
  await expect(result.response.text()).rejects.toThrow('uncertain')
  expect(f.effects()).toBe(1); client.lock()
})
it('never reinstates an owner key when lock races an asynchronous unlock', async () => {
  const f = await fixture(true)
  const unlocking = f.transport.unlock(f.material.key)
  f.transport.lock()
  await expect(unlocking).rejects.toThrow('cancelled')
  expect(f.transport.unlocked).toBe(false)
  await expect(f.transport.request('/api/anything')).rejects.toMatchObject({ status: 423 })
})
it('rejects proof/request reuse across sessions and channels while independent requests run concurrently', async () => {
  const f = await fixture(true), owner = await importOwner(f.material.key)
  const challenge = await (await f.call('/api/secure/challenge', { method: 'POST' })).json() as Challenge
  const proof = await seal(await channelKey(owner, challenge, 'proof'), context(challenge.channel, 'proof', challenge.id, 0, 'proof'), jsonBytes({}))
  const other = createSession(f.config.sessionSecret, 600, f.config.password)
  const handshake = { method: 'POST', body: JSON.stringify({ id: challenge.id, proof }) }
  expect((await f.call('/api/secure/handshake', { ...handshake, headers: { Cookie: 'codex_remote_session=' + other.token } })).status).toBe(401)
  expect((await f.call('/api/secure/handshake', handshake)).status).toBe(200)
  const key = await channelKey(owner, challenge, 'request'), request = randomId()
  const packets = [await seal(key, context(challenge.channel, 'request', request, 0, 'head'), jsonBytes({ method: 'POST', path: '/api/mutation', headers: {}, resource: randomId() })), await seal(key, context(challenge.channel, 'request', request, 1, 'end'), jsonBytes({ bytes: 0, chunks: 0 }))].join('\n') + '\n'
  expect((await f.call('/api/secure/request', { method: 'POST', headers: { Cookie: 'codex_remote_session=' + other.token, 'X-Secure-Channel': challenge.channel, 'X-Secure-Request': request }, body: packets })).status).toBe(412)
  const second = await (await f.call('/api/secure/challenge', { method: 'POST' })).json() as Challenge
  const secondProof = await seal(await channelKey(owner, second, 'proof'), context(second.channel, 'proof', second.id, 0, 'proof'), jsonBytes({}))
  expect((await f.call('/api/secure/handshake', { method: 'POST', body: JSON.stringify({ id: second.id, proof: secondProof }) })).status).toBe(200)
  expect((await f.call('/api/secure/request', { method: 'POST', headers: { 'X-Secure-Channel': second.channel, 'X-Secure-Request': request }, body: packets })).status).toBe(400)
  expect(f.effects()).toBe(0)
  await f.transport.unlock(f.material.key)
  const paths = Array.from({ length: 8 }, (_, n) => '/api/parallel?number=' + n)
  const replies = await Promise.all(paths.map(async path => (await f.transport.request(path)).response.json()))
  expect(replies.map(r => r.path)).toEqual(paths)
})
it.each(['revoke', 'expiry'])('does not dispatch when %s races request decryption', async kind => {
  const f = await fixture(true); await f.transport.unlock(f.material.key)
  const decrypt = crypto.subtle.decrypt.bind(crypto.subtle)
  vi.spyOn(crypto.subtle, 'decrypt').mockImplementation(async (...args) => {
    const value = await decrypt(...args)
    if (kind === 'revoke') f.registry.revoke(f.issued.payload)
    else vi.spyOn(Date, 'now').mockReturnValue(f.issued.payload.expiresAt * 1000 + 1)
    return value
  })
  await expect(f.transport.request('/api/mutation', { method: 'POST', body: '{}' })).rejects.toThrow()
  expect(f.effects()).toBe(0)
})
it.each(['revoke', 'expiry'])('never returns cached unchanged after %s during response sealing', async kind => {
  const f = await fixture(true), resource = randomId(); await f.transport.unlock(f.material.key)
  const initial = await f.transport.request('/api/read', {}, { resource }); await initial.response.text()
  const encrypt = crypto.subtle.encrypt.bind(crypto.subtle)
  let processing = false
  f.hooks.dispatch = async (_req, res) => { processing = true; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ path: '/api/read', sideEffects: 0 })) }
  vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (...args) => {
    const value = await encrypt(...args)
    if (processing) {
      if (kind === 'revoke') f.registry.revoke(f.issued.payload)
      else vi.spyOn(Date, 'now').mockReturnValue(f.issued.payload.expiresAt * 1000 + 1)
    }
    return value
  })
  await expect(f.transport.request('/api/read', {}, { resource, revision: initial.meta.revision })).rejects.toThrow()
})
it.each(['tamper', 'reorder', 'extra'])('rejects %s in response frames with no successful partial JSON', async kind => {
  const f = await fixture(true)
  const sender: typeof fetch = async (input, init) => {
    const response = await fetch(input, init)
    if (!String(input).endsWith('/api/secure/request') || !response.ok) return response
    const frames = (await response.text()).trimEnd().split('\n')
    if (kind === 'tamper') frames[1] = frames[1].slice(0, -5) + 'xxxxx'
    if (kind === 'reorder') [frames[1], frames[2]] = [frames[2], frames[1]]
    if (kind === 'extra') frames.push(frames[1])
    return new Response(frames.join('\n') + '\n')
  }
  const client = new SecureTransport(sender, f.config.publicOrigin.origin, { Origin: f.config.publicOrigin.origin, Cookie: 'codex_remote_session=' + f.issued.token })
  cleanup.push(async () => client.lock()); await client.unlock(f.material.key)
  const result = await client.request('/api/read'); await expect(result.response.json()).rejects.toThrow()
})
it('does not compare a revision from a different representation with identical bytes', async () => {
  const f = await fixture(true), resource = randomId(); await f.transport.unlock(f.material.key)
  f.hooks.dispatch = async (_req, res) => { res.end('same body') }
  const one = await f.transport.request('/api/first', {}, { resource }); await one.response.text()
  const other = await f.transport.request('/api/second', {}, { resource, revision: one.meta.revision })
  expect(other.meta.unchanged).toBe(false); expect(await other.response.text()).toBe('same body')
})
it('evicts idle channels left by reloads and never grows beyond the session cap', async () => {
  const f = await fixture(true)
  for (let i = 0; i < 12; i++) { await f.transport.unlock(f.material.key); expect(f.secure!.stats.channels).toBeLessThanOrEqual(8) }
  expect(await (await f.transport.request('/api/read')).response.json()).toMatchObject({ path: '/api/read' })
})
it('bounds incomplete authenticated requests and releases buffers on disconnect without side effects', async () => {
  const f = await fixture(true), owner = await importOwner(f.material.key)
  const challenge = await (await f.call('/api/secure/challenge', { method: 'POST' })).json() as Challenge
  const proof = await seal(await channelKey(owner, challenge, 'proof'), context(challenge.channel, 'proof', challenge.id, 0, 'proof'), jsonBytes({}))
  expect((await f.call('/api/secure/handshake', { method: 'POST', body: JSON.stringify({ id: challenge.id, proof }) })).status).toBe(200)
  const key = await channelKey(owner, challenge, 'request'), abort = new AbortController()
  cleanup.push(async () => abort.abort())
  const pending: Promise<unknown>[] = []
  for (let i = 0; i < 12; i++) {
    const request = randomId(), head = await seal(key, context(challenge.channel, 'request', request, 0, 'head'), jsonBytes({ method: 'POST', path: '/api/mutation', headers: {}, resource: randomId() }))
    const body = await seal(key, context(challenge.channel, 'request', request, 1, 'body'), new Uint8Array(1024))
    pending.push(f.call('/api/secure/request', { method: 'POST', headers: { 'X-Secure-Channel': challenge.channel, 'X-Secure-Request': request }, signal: abort.signal, body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(head + '\n' + body + '\n')) } }), duplex: 'half' } as RequestInit).catch(() => null))
  }
  await expect.poll(() => f.secure!.stats.active).toBe(12)
  expect(f.secure!.stats.bufferedBytes).toBeLessThanOrEqual(12 * 1024)
  const denied = await f.call('/api/secure/request', { method: 'POST', headers: { 'X-Secure-Channel': challenge.channel, 'X-Secure-Request': randomId() }, body: '' })
  expect(denied.status).toBe(429); expect(f.effects()).toBe(0)
  abort.abort(); await Promise.all(pending)
  await expect.poll(() => f.secure!.stats.active).toBe(0)
  expect(f.secure!.stats.bufferedBytes).toBe(0)
})

it('admits bounded proof attempts before body and ignores spoofed IP churn', async () => {
  const f = await fixture(true)
  for (let i = 0; i < 8; i++) {
    expect((await f.call('/api/secure/handshake', { method: 'POST', body: '{}', headers: { 'X-Real-IP': `192.0.2.${i}`, 'X-Forwarded-For': `192.0.2.${i}` } })).status).toBe(401)
  }
  // An unfinished body must not delay rejection once admission is exhausted.
  const abort = new AbortController()
  const response = await f.call('/api/secure/handshake', { method: 'POST', signal: abort.signal, body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{')) } }), duplex: 'half' } as RequestInit)
  expect(response.status).toBe(429); expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0); abort.abort()
  const later = Date.now() + 16 * 60_000
  vi.spyOn(Date, 'now').mockReturnValue(later)
  // Use a new session: expired sessions never reach proof admission.
  const issued = createSession(f.config.sessionSecret, 600, f.config.password)
  expect((await f.call('/api/secure/handshake', { method: 'POST', body: '{}', headers: { Cookie: 'codex_remote_session=' + issued.token } })).status).toBe(401)
})
