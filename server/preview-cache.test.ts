import { createServer, request, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it, vi } from 'vitest'
import { LocalhostPreview } from './localhost-preview.js'
import { createSession } from './auth.js'
import { previewCacheable, validatePreviewBody } from './preview-cache.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close() })
async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }))
  return (server.address() as AddressInfo).port
}
async function fixture(isolated = false) {
  let version = 1
  const received: IncomingMessage['headers'][] = []
  const app = createServer((req, res) => {
    received.push(req.headers)
    if (req.url === '/large.js') {
      res.setHeader('content-type', 'application/javascript')
      res.end('a'.repeat(16 * 1024 * 1024 + 100))
      return
    }
    res.setHeader('content-type', req.url === '/' ? 'text/html' : 'application/javascript')
    res.setHeader('etag', '"upstream-fixed"') // Intentionally unchanged across bytes/owner changes.
    res.setHeader('last-modified', 'Mon, 21 Sep 2026 00:00:00 GMT')
    res.setHeader('cache-control', 'public, max-age=31536000, immutable')
    res.setHeader('vary', 'Accept-Language')
    if (req.url === '/nostore.js') res.setHeader('cache-control', 'no-store')
    if (req.url === '/cookie.js') res.setHeader('set-cookie', 'codex_remote_session=discarded')
    if (req.url === '/error.js') res.statusCode = 500
    if (req.url === '/redirect.js') { res.statusCode = 302; res.setHeader('location', '/') }
    if (req.url === '/events.js') res.setHeader('content-type', 'text/event-stream')
    if (req.url === '/vary.js') res.setHeader('vary', '*')
    if (req.url === '/raw.js') res.setHeader('cache-control', 'private, no-transform')
    if (req.url === '/private.js') res.setHeader('cache-control', 'private, no-cache')
    res.end(req.url === '/' ? '<html><head></head><body>app</body></html>' : 'import "/dep.js"; export const version = ' + version)
  })
  const port = await listen(app)
  let proxy: LocalhostPreview
  const gateway = createServer((req, res) => proxy.handle(req, res))
  const gatewayPort = await listen(gateway)
  const host = isolated ? 'p' + port + '.test' : 'localhost'
  proxy = new LocalhostPreview({ ...(isolated ? { originTemplate: 'http://p{port}.test' } : { publicOrigin: 'http://localhost' }), sessionSecret: 'fixture-only', blockedPorts: [gatewayPort] })
  cleanup.push(() => proxy.close())
  const base = isolated ? '' : '/preview/' + port
  async function get(path: string, headers: Record<string, string> = {}, method = 'GET') {
    return new Promise<{ status: number; headers: IncomingMessage['headers']; body: string }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: gatewayPort, path: base + path, method, headers: { host, ...headers } }, res => {
        let body = ''; res.on('data', chunk => { body += chunk }); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body })); res.on('error', reject)
      }); req.on('error', reject); req.end()
    })
  }
  let cookie = 'codex_remote_session=' + createSession('fixture-only', 600).token
  if (isolated) {
    const launch = new URL(proxy.createLaunch(port, '/', Math.floor(Date.now() / 1000) + 600).url)
    cookie = (await get(launch.pathname + launch.search)).headers['set-cookie']![0].split(';')[0]
  }
  return { get, cookie, port, received, change: () => version++ }
}

it.each([false, true])('revalidates current delivered bytes, ports and HEAD correctly (isolated=%s)', async isolated => {
  const f = await fixture(isolated), headers = { cookie: f.cookie }
  const first = await f.get('/module.js', headers)
  expect(first.status).toBe(200)
  expect(first.headers['cache-control']).toBe('private, no-cache, must-revalidate')
  expect(first.headers.vary).toBe('Accept-Language, Cookie')
  expect(first.headers.etag).toMatch(/^"preview-/)
  expect(first.headers.etag).not.toBe('"upstream-fixed"')
  expect(first.headers['last-modified']).toBeUndefined()
  const conditional = { ...headers, 'if-none-match': 'W/' + first.headers.etag, 'if-modified-since': 'Mon, 21 Sep 2026 00:00:00 GMT' }
  const second = await f.get('/module.js', conditional)
  expect(second.status).toBe(304); expect(second.body).toBe('')
  expect(second.headers['content-length']).toBeUndefined()
  expect(f.received.at(-1)?.['if-none-match']).toBeUndefined()
  expect(f.received.at(-1)?.['if-modified-since']).toBeUndefined()
  expect((await f.get('/module.js', headers, 'HEAD'))).toMatchObject({ status: 200, body: '', headers: { etag: first.headers.etag, 'content-length': String(Buffer.byteLength(first.body)) } })
  expect((await f.get('/module.js', conditional, 'HEAD')).status).toBe(304)
  f.change()
  expect(await f.get('/module.js', conditional)).toMatchObject({ status: 200, body: expect.stringContaining('version = 2') })
  expect((await f.get('/module.js', { 'if-none-match': first.headers.etag! })).status).toBe(401)
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 601000)
  expect((await f.get('/module.js', conditional)).status).toBe(401)
})

it.each(['/nostore.js', '/cookie.js', '/error.js', '/redirect.js', '/events.js', '/vary.js', '/api/private.js', '/auth/secret.js'])('never caches sensitive/excluded response %s', async path => {
  const f = await fixture()
  const result = await f.get(path, { cookie: f.cookie, 'if-none-match': '*' })
  expect(result.headers['cache-control']).toBe('no-store')
  expect(result.status).not.toBe(304)
})

it('keeps private assets revalidatable and transformed validators separate by port', async () => {
  const a = await fixture(), b = await fixture()
  const first = await a.get('/private.js', { cookie: a.cookie })
  const other = await b.get('/private.js', { cookie: b.cookie, 'if-none-match': first.headers.etag! })
  expect(other.status).toBe(200)
  expect(other.headers.etag).not.toBe(first.headers.etag)
  expect(other.body).toContain('/preview/' + b.port + '/dep.js')
})

it('does not opt dynamic HTML into storage without upstream signals or request no-store', () => {
  const req = { method: 'GET', headers: {} } as IncomingMessage
  expect(previewCacheable(req, '/', 200, { 'content-type': 'text/html' })).toBe(false)
  expect(previewCacheable({ ...req, headers: { authorization: 'fake' } } as IncomingMessage, '/app.js', 200, { 'content-type': 'application/javascript' })).toBe(false)
  expect(previewCacheable({ ...req, headers: { 'cache-control': 'no-store' } } as IncomingMessage, '/app.js', 200, { 'content-type': 'application/javascript' })).toBe(false)
  const headers: Record<string, string> = { 'cdn-cache-control': 'public', 'surrogate-control': 'max-age=100', vary: 'Accept-Encoding' }
  validatePreviewBody(req, headers, Buffer.from('hello'))
  expect(headers['cdn-cache-control']).toBeUndefined()
  expect(headers['surrogate-control']).toBeUndefined()
})

it('honors no-transform, retains its directive and returns the original representation', async () => {
  const f = await fixture()
  const result = await f.get('/raw.js', { cookie: f.cookie })
  expect(result.body).toBe('import "/dep.js"; export const version = 1')
  expect(result.headers['cache-control']).toContain('no-transform')
  expect((await f.get('/raw.js', { cookie: f.cookie, 'if-none-match': result.headers.etag! })).status).toBe(304)
})

it('streams bodies above the bounded cache buffer without truncation or caching', async () => {
  const f = await fixture(true)
  const result = await f.get('/large.js', { cookie: f.cookie })
  expect(result.status).toBe(200)
  expect(result.headers['cache-control']).toBe('no-store')
  expect(result.body.length).toBe(16 * 1024 * 1024 + 100)
})
