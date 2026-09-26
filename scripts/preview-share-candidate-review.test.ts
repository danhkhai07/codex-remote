// Independent review controls; HTTP fixture setup reused from the exact author candidate.
import { createServer, request, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { connect, type AddressInfo, type Socket } from 'node:net'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createRemoteHttpServer } from '../server/http-app.js'
import { RemoteController } from '../server/controller.js'
import { CodexAppServer } from '../server/codex-app-server.js'
import { ServicesStore } from '../server/services.js'
import { SecureTransport } from '../server/secure-client.js'
import { randomId } from '../server/secure-wire.js'
import { createSession } from '../server/auth.js'
import { SHARE_COOKIE, PreviewShares, type PreviewShare } from '../server/preview-shares.js'
import { SHARE_EXCHANGE } from '../server/preview-share-page.js'
import type { RemoteConfig } from '../server/config.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); boundary.afterHash = undefined; vi.restoreAllMocks() })
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

const boundary = vi.hoisted(() => ({ afterHash: undefined as (() => void) | undefined }))
vi.mock('../server/preview-cache.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../server/preview-cache.js')>()
  return { ...actual, validatePreviewBody: (...args: Parameters<typeof actual.validatePreviewBody>) => {
    const result = actual.validatePreviewBody(...args); boundary.afterHash?.(); return result
  } }
})

it.each(['expire', 'retire'] as const)('independent: no share 304/body if %s occurs immediately after real hashing', async action => {
  const f = await fixture((_req, res) => { res.setHeader('content-type', 'text/javascript'); res.end('/* owned review asset */') })
  const opened = await f.open(), first = await f.fetch('/asset.js', opened.cookie)
  expect(first.status).toBe(200); expect(first.headers.etag).toBeTruthy()
  boundary.afterHash = () => {
    if (action === 'retire') f.services.remove('port:' + f.appPort)
    else vi.spyOn(Date, 'now').mockReturnValue(Date.parse(opened.link.expiresAt))
  }
  const result = await f.fetch('/asset.js', opened.cookie, { 'if-none-match': first.headers.etag! }).then(r => r.status, () => 'closed')
  expect(result).toBe('closed')
})

it('independent: invalid public credential cannot fall back to a valid private preview', async () => {
  const f = await fixture(), opened = await f.open()
  const launch = await (await f.api('/api/localhost-preview', 'POST', { port: f.appPort })).json()
  const url = new URL(launch.url), reply = await raw(f.gateway, f.host, url.pathname + url.search)
  const privateCookie = reply.headers['set-cookie']!.find(c => c.startsWith('__Host-codex_preview_session='))!.split(';')[0]
  expect((await f.fetch('/', privateCookie)).status).toBe(200)
  for (const bad of [SHARE_COOKIE + '=bogus', opened.cookie + '; ' + opened.cookie]) {
    expect((await f.fetch('/', privateCookie + '; ' + bad)).status).toBe(401)
  }
  await f.api('/api/preview-shares/' + opened.link.id, 'DELETE')
  expect((await f.fetch('/', privateCookie + '; ' + opened.cookie)).status).toBe(401)
  expect((await f.fetch('/', privateCookie)).status).toBe(200)
})

it('independent: cross-site Origin/forwarded fields do not authorize exchange, redemption or WS', async () => {
  let upstreamHits = 0
  const f = await fixture((_req, res) => { upstreamHits++; res.end('owned') }), link = await f.create()
  const payload = JSON.parse((await f.exchange(link)).body)
  for (const origin of ['https://evil.test', 'null', 'https://' + f.host]) {
    const denied = await raw(f.gateway, f.host, '/__codex_preview__/share-redeem', { method: 'POST', headers: { origin,
      'x-forwarded-host': 'owner.test', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ticket: payload.ticket }).toString() })
    expect(denied.status).toBe(403)
  }
  const accepted = await raw(f.gateway, f.host, '/__codex_preview__/share-redeem', { method: 'POST', headers: {
    origin: 'https://owner.test', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ticket: payload.ticket }).toString() })
  expect(accepted.status).toBe(303); expect(upstreamHits).toBe(0)
  const cookie = accepted.headers['set-cookie']![0].split(';')[0]
  const socket = connect(f.gateway, '127.0.0.1'); let data = ''
  await new Promise<void>((resolve, reject) => {
    socket.on('connect', () => socket.write(`GET /ws HTTP/1.1\r\nHost: ${f.host}\r\nOrigin: https://evil.test\r\nCookie: ${cookie}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`))
    socket.on('data', chunk => { data += chunk }); socket.once('close', resolve); socket.on('error', reject)
    socket.setTimeout(2000, () => socket.destroy(Error('Review WS timeout')))
  })
  expect(data).toContain('403'); expect(upstreamHits).toBe(0)
})

it('independent: a held anonymous redeem body cannot survive registry retirement', async () => {
  const f = await fixture(), link = await f.create(), handoff = JSON.parse((await f.exchange(link)).body)
  const body = new URLSearchParams({ ticket: handoff.ticket }).toString()
  let reached!: () => void
  const ready = new Promise<void>(resolve => { reached = resolve })
  f.server.on('request', req => { if (req.url === '/__codex_preview__/share-redeem') reached() })
  let finish!: () => void
  const result = new Promise<number>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: f.gateway, path: '/__codex_preview__/share-redeem', method: 'POST', headers: {
      host: f.host, origin: 'https://owner.test', 'content-type': 'application/x-www-form-urlencoded', 'content-length': String(body.length) } }, res => { res.resume(); resolve(res.statusCode!) })
    req.on('error', reject); req.write(body.slice(0, 4)); finish = () => req.end(body.slice(4))
  })
  await ready; f.services.remove('port:' + f.appPort); finish()
  expect(await result).toBe(401)
})

it('independent: max-TTL link is unavailable at exact expiry after durable restart', async () => {
  const f = await fixture(), link = await f.create(86400)
  expect(Date.parse(link.expiresAt) - Date.parse(link.createdAt)).toBe(86400_000)
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(link.expiresAt))
  const shares = new PreviewShares({ services: f.services, secret: f.config.sessionSecret, publicOrigin: 'https://owner.test',
    originTemplate: f.config.previewOriginTemplate, ports: [f.appPort], blockedPorts: [], file: join(f.root, 'preview-shares.json') })
  cleanup.push(() => shares.close())
  expect((await shares.list()).links[0].status).toBe('expired')
  expect(() => shares.exchange(new URL(link.url!).hash.slice(1))).toThrow()
})
