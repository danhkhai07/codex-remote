import { createSession } from './auth.js'
import { createServer, request, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { connect, type AddressInfo, type Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalhostPreview, validatePreviewOriginTemplate } from './localhost-preview.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function listen(server: Server): Promise<number> {
  const sockets = new Set<Socket>()
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>(resolve => { for (const socket of sockets) socket.destroy(); server.close(() => resolve()) }))
  return (server.address() as AddressInfo).port
}

type Result = { status: number; headers: IncomingMessage['headers']; body: Buffer }
function fetchLocal(port: number, host: string, path = '/', options: { method?: string; headers?: Record<string, string>; body?: Buffer } = {}): Promise<Result> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: { host, ...options.headers } }, res => {
      const parts: Buffer[] = []
      res.on('data', part => parts.push(Buffer.from(part)))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parts) }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end(options.body)
  })
}

async function fixture(handler: (req: IncomingMessage, res: ServerResponse) => void = (req, res) => {
  const parts: Buffer[] = []
  req.on('data', part => parts.push(Buffer.from(part)))
  req.on('end', () => res.end(JSON.stringify({ url: req.url, method: req.method, headers: req.headers, body: Buffer.concat(parts).toString('base64') })))
}, originTemplate = 'https://p{port}.preview.test') {
  const upstream = createServer(handler), appPort = await listen(upstream)
  let preview: LocalhostPreview
  const gateway = createServer((req, res) => preview.handle(req, res))
  gateway.on('upgrade', (req, socket, head) => preview.handleUpgrade(req, socket, head))
  const gatewayPort = await listen(gateway)
  preview = new LocalhostPreview({ originTemplate, sessionSecret: 'test-only-secret', blockedPorts: [5173, gatewayPort] })
  cleanup.push(async () => preview.close())
  const host = new URL(originTemplate.replace('{port}', String(appPort))).host
  const fetch = (path = '/', options: Parameters<typeof fetchLocal>[3] = {}) => fetchLocal(gatewayPort, host, path, options)
  const open = async (path = '/', expiresAt = Math.floor(Date.now() / 1000) + 600) => {
    const launch = preview.createLaunch(appPort, path, expiresAt), url = new URL(launch.url)
    const result = await fetch(`${url.pathname}${url.search}`)
    return { launch, result, cookie: result.headers['set-cookie']?.[0].split(';')[0] ?? '' }
  }
  return { preview, upstream, gatewayPort, appPort, host, fetch, open }
}

describe('localhost previews', () => {
  it('validates isolated origin templates and refuses unsafe ports and initial paths', () => {
    expect(validatePreviewOriginTemplate('https://p{port}.preview.test/')).toBe('https://p{port}.preview.test')
    for (const template of ['https://preview.test', 'https://preview.test/{port}', 'https://p{port}.preview.test/{port}', 'ftp://p{port}.preview.test', 'https://user:password@p{port}.preview.test', 'https://p{port}.preview.test/?x=1']) {
      expect(() => validatePreviewOriginTemplate(template)).toThrow()
    }
    const proxy = new LocalhostPreview({ originTemplate: 'http://p{port}.preview.test', sessionSecret: 'test', blockedPorts: [5173] })
    const expiry = Math.floor(Date.now() / 1000) + 100
    for (const port of [22, 443, 1023, 65536, 5173, NaN, 3000.2, '3000', null, {}]) expect(() => proxy.createLaunch(port, '/', expiry)).toThrow()
    for (const path of ['//external.test/', '/\\external.test/', 'http://external.test/', '/bad\r\nheader', '/__codex_preview__/launch', '/a/../__codex_preview__/launch', 123]) {
      expect(() => proxy.createLaunch(3000, path, expiry)).toThrow()
    }
    expect(proxy.createLaunch(3000, '/a b?q=1#heading', expiry)).toMatchObject({ viewUrl: 'http://p3000.preview.test/a%20b?q=1#heading' })
    expect(() => proxy.createLaunch(3000, '/', 1)).toThrow()
    proxy.close()
  })

  it('requires authentication, consumes a ticket once and creates a host-only port-bound cookie', async () => {
    const f = await fixture()
    expect((await f.fetch()).status).toBe(401)
    const { launch, result, cookie } = await f.open('/project?q=one#section')
    expect(result.status).toBe(303)
    expect(result.headers.location).toBe('/project?q=one#section')
    expect(result.headers['set-cookie']?.[0]).toMatch(/__Host-codex_preview_session=.*; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+; Secure/)
    const maxAge = Number(result.headers['set-cookie']?.[0].match(/Max-Age=(\d+)/)?.[1])
    expect(maxAge).toBeGreaterThanOrEqual(599)
    expect(maxAge).toBeLessThanOrEqual(600)
    expect(result.headers['set-cookie']?.[0]).not.toMatch(/Domain=/i)
    const url = new URL(launch.url)
    expect((await f.fetch(`${url.pathname}${url.search}`)).status).toBe(401)
    expect((await f.fetch('/', { headers: { cookie } })).status).toBe(200)
    expect((await f.fetch('/', { headers: { cookie: `${cookie}tampered` } })).status).toBe(401)
    const otherPort = f.appPort === 3000 ? 3001 : 3000
    expect((await fetchLocal(f.gatewayPort, `p${otherPort}.preview.test`, '/', { headers: { cookie } })).status).toBe(401)
    expect((await fetchLocal(f.gatewayPort, 'evil.test', '/')).status).toBe(400)
    expect((await fetchLocal(f.gatewayPort, 'p5173.preview.test', '/')).status).toBe(400)
  })

  it('supports an HTTP preview origin with a fixed gateway port for local development', async () => {
    const f = await fixture(undefined, 'http://p{port}.preview.test:4444'), { result, cookie } = await f.open()
    expect(result.headers['set-cookie']?.[0]).toMatch(/^codex_preview_session=/)
    expect(result.headers['set-cookie']?.[0]).not.toContain('; Secure')
    expect((await f.fetch('/', { headers: { cookie, origin: `http://${f.host}` } })).status).toBe(200)
  })

  it('rejects expired and cross-port tickets and bounds cookie lifetime to the session or four hours', async () => {
    const f = await fixture(), now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const ticket = f.preview.createLaunch(f.appPort, '/', Math.floor(now / 1000) + 50_000)
    const path = new URL(ticket.url).pathname + new URL(ticket.url).search
    const otherPort = f.appPort === 3000 ? 3001 : 3000
    expect((await fetchLocal(f.gatewayPort, `p${otherPort}.preview.test`, path)).status).toBe(403)
    const opened = await f.fetch(path)
    expect(opened.headers['set-cookie']?.[0]).toContain('Max-Age=14400')
    const cookie = opened.headers['set-cookie']?.[0].split(';')[0] ?? ''
    vi.mocked(Date.now).mockReturnValue(now + 14_401_000)
    expect((await f.fetch('/', { headers: { cookie } })).status).toBe(401)
    vi.mocked(Date.now).mockReturnValue(now)
    const expired = f.preview.createLaunch(f.appPort, '/', Math.floor(now / 1000) + 1000)
    vi.mocked(Date.now).mockReturnValue(now + 61_000)
    expect((await f.fetch(new URL(expired.url).pathname + new URL(expired.url).search)).status).toBe(401)
  })

  it('forwards original asset paths, binary bodies and application cookies while excluding gateway credentials and spoofed headers', async () => {
    const f = await fixture(), { cookie } = await f.open()
    const body = Buffer.from([0, 255, 1, 128, 64])
    const response = await f.fetch('/assets/main.js?version=2', { method: 'POST', body, headers: {
      cookie: `${cookie}; codex_remote_session=main-secret; codex_preview_session=other-secret; theme=dark`,
      origin: `https://${f.host}`, 'content-type': 'application/octet-stream', 'x-csrf-token': 'application-csrf-token',
      'x-forwarded-host': 'evil.test', 'x-forwarded-for': '8.8.8.8', forwarded: 'host=evil.test',
      connection: 'keep-alive, x-private-hop', 'x-private-hop': 'do not forward',
    } })
    expect(response.status).toBe(200)
    const result = JSON.parse(response.body.toString())
    expect(result).toMatchObject({ url: '/assets/main.js?version=2', method: 'POST', body: body.toString('base64'), headers: {
      host: `127.0.0.1:${f.appPort}`, cookie: 'theme=dark', origin: `http://127.0.0.1:${f.appPort}`,
      'x-forwarded-host': f.host, 'x-forwarded-proto': 'https', 'x-csrf-token': 'application-csrf-token',
    } })
    for (const name of ['x-forwarded-for', 'forwarded', 'x-private-hop']) expect(result.headers[name]).toBeUndefined()
    expect((await f.fetch('/', { method: 'POST', headers: { cookie, origin: 'https://other.test' } })).status).toBe(403)
    expect((await f.fetch('/', { headers: { cookie, origin: 'null' } })).status).toBe(403)
  })

  it('preserves binary response content, removes hop headers and sanitizes upstream cookies', async () => {
    const body = Buffer.from([0, 255, 128, 17])
    const f = await fixture((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream', connection: 'x-private-hop', 'x-private-hop': 'hidden', 'set-cookie': [
        'theme=dark; Path=/; Domain=.preview.test; SameSite=Lax',
        '__Host-codex_preview_session=attacker; Path=/; Secure',
        'codex_remote_session=attacker; Domain=.test',
      ] })
      res.end(body)
    })
    const { cookie } = await f.open(), result = await f.fetch('/assets/logo.bin', { headers: { cookie } })
    expect(result.body).toEqual(body)
    expect(result.headers['x-private-hop']).toBeUndefined()
    expect(result.headers['set-cookie']).toEqual(['theme=dark; Path=/; SameSite=Lax'])
  })

  it('rewrites localhost redirects to the selected public origin', async () => {
    const f = await fixture((req, res) => {
      res.writeHead(302, { location: `http://localhost:${req.socket.localPort}/login?next=%2Fapp#heading` })
      res.end()
    })
    const { cookie } = await f.open(), result = await f.fetch('/dashboard', { headers: { cookie } })
    expect(result.status).toBe(302)
    expect(result.headers.location).toBe(`https://${f.host}/login?next=%2Fapp#heading`)
  })

  it('returns helpful failures for an app that is no longer listening', async () => {
    const f = await fixture(), { cookie } = await f.open()
    await new Promise<void>(resolve => f.upstream.close(() => resolve()))
    const result = await f.fetch('/', { headers: { cookie } })
    expect(result.status).toBe(502)
    expect(result.body.toString()).toContain('Check that its server is running')
  })

  it('times out an upstream that never sends headers without leaving the browser waiting', async () => {
    const f = await fixture(() => {}), { cookie } = await f.open()
    const nativeSetTimeout = globalThis.setTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: (...args: unknown[]) => void, delay: number, ...args: unknown[]) =>
      nativeSetTimeout(callback, delay === 30_000 ? 25 : delay, ...args)) as typeof setTimeout)
    const result = await f.fetch('/', { headers: { cookie } })
    expect(result.status).toBe(504)
    expect(result.body.toString()).toContain('too long to respond')
  })

  it('streams server-sent events before the upstream response finishes', async () => {
    let finish: (() => void) | undefined
    const f = await fixture((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: ready\n\n')
      finish = () => res.end('data: done\n\n')
    })
    const { cookie } = await f.open()
    await new Promise<void>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: f.gatewayPort, path: '/events', headers: { host: f.host, cookie } }, res => {
        res.once('data', chunk => { expect(chunk.toString()).toBe('data: ready\n\n'); finish?.() })
        res.on('end', resolve)
        res.on('error', reject)
      })
      req.on('error', reject)
      req.end()
    })
  })

  it('authenticates WebSocket upgrades and forwards bidirectional bytes and upgrade head', async () => {
    const f = await fixture(), { cookie } = await f.open()
    let upstreamHeaders: IncomingMessage['headers'] | undefined
    f.upstream.on('upgrade', (req, socket, head) => {
      upstreamHeaders = req.headers
      socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nhello')
      if (head.length) socket.write(head)
      socket.on('data', chunk => socket.write(chunk))
    })
    const raw = (headers: string, expectText: string, upgrade = 'websocket') => new Promise<string>((resolve, reject) => {
      const socket = connect(f.gatewayPort, '127.0.0.1')
      let result = ''
      socket.setTimeout(3000, () => socket.destroy(new Error('WebSocket test timed out')))
      socket.on('connect', () => socket.write(`GET /hmr?client=one HTTP/1.1\r\nHost: ${f.host}\r\nConnection: Upgrade\r\nUpgrade: ${upgrade}\r\n${headers}\r\nfirst`))
      socket.on('error', reject)
      socket.on('data', data => { result += data.toString(); if (result.includes(expectText)) { socket.destroy(); resolve(result) } })
    })
    expect(await raw('', '401')).toContain('401')
    expect(await raw(`Cookie: ${cookie}\r\n`, '400', 'custom-protocol')).toContain('400')
    expect(await raw(`Cookie: ${cookie}\r\nOrigin: https://evil.test\r\n`, '403')).toContain('403')
    const result = await raw(`Cookie: ${cookie}; codex_remote_session=secret; theme=dark\r\nOrigin: https://${f.host}\r\n`, 'first')
    expect(result).toContain('101 Switching Protocols')
    expect(result).toContain('hello')
    expect(upstreamHeaders).toMatchObject({ host: `127.0.0.1:${f.appPort}`, cookie: 'theme=dark' })
  })
})


it('serves authenticated path previews with rewritten assets, scoped cookies and relative redirects', async () => {
  const seen: Array<{path?: string; cookie?: string}> = []
  const upstream = createServer((req, res) => {
    seen.push({ path: req.url, cookie: req.headers.cookie })
    if (req.url === '/redirect') { res.writeHead(302, {location: '/login'}); res.end(); return }
    if (req.url === '/module.js') { res.setHeader('Content-Type', 'application/javascript'); res.end('import value from "/dependency.js";'); return }
    res.setHeader('Content-Type', 'text/html')
    res.setHeader('Set-Cookie', ['app=yes; Path=/; Domain=example.test', 'codex_remote_session=bad; Path=/'])
    res.end('<html><head><script type="module" src="/module.js"></script><link href="/style.css" rel="stylesheet"></head><body>App</body></html>')
  })
  const appPort = await listen(upstream)
  const proxy = new LocalhostPreview({ publicOrigin: 'https://remote.example.test', sessionSecret: 'test-secret', blockedPorts: [5173] })
  const gateway = createServer((req,res) => proxy.handle(req,res))
  const gatewayPort = await listen(gateway)
  cleanup.push(async () => proxy.close())
  const get = (path: string, cookie?: string) => fetchLocal(gatewayPort, 'remote.example.test', path, {headers: cookie ? {cookie} : {}})
  const cookie = 'codex_remote_session=' + createSession('test-secret', 600).token
  const prefix = `/preview/${appPort}`
  const launch = proxy.createLaunch(appPort, '/nested?q=1', Math.floor(Date.now()/1000)+600)
  expect(launch.url).toBe(`https://remote.example.test${prefix}/nested?q=1`)
  expect((await get(prefix + '/')).status).toBe(401)
  expect((await get(prefix, cookie)).headers.location).toBe(prefix + '/')
  const html = await get(prefix + '/nested?q=1', cookie)
  expect(html.body.toString()).toContain(`src="${prefix}/module.js"`)
  expect(html.body.toString()).toContain('window.fetch =')
  expect(html.headers['set-cookie']).toEqual([`app=yes; Path=${prefix}/`])
  expect(html.headers['cache-control']).toBe('no-store')
  expect(html.headers['service-worker-allowed']).toBe(prefix + '/')
  expect((await get(prefix + '/module.js', cookie)).body.toString()).toContain(`from "${prefix}/dependency.js"`)
  expect((await get(prefix + '/redirect', cookie)).headers.location).toBe(`https://remote.example.test${prefix}/login`)
  expect(seen[0]).toEqual({ path: '/nested?q=1', cookie: undefined })
  expect((await get('/preview/5173/', cookie)).status).toBe(400)
  expect((await get('/preview/no-port/', cookie)).status).toBe(400)
})
