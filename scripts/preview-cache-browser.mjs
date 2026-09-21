// Isolated Vite + fake auth; no production credentials, real RPC or model turns.
// Build server first. PLAYWRIGHT_MODULE may point at an external installation.
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as httpServer } from 'node:http'
import { once } from 'node:events'
import { createServer as viteServer } from 'vite'
import { createSession } from '../dist-server/auth.js'
const { LocalhostPreview } = await import(process.env.PREVIEW_PROXY_MODULE || '../dist-server/localhost-preview.js')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = await mkdtemp(join(tmpdir(), 'preview-cache-browser-'))
const events = []
const isolated = process.env.PREVIEW_CACHE_MODE === 'isolated'
let vite, proxy, browser, secondApp, revoked = false
const gateway = httpServer((req, res) => {
  let bytes = 0
  const write = res.write.bind(res), end = res.end.bind(res)
  res.write = (chunk, ...args) => { if (chunk) bytes += Buffer.byteLength(chunk); return write(chunk, ...args) }
  res.end = (chunk, ...args) => { if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) bytes += Buffer.byteLength(chunk); return end(chunk, ...args) }
  res.on('finish', () => events.push({ path: req.url, status: res.statusCode, bytes, inm: req.headers['if-none-match'], etag: res.getHeader('etag') }))
  // Simulates the security branch's guard BEFORE proxy/revalidation.
  if (revoked) { res.writeHead(401, { 'cache-control': 'no-store' }); res.end('revoked fixture grant'); return }
  proxy.handle(req, res)
})
gateway.on('upgrade', (req, socket, head) => proxy.handleUpgrade(req, socket, head))
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
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening')
  const gatewayPort = gateway.address().port, origin = 'http://' + (isolated ? 'p' + appPort + '.localhost' : '127.0.0.1') + ':' + gatewayPort
  proxy = new LocalhostPreview({ ...(isolated ? { originTemplate: 'http://p{port}.localhost:' + gatewayPort } : { publicOrigin: origin }), sessionSecret: 'fixture-only', blockedPorts: [gatewayPort] })
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ serviceWorkers: 'block' })
  if (!isolated) await context.addCookies([{ name: 'codex_remote_session', value: createSession('fixture-only', 600).token, url: origin }])
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const sockets = []
  page.on('websocket', ws => sockets.push(ws.url()))
  const url = origin + (isolated ? '/' : '/preview/' + appPort + '/')
  if (isolated) await page.goto(proxy.createLaunch(appPort, '/', Math.floor(Date.now() / 1000) + 600).url)
  await page.goto(url); await page.waitForFunction(() => document.body.dataset.version === 'one')
  await page.waitForLoadState('networkidle')
  const initial = events.splice(0)
  await page.reload(); await page.waitForFunction(() => document.body.dataset.version === 'one')
  await page.waitForLoadState('networkidle')
  const reload = events.splice(0)
  const bytes = list => list.reduce((sum, event) => sum + event.bytes, 0)
  if (!process.env.PREVIEW_CACHE_BASELINE) assert(reload.some(event => event.status === 304), 'reload must revalidate')
  if (!process.env.PREVIEW_CACHE_BASELINE) assert(bytes(reload) < bytes(initial), 'reload must transfer fewer response bytes')
  await writeFile(join(root, 'dep.js'), 'export const value = "two";')
  let rebuilt = false
  for (let attempt = 0; attempt < 100; attempt++) {
    const source = await (await fetch('http://127.0.0.1:' + appPort + '/dep.js')).text()
    if (source.includes('value = "two"')) { rebuilt = true; break }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert(rebuilt, 'Vite must rebuild before reload assertion')
  if (isolated || process.env.PREVIEW_CACHE_BASELINE) await page.waitForFunction(() => document.body.dataset.version === 'two')
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
  await otherPage.goto(proxy.createLaunch(otherPort, '/', Math.floor(Date.now() / 1000) + 600).url)
  await otherPage.waitForFunction(() => document.body.dataset.version === 'port-b')
  assert.equal(await page.evaluate(() => document.body.dataset.version), 'two')
  await otherPage.close()
  revoked = true
  assert.equal((await page.reload()).status(), 401)
  revoked = false
  await context.clearCookies()
  assert.equal((await page.goto(url)).status(), 401)
  if (isolated) assert.deepEqual(pageErrors, [])
  console.log(JSON.stringify({ initialBytes: bytes(initial), reloadBytes: bytes(reload),
    reductionPercent: Number((100 * (1 - bytes(reload) / bytes(initial))).toFixed(2)),
    revalidatedRequests: reload.filter(event => event.status === 304).length,
    mode: isolated ? 'isolated' : 'path', hmr: isolated ? true : 'path-mode update not asserted', changedContent: true, fakeRevokedGuard: true, clearedCookie: true, apiNoStore: true, twoPorts: true, pageErrors }))
} finally {
  await browser?.close()
  proxy?.close()
  gateway.closeAllConnections()
  await new Promise(resolve => gateway.close(resolve))
  if (secondApp) { secondApp.closeAllConnections(); await new Promise(resolve => secondApp.close(resolve)) }
  await vite?.close()
  await rm(root, { recursive: true, force: true })
}
