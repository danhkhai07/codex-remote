import { createServer, request, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it, vi } from 'vitest'
import { createRemoteHttpServer } from './http-app.js'
import { RemoteController } from './controller.js'
import { CodexAppServer } from './codex-app-server.js'
import type { RemoteConfig } from './config.js'

// Advance the clock immediately after the real validator hashes its bytes, before
// the event loop can run the expiry timer. Auth/registry/HTTP are never mocked.
const boundary = vi.hoisted(() => ({ afterHash: undefined as (() => void) | undefined }))
vi.mock('./preview-cache.js', async importOriginal => {
  const original = await importOriginal<typeof import('./preview-cache.js')>()
  return { ...original, validatePreviewBody: (...args: Parameters<typeof original.validatePreviewBody>) => {
    const result = original.validatePreviewBody(...args); boundary.afterHash?.(); return result
  } }
})
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { boundary.afterHash = undefined; vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close() })
async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  return (server.address() as AddressInfo).port
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cache-session-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  let hold: ((response: ServerResponse) => void) | undefined
  const appPort = await listen(createServer((req, res) => {
    res.setHeader('content-type', req.url === '/events' ? 'text/event-stream' : 'application/javascript')
    res.setHeader('cache-control', 'private, no-cache')
    if (hold) { res.write('export '); hold(res) }
    else res.end('export const v = 1;')
  }))
  const config: RemoteConfig = { host: '127.0.0.1', port: 0, publicOrigin: new URL('http://localhost'), password: 'fixture only', sessionSecret: 'fixture-secret'.repeat(4), sessionTtlSeconds: 600, codexBin: 'unused', workspaceRoots: [root], fileRoots: [root], production: true, previewOriginTemplate: 'http://p{port}.test', sessionStateFile: join(root, 'state.json') }
  const gateway = createRemoteHttpServer(config, new RemoteController(config, new CodexAppServer('unused')), root, null)
  const port = await listen(gateway); config.port = port; config.publicOrigin = new URL('http://127.0.0.1:' + port)
  const control = (path: string, headers = {}, body?: object) => fetch(config.publicOrigin + path.slice(1), { method: body ? 'POST' : 'GET', headers: { Origin: config.publicOrigin.origin, 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const login = await control('/api/session/login', {}, { password: config.password })
  expect(login.status).toBe(200)
  const auth = { Cookie: login.headers.get('set-cookie')!.split(';')[0], 'X-CSRF-Token': (await login.json()).csrf }
  const launch = new URL((await (await control('/api/localhost-preview', auth, { port: appPort })).json()).url)
  const get = (path: string, headers = {}, onResponse?: (res: IncomingMessage) => void) => new Promise<{ status?: number; headers: IncomingMessage['headers']; body: string; aborted: boolean }>(resolve => {
    let status: number | undefined, responseHeaders: IncomingMessage['headers'] = {}, body = ''
    const req = request({ hostname: '127.0.0.1', port, path, headers: { Host: 'p' + appPort + '.test', ...headers } }, res => {
      status = res.statusCode; responseHeaders = res.headers; onResponse?.(res)
      res.on('data', chunk => { body += chunk }); res.on('end', () => resolve({ status, headers: responseHeaders, body, aborted: false }))
      res.on('error', () => resolve({ status, headers: responseHeaders, body, aborted: true }))
    }); req.on('error', () => resolve({ status, headers: responseHeaders, body, aborted: true })); req.end()
  })
  const ticket = await get(launch.pathname + launch.search)
  expect(ticket.status).toBe(303); expect(ticket.headers['cache-control']).toBe('no-store')
  const cookie = ticket.headers['set-cookie']![0].split(';')[0]
  expect((await get(launch.pathname + launch.search)).status).toBe(401)
  return { get, cookie, hold: (callback: typeof hold) => { hold = callback }, logout: () => control('/api/session/logout', auth, {}), session: () => control('/api/session', auth), advancePastExpiry: () => { vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 601000) } }
}
it('uses real login/ticket/registry for 304 and denies revoked token/grant replay', async () => {
  const f = await fixture(), first = await f.get('/app.js', { Cookie: f.cookie })
  expect(first.status).toBe(200)
  const headers = { Cookie: f.cookie, 'If-None-Match': first.headers.etag! }
  expect((await f.get('/app.js', headers)).status).toBe(304)
  expect((await f.logout()).status).toBe(200)
  expect((await f.session()).status).toBe(401)
  expect((await f.get('/app.js', headers)).status).toBe(401)
})
it.each(['logout', 'expiry'] as const)('does not deliver buffered content or 304 after %s during upstream read', async action => {
  const f = await fixture(), first = await f.get('/app.js', { Cookie: f.cookie })
  let release!: ServerResponse
  const reached = new Promise<void>(resolve => f.hold(res => { release = res; resolve() }))
  const pending = f.get('/app.js', { Cookie: f.cookie, 'If-None-Match': first.headers.etag! })
  await reached
  if (action === 'logout') expect((await f.logout()).status).toBe(200)
  else f.advancePastExpiry()
  release.end('const v = 1;')
  expect(await pending).toMatchObject({ status: undefined, body: '', aborted: true })
})
it('rechecks real registry expiry after hashing before writing 304', async () => {
  const f = await fixture(), first = await f.get('/app.js', { Cookie: f.cookie })
  boundary.afterHash = f.advancePastExpiry
  expect(await f.get('/app.js', { Cookie: f.cookie, 'If-None-Match': first.headers.etag! })).toMatchObject({ status: undefined, body: '', aborted: true })
})
it('closes an already streaming upstream HTTP response on logout', async () => {
  const f = await fixture()
  f.hold(() => {})
  let opened!: () => void
  const ready = new Promise<void>(resolve => { opened = resolve })
  const pending = f.get('/events', { Cookie: f.cookie }, res => { expect(res.headers['cache-control']).toBe('no-store'); opened() })
  await ready
  expect((await f.logout()).status).toBe(200)
  expect(await pending).toMatchObject({ status: 200, aborted: true })
})
