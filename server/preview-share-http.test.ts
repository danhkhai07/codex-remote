import { createServer, request, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { connect, type AddressInfo, type Socket } from 'node:net'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createRemoteHttpServer } from './http-app.js'
import { RemoteController } from './controller.js'
import { CodexAppServer } from './codex-app-server.js'
import { ServicesStore } from './services.js'
import { SecureTransport } from './secure-client.js'
import { randomId } from './secure-wire.js'
import { createSession } from './auth.js'
import { SHARE_COOKIE, type PreviewShare } from './preview-shares.js'
import { SHARE_EXCHANGE } from './preview-share-page.js'
import type { RemoteConfig } from './config.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function listen(server: Server) {
  const sockets = new Set<Socket>(); server.on('connection', s => { sockets.add(s); s.once('close', () => sockets.delete(s)) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>(resolve => { for (const s of sockets) s.destroy(); server.close(() => resolve()) }))
  return (server.address() as AddressInfo).port
}
type Response = { status: number; headers: IncomingMessage['headers']; body: string }
function raw(port: number, host: string, path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: { host, ...options.headers } }, res => {
      let body = ''; res.on('data', chunk => { body += chunk }); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body })); res.on('error', reject)
    }); req.on('error', reject); req.end(options.body)
  })
}
async function fixture(handler: (req: IncomingMessage, res: ServerResponse) => void = (req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ headers: req.headers, path: req.url })) }, probe: () => Promise<boolean> = async () => true) {
  const root = mkdtempSync(join(tmpdir(), 'share-http-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  const files = join(root, 'files'); mkdirSync(files)
  const key = { version: 1, app: randomId(), generation: randomId(), key: randomId(32) }, file = join(root, 'key.json')
  writeFileSync(file, JSON.stringify(key), { mode: 0o600 })
  const upstream = createServer(handler), appPort = await listen(upstream)
  const services = new ServicesStore(join(root, 'services.json'), probe)
  services.upsert({ port: appPort, name: 'Fixture', summary: 'Fake service only', prLabel: 'no PR', path: '/app?q=1#part' })
  const config: RemoteConfig = { host: '127.0.0.1', port: 0, publicOrigin: new URL('https://owner.test'),
    password: 'FAKE share fixture password', sessionSecret: 'fake-secret'.repeat(5), sessionTtlSeconds: 600, codexBin: 'unused', production: true,
    workspaceRoots: [files], fileRoots: [files], secureApiRequired: true, secureKeyFile: file, sessionStateFile: join(root, 'sessions.json'),
    previewOriginTemplate: 'https://p{port}.preview.test', previewSharePorts: [appPort] }
  const issued = createSession(config.sessionSecret, 600, config.password), ownerCookie = '__Host-codex_remote_session=' + issued.token
  const controller = new RemoteController(config, new CodexAppServer('unused'))
  const server = createRemoteHttpServer(config, controller, files, null, undefined, undefined, undefined, undefined, undefined, services)
  const gateway = await listen(server); config.port = gateway
  const host = `p${appPort}.preview.test`
  const transportFetch: typeof fetch = (url, init) => fetch(`http://127.0.0.1:${gateway}${new URL(String(url)).pathname}`, {
    ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), host: 'owner.test' },
  })
  const transport = new SecureTransport(transportFetch, 'https://owner.test', { Cookie: ownerCookie, Origin: 'https://owner.test' }); cleanup.push(() => transport.lock())
  await transport.unlock(key.key)
  const api = async (path: string, method = 'GET', body?: unknown) => (await transport.request(path, { method,
    headers: { 'content-type': 'application/json', 'x-csrf-token': issued.payload.csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })).response
  const create = async (ttlSeconds = 3600) => { const response = await api('/api/preview-shares', 'POST', { port: appPort, ttlSeconds }); expect(response.status).toBe(201); return (await response.json()).link as PreviewShare }
  const exchange = async (link: PreviewShare) => raw(gateway, 'owner.test', SHARE_EXCHANGE, { method: 'POST', headers: { origin: 'https://owner.test', 'content-type': 'application/json' }, body: JSON.stringify({ token: new URL(link.url!).hash.slice(1) }) })
  const open = async (supplied?: PreviewShare) => {
    const link = supplied ?? await create()
    const receipt = await exchange(link); expect(receipt.status).toBe(200)
    const handoff = JSON.parse(receipt.body), url = new URL(handoff.url)
    const result = await raw(gateway, host, url.pathname, { method: 'POST', headers: { origin: 'https://owner.test', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ticket: handoff.ticket }).toString() })
    expect(result.status).toBe(303)
    return { link, receipt, result, cookie: result.headers['set-cookie']!.find(c => c.startsWith(SHARE_COOKIE + '='))!.split(';')[0] }
  }
  return { root, api, create, open, exchange, services, transport, transportFetch, ownerCookie, config, issued, upstream, server, gateway, appPort, host,
    fetch: (path = '/', cookie = '', headers: Record<string, string> = {}) => raw(gateway, host, path, { headers: { cookie, ...headers } }) }
}
it('owner endpoints require encrypted owner proof and CSRF; public bootstrap reveals no private data', async () => {
  const f = await fixture()
  for (const path of ['/api/preview-shares', '/api/preview-shares/00000000-0000-4000-8000-000000000000']) {
    expect((await raw(f.gateway, 'owner.test', path)).status).toBe(403)
    expect((await raw(f.gateway, 'owner.test', path, { headers: { cookie: f.ownerCookie } })).status).toBe(403)
  }
  const wrong = new SecureTransport(f.transportFetch, 'https://owner.test', { Cookie: f.ownerCookie, Origin: 'https://owner.test' })
  await expect(wrong.unlock(randomId(32))).rejects.toThrow(); wrong.lock()
  const missingCsrf = (await f.transport.request('/api/preview-shares', { method: 'POST', body: JSON.stringify({ port: f.appPort, ttlSeconds: 60 }) })).response
  expect(missingCsrf.status).toBe(403)
  const listed = await (await f.api('/api/preview-shares')).json(); expect(listed.services).toMatchObject([{ port: f.appPort, running: true }])
  const page = await raw(f.gateway, 'owner.test', '/preview/share')
  expect(page.status).toBe(200); expect(page.headers['cache-control']).toBe('no-store'); expect(page.headers['referrer-policy']).toBe('strict-origin')
  expect(page.headers['content-security-policy']).toContain(`form-action https://${f.host}`)
  expect(page.body).toContain("history.replaceState(null,'',location.pathname)")
  expect(page.body).toContain("credentials:'omit'"); expect(page.body).not.toContain(f.ownerCookie)
  expect((await raw(f.gateway, 'owner.test', '/preview/share?token=bad')).status).toBe(400)
  expect((await raw(f.gateway, 'owner.test', SHARE_EXCHANGE, { method: 'POST', headers: { origin: 'https://evil.test', 'content-type': 'application/json' }, body: '{}' })).status).toBe(403)
  expect((await raw(f.gateway, 'owner.test', SHARE_EXCHANGE, { method: 'POST', headers: { origin: 'https://owner.test', 'content-type': 'application/json' }, body: 'x'.repeat(2050) })).status).toBe(413)
})
it('opens multiple recipients without owner cookies, strips credentials upstream and preserves upstream auth', async () => {
  const f = await fixture(), link = await f.create(), a = await f.open(link), b = await f.open(link)
  expect(a.result.headers.location).toBe('/app?q=1#part')
  expect(a.result.headers['set-cookie']![0]).toMatch(/; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=/)
  expect(a.result.headers['set-cookie']!.join('')).not.toMatch(/Domain=/)
  const res = await f.fetch('/asset?x=1', a.cookie + '; theme=light; codex_remote_session=DO_NOT_FORWARD', { authorization: 'Bearer UPSTREAM_ONLY', 'x-forwarded-host': 'evil.test' })
  expect(res.status).toBe(200)
  const observed = JSON.parse(res.body)
  expect(observed.headers.cookie).toBe('theme=light'); expect(observed.headers.authorization).toBe('Bearer UPSTREAM_ONLY')
  expect(observed.headers['x-forwarded-host']).toBe(f.host)
  expect(res.body).not.toContain(new URL(link.url!).hash.slice(1)); expect(res.body).not.toContain(a.cookie.split('=')[1])
  expect((await f.fetch('/', b.cookie)).status).toBe(200)
  expect((await f.fetch()).status).toBe(401)
  expect((await raw(f.gateway, 'owner.test', '/api/preview-shares', { headers: { cookie: a.cookie } })).status).toBe(403)
})
it('logout revokes owner API but intentionally retains shares; one share revoke does not revoke the other', async () => {
  const f = await fixture(), a = await f.open(), b = await f.open()
  expect((await f.api('/api/preview-shares/' + a.link.id, 'DELETE')).status).toBe(200)
  expect((await f.fetch('/', a.cookie)).status).toBe(401); expect((await f.fetch('/', b.cookie)).status).toBe(200)
  expect((await f.exchange(a.link)).status).toBe(401)
  expect((await f.api('/api/preview-shares/' + a.link.id, 'DELETE')).status).toBe(200)
  expect((await f.api('/api/session/logout', 'POST', {})).status).toBe(200)
  await expect(f.api('/api/preview-shares')).rejects.toThrow()
  expect((await f.fetch('/', b.cookie)).status).toBe(200); expect((await f.exchange(b.link)).status).toBe(200)
})
it('withdraws encrypted owner list during a held registry probe after logout', async () => {
  let finish!: (value: boolean) => void, entered!: () => void
  const waiting = new Promise<void>(resolve => { entered = resolve })
  const f = await fixture(undefined, () => { entered(); return new Promise(resolve => { finish = resolve }) })
  await f.create()
  const pending = f.api('/api/preview-shares').then(response => response.status, () => 'withdrawn')
  await waiting; expect((await f.api('/api/session/logout', 'POST', {})).status).toBe(200); finish(true)
  expect(await pending).toBe('withdrawn')
})
it('bounds anonymous slow request bodies globally and recovers admission after disconnect', async () => {
  const f = await fixture(); let entered = 0, allEntered!: () => void
  const waiting = new Promise<void>(resolve => { allEntered = resolve })
  f.server.on('request', req => { if (req.url === SHARE_EXCHANGE && ++entered === 32) allEntered() })
  const held = Array.from({ length: 32 }, () => {
    const req = request({ hostname: '127.0.0.1', port: f.gateway, path: SHARE_EXCHANGE, method: 'POST', headers: {
      host: 'owner.test', origin: 'https://owner.test', 'content-type': 'application/json', 'content-length': '2048',
    } })
    req.on('error', () => {}); req.flushHeaders(); return req
  })
  try {
    await waiting
    const blocked = await raw(f.gateway, 'owner.test', SHARE_EXCHANGE, { method: 'POST', headers: { origin: 'https://owner.test', 'content-type': 'application/json' }, body: '{}' })
    expect(blocked.status).toBe(503); expect(blocked.headers['retry-after']).toBe('60')
  } finally { for (const req of held) req.destroy() }
  // Wait for the peer-side abort events, not the ten-second body deadline.
  await new Promise(resolve => setTimeout(resolve, 50))
  const recovered = await raw(f.gateway, 'owner.test', SHARE_EXCHANGE, { method: 'POST', headers: { origin: 'https://owner.test', 'content-type': 'application/json' }, body: '{}' })
  expect(recovered.status).toBe(401)
})
it('authenticates before cached 304 and denies cached content after service retirement', async () => {
  let requests = 0
  const f = await fixture((_req, res) => { requests++; res.setHeader('content-type', 'text/javascript'); res.end('/* fixture */') }), opened = await f.open()
  const first = await f.fetch('/asset.js', opened.cookie); expect(first.headers['cache-control']).toBe('private, no-cache, must-revalidate')
  const second = await f.fetch('/asset.js', opened.cookie, { 'if-none-match': first.headers.etag! }); expect(second.status).toBe(304)
  f.services.remove('port:' + f.appPort)
  const denied = await f.fetch('/asset.js', opened.cookie, { 'if-none-match': first.headers.etag! }); expect(denied.status).toBe(401)
  expect(requests).toBe(2)
})
it.each(['revoke', 'retire', 'expire'])('closes active HTTP streams on %s without waiting for upstream', async action => {
  const f = await fixture((_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: ready\n\n') })
  const opened = await f.open(await f.create(action === 'expire' ? 1 : 3600))
  await new Promise<void>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: f.gateway, headers: { host: f.host, cookie: opened.cookie }, path: '/events' }, res => {
      res.once('data', () => {
        if (action === 'revoke') void f.api('/api/preview-shares/' + opened.link.id, 'DELETE').catch(reject)
        if (action === 'retire') f.services.remove('port:' + f.appPort)
      }); res.on('error', () => {}); res.once('close', resolve)
    }); req.on('error', reject); req.setTimeout(3000, () => req.destroy(Error('Stream did not close'))); req.end()
  })
})
it('rechecks after delayed headers and revokes an active WebSocket including both directions', async () => {
  let finish!: () => void, entered!: () => void
  const waiting = new Promise<void>(resolve => { entered = resolve })
  const f = await fixture((_req, res) => { finish = () => { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end('FORBIDDEN_AFTER_REVOKE') }; entered() })
  const opened = await f.open()
  const pending = f.fetch('/slow.js', opened.cookie).then(() => 'delivered', () => 'closed')
  await waiting; await f.api('/api/preview-shares/' + opened.link.id, 'DELETE'); finish()
  expect(await pending).toBe('closed')
  f.upstream.on('upgrade', (_req, socket) => { socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nhello'); socket.on('data', data => socket.write(data)) })
  const ws = await f.open()
  await new Promise<void>((resolve, reject) => {
    const socket = connect(f.gateway, '127.0.0.1'); let revoked = false, data = ''
    socket.on('connect', () => socket.write(`GET /ws HTTP/1.1\r\nHost: ${f.host}\r\nOrigin: https://${f.host}\r\nCookie: ${ws.cookie}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`))
    socket.on('error', reject); socket.setTimeout(3000, () => socket.destroy(Error('WS did not close')))
    socket.on('data', chunk => { data += chunk; if (!revoked && data.includes('hello')) { revoked = true; socket.write('echo'); void f.api('/api/preview-shares/' + ws.link.id, 'DELETE').catch(reject) } })
    socket.on('close', () => { expect(data).toContain('101 Switching Protocols'); expect(revoked).toBe(true); resolve() })
  })
})
it.each(['retire', 'expire'])('closes both ends of an established WebSocket on %s', async action => {
  const f = await fixture()
  let upstreamClosed!: () => void
  const closed = new Promise<void>(resolve => { upstreamClosed = resolve })
  f.upstream.on('upgrade', (_req, socket) => {
    socket.on('error', () => {}); socket.on('end', () => socket.destroy()); socket.once('close', upstreamClosed)
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nready')
  })
  const opened = await f.open(await f.create(action === 'expire' ? 1 : 3600))
  await new Promise<void>((resolve, reject) => {
    const socket = connect(f.gateway, '127.0.0.1'); let data = '', seen = false
    socket.on('connect', () => socket.write(`GET /ws HTTP/1.1\r\nHost: ${f.host}\r\nOrigin: https://${f.host}\r\nCookie: ${opened.cookie}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`))
    socket.on('error', reject); socket.setTimeout(3000, () => socket.destroy(Error('WS did not close')))
    socket.on('data', chunk => { data += chunk; if (!seen && data.includes('ready')) { seen = true; if (action === 'retire') f.services.remove('port:' + f.appPort) } })
    socket.once('close', () => { expect(seen).toBe(true); resolve() })
  })
  await closed
  expect((await f.fetch('/', opened.cookie)).status).toBe(401)
})
it('does not release a late WebSocket upgrade after revocation', async () => {
  const f = await fixture(), opened = await f.open()
  let entered!: () => void, finish!: () => void
  const waiting = new Promise<void>(resolve => { entered = resolve })
  f.upstream.on('upgrade', (_req, socket) => {
    socket.on('error', () => {}); socket.on('end', () => socket.destroy())
    finish = () => socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nforbidden'); entered()
  })
  const socket = connect(f.gateway, '127.0.0.1'); let data = ''
  const closed = new Promise<void>((resolve, reject) => { socket.on('error', reject); socket.once('close', resolve) })
  socket.on('data', chunk => { data += chunk }); socket.setTimeout(3000, () => socket.destroy(Error('WS did not close')))
  socket.on('connect', () => socket.write(`GET /ws HTTP/1.1\r\nHost: ${f.host}\r\nOrigin: https://${f.host}\r\nCookie: ${opened.cookie}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`))
  await waiting; expect((await f.api('/api/preview-shares/' + opened.link.id, 'DELETE')).status).toBe(200); finish(); await closed
  expect(data).not.toContain('101'); expect(data).not.toContain('forbidden')
})
it('share selection replaces host cookie predictably and owner private launch clears it', async () => {
  const f = await fixture(), opened = await f.open(), another = await f.open()
  expect(opened.cookie.split('=')[0]).toBe(another.cookie.split('=')[0])
  expect(another.result.headers['set-cookie']!.some(c => c.startsWith('__Host-codex_preview_session=;') && c.includes('Max-Age=0'))).toBe(true)
  const launch = await (await f.api('/api/localhost-preview', 'POST', { port: f.appPort, path: '/' })).json()
  const url = new URL(launch.url), response = await raw(f.gateway, f.host, url.pathname + url.search)
  expect(response.status).toBe(303)
  expect(response.headers['set-cookie']!.some(c => c.startsWith(SHARE_COOKIE + '=;') && c.includes('Max-Age=0'))).toBe(true)
})
