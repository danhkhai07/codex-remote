// Isolated Vite + real SessionRegistry with fake credentials; no production credentials, real RPC or model turns.
// Build server first. PLAYWRIGHT_MODULE may point at an external installation.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as httpServer } from 'node:http'
import { once } from 'node:events'
import { createServer as viteServer, build } from 'vite'
import { randomBytes } from 'node:crypto'
import { createRemoteHttpServer } from '../dist-server/http-app.js'
import { RemoteController } from '../dist-server/controller.js'
import { CodexAppServer } from '../dist-server/codex-app-server.js'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = await mkdtemp(join(tmpdir(), 'preview-cache-browser-'))
const secureRoot = await mkdtemp(join(tmpdir(), 'preview-cache-key-'))
const encrypted = process.env.SECURE_FIXTURE === '1'
const material = { version: 1, app: randomBytes(24).toString('base64url'), generation: randomBytes(24).toString('base64url'), key: randomBytes(32).toString('base64url') }
const events = []
let vite, browser, secondApp, gateway

try {
  await writeFile(join(root, 'index.html'), '<html><head></head><body><script type="module" src="/main.js"></script></body></html>')
  await writeFile(join(root, 'main.js'), `import { value } from './dep.js'; document.body.dataset.version = value;
if (import.meta.hot) import.meta.hot.accept('./dep.js', m => { document.body.dataset.version = m.value; });`)
  await writeFile(join(root, 'dep.js'), 'export const value = "one";')
  const reservation = httpServer()
  reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening')
  const freePort = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  vite = await viteServer({ configFile: false, root, server: { host: '127.0.0.1', port: freePort, strictPort: true, watch: { usePolling: true, interval: 100 } } })
  vite.middlewares.use('/api/data', (_req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"fixture":true}') })
  await vite.listen()
  const appPort = vite.httpServer.address().port
  const reservationGateway = httpServer()
  reservationGateway.listen(0, '127.0.0.1'); await once(reservationGateway, 'listening')
  const gatewayPort = reservationGateway.address().port
  await new Promise(resolve => reservationGateway.close(resolve))
  const origin = 'http://admin.localhost:' + gatewayPort
  const config = { host: '127.0.0.1', port: gatewayPort, publicOrigin: new URL(origin), password: 'fixture password only', sessionSecret: 'fixture-only-secret'.repeat(3), sessionTtlSeconds: 600, workspaceRoots: [root], fileRoots: [root], production: true, previewOriginTemplate: 'http://p{port}.localhost:' + gatewayPort, sessionStateFile: join(root, '.state', 'sessions.json') }
  const shell = join(root, 'control'); await mkdir(shell)
  if (encrypted) {
    await writeFile(join(secureRoot, 'owner.json'), JSON.stringify(material), { mode: 0o600 })
    Object.assign(config, { secureApiRequired: true, secureKeyFile: join(secureRoot, 'owner.json') })
    await build({ configFile: false, logLevel: 'error', build: { outDir: shell, emptyOutDir: false, lib: { entry: new URL('../server/secure-client.ts', import.meta.url).pathname, formats: ['es'], fileName: () => 'secure-fixture.js' } } })
  }
  await writeFile(join(shell, 'index.html'), '<html><head></head><body>Control fixture</body></html>')
  gateway = createRemoteHttpServer(config, new RemoteController(config, new CodexAppServer('unused')), shell, null)
  gateway.prependListener('request', (req, res) => {
    let bytes = 0
    const write = res.write.bind(res), end = res.end.bind(res)
    res.write = (chunk, ...args) => { if (chunk) bytes += Buffer.byteLength(chunk); return write(chunk, ...args) }
    res.end = (chunk, ...args) => { if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) bytes += Buffer.byteLength(chunk); return end(chunk, ...args) }
    res.on('finish', () => events.push({ path: req.url, status: res.statusCode, bytes }))
  })
  gateway.listen(gatewayPort, '127.0.0.1'); await once(gateway, 'listening')
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const admin = await context.newPage()
  await admin.goto(origin)
  const login = await admin.evaluate(async password => {
    const res = await fetch('/api/session/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
    return res.json()
  }, config.password)
  await admin.evaluate(async ({ encrypted, key }) => {
    if (encrypted) { const { SecureTransport } = await import('/secure-fixture.js'); window.channel = new SecureTransport(); await window.channel.unlock(key) }
    window.privateFetch = async (path, init) => window.channel ? (await window.channel.request(path, init)).response : fetch(path, init)
  }, { encrypted, key: material.key })
  const launch = async port => admin.evaluate(async ({ port, csrf }) => (await window.privateFetch('/api/localhost-preview', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ port }) })).json(), { port, csrf: login.csrf })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const sockets = []
  page.on('websocket', ws => sockets.push(ws))
  const url = (await launch(appPort)).url
  events.length = 0
  await page.goto(url); await page.waitForFunction(() => document.body.dataset.version === 'one')
  await page.waitForLoadState('networkidle')
  const initial = events.splice(0)
  await page.reload(); await page.waitForFunction(() => document.body.dataset.version === 'one')
  await page.waitForLoadState('networkidle')
  const reload = events.splice(0)
  const bytes = list => list.reduce((sum, event) => sum + event.bytes, 0)
  assert(reload.some(event => event.status === 304), 'reload must revalidate')
  assert(bytes(reload) < bytes(initial), 'reload must transfer fewer response bytes')
  await writeFile(join(root, 'dep.js'), 'export const value = "two";')
  let rebuilt = false
  for (let attempt = 0; attempt < 100; attempt++) {
    const source = await (await fetch('http://127.0.0.1:' + appPort + '/dep.js')).text()
    if (source.includes('value = "two"')) { rebuilt = true; break }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert(rebuilt, 'Vite must rebuild before reload assertion')
  await page.waitForFunction(() => document.body.dataset.version === 'two')
  assert(sockets.length > 0, 'Vite HMR WebSocket connected')
  await page.reload()
  try { await page.waitForFunction(() => document.body.dataset.version === 'two') }
  catch (error) { console.error(JSON.stringify({ events, version: await page.evaluate(() => document.body.dataset.version), main: await page.evaluate(async () => (await (await fetch('/main.js', {cache: 'no-store'})).text()).slice(0, 500)) })); throw error }
  const api = await page.evaluate(async () => {
    const a = await fetch('/api/data'), b = await fetch('/api/data')
    return [a.headers.get('cache-control'), b.headers.get('cache-control')]
  })
  assert.deepEqual(api, ['no-store', 'no-store'])
  secondApp = httpServer((req, res) => {
    res.setHeader('cache-control', 'public, max-age=31536000')
    res.setHeader('content-type', req.url === '/main.js' ? 'application/javascript' : 'text/html')
    res.end(req.url === '/main.js' ? 'document.body.dataset.version = "port-b";' : '<html><head></head><body><script src="/main.js"></script></body></html>')
  })
  secondApp.listen(0, '127.0.0.1'); await once(secondApp, 'listening')
  const otherPort = secondApp.address().port, otherPage = await context.newPage()
  await otherPage.goto((await launch(otherPort)).url)
  await otherPage.waitForFunction(() => document.body.dataset.version === 'port-b')
  assert.equal(await page.evaluate(() => document.body.dataset.version), 'two')
  await otherPage.close()
  const activeSocket = sockets.at(-1)
  const socketClosed = activeSocket.waitForEvent('close', { timeout: 10000 })
  const oldCookies = await context.cookies()
  const logout = await admin.evaluate(async csrf => { const r = await window.privateFetch('/api/session/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: '{}' }); await r.arrayBuffer(); return r.status }, login.csrf)
  assert.equal(logout, 200)
  await socketClosed
  assert.equal((await page.reload()).status(), 401)
  await context.addCookies(oldCookies)
  assert.equal((await page.reload()).status(), 401)
  assert.equal(await admin.evaluate(async encrypted => (await fetch(encrypted ? '/api/secure/challenge' : '/api/session', encrypted ? { method: 'POST' } : {})).status, encrypted), 401)
  assert.deepEqual(pageErrors, [])
  console.log(JSON.stringify({ initialBytes: bytes(initial), reloadBytes: bytes(reload),
    reductionPercent: Number((100 * (1 - bytes(reload) / bytes(initial))).toFixed(2)),
    revalidatedRequests: reload.filter(event => event.status === 304).length,
    mode: encrypted ? 'isolated-encrypted-api-real-registry' : 'isolated-real-registry', hmr: true, websocketClosedOnLogout: true, changedContent: true, logout: true, replayedAdminAndGrant401: true, apiNoStore: true, twoPorts: true, pageErrors }))
} finally {
  await browser?.close()
  if (gateway) { gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve)) }
  if (secondApp) { secondApp.closeAllConnections(); await new Promise(resolve => secondApp.close(resolve)) }
  await vite?.close()
  await rm(root, { recursive: true, force: true })
  await rm(secureRoot, { recursive: true, force: true })
}
