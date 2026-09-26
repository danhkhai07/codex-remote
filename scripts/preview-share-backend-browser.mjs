// Owned HTTPS fixture: exercises server-rendered capability bootstrap only, no app
// UI or real service registration, credentials, user conversations or model turns.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createServer, request } from 'node:http'
import { createServer as httpsServer } from 'node:https'
import { randomId } from '../dist-server/secure-wire.js'
import { ServicesStore } from '../dist-server/services.js'
import { PreviewShares } from '../dist-server/preview-shares.js'
import { createRemoteHttpServer } from '../dist-server/http-app.js'
import { RemoteController } from '../dist-server/controller.js'
import { CodexAppServer } from '../dist-server/codex-app-server.js'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? '/tmp/working-hours-browser/node_modules/playwright/index.mjs')
const root = mkdtempSync(join(tmpdir(), 'share-bootstrap-browser-')), cleanup = []
async function listen(server) {
  const sockets = new Set(); server.on('connection', s => { sockets.add(s); s.once('close', () => sockets.delete(s)) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise(resolve => { for (const s of sockets) s.destroy(); server.close(resolve) }))
  return server.address().port
}
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(root, 'tls.key'), '-out', join(root, 'tls.crt'), '-days', '1', '-subj', '/CN=fixture.test'], { stdio: 'ignore' })
  const observed = []
  const app = createServer((req, res) => {
    observed.push({ path: req.url, cookie: req.headers.cookie ?? '' })
    if (req.url === '/sw.js') {
      res.setHeader('Content-Type', 'text/javascript')
      res.end(`self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(new URL(e.request.url).pathname==='/__codex_preview__/share-redeem')e.respondWith((async()=>new Response(JSON.stringify({intercepted:true,url:e.request.url,body:await e.request.text(),referrer:e.request.referrer}),{headers:{'Content-Type':'text/plain'}}))())})`)
      return
    }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Shared fixture</title><h1>Shared app opened</h1>')
  }), appPort = await listen(app)
  let gateway
  const tls = httpsServer({ key: readFileSync(join(root, 'tls.key')), cert: readFileSync(join(root, 'tls.crt')) }, (req, res) => {
    const upstream = request({ host: '127.0.0.1', port: gateway, path: req.url, method: req.method, headers: req.headers }, reply => { res.writeHead(reply.statusCode, reply.headers); reply.pipe(res) })
    upstream.on('error', () => res.destroy()); res.once('close', () => upstream.destroy()); req.pipe(upstream)
  })
  const tlsPort = await listen(tls), publicOrigin = `https://owner.admin.test:${tlsPort}`
  const originTemplate = `https://p{port}.preview.test:${tlsPort}`
  const files = join(root, 'files'); mkdirSync(files)
  const services = new ServicesStore(join(root, 'services.json'), async () => true)
  services.upsert({ port: appPort, name: 'Fake browser service', path: '/app?x=1#part', summary: 'Fixture', prLabel: 'no PR' })
  const file = join(root, 'shares.json'), secret = 'synthetic browser secret '.repeat(3)
  const seed = new PreviewShares({ services, ports: [appPort], blockedPorts: [], file, publicOrigin, originTemplate, secret })
  const link = seed.create({ port: appPort, ttlSeconds: 120 }); seed.close()
  const material = { version: 1, app: randomId(), generation: randomId(), key: randomId(32) }
  const ownerFile = join(root, 'owner.json'); writeFileSync(ownerFile, JSON.stringify(material), { mode: 0o600 })
  const config = { host: '127.0.0.1', port: 0, publicOrigin: new URL(publicOrigin), password: 'fake fixture password only', sessionSecret: secret,
    sessionTtlSeconds: 600, codexBin: 'unused', production: true, workspaceRoots: [files], fileRoots: [files], secureApiRequired: true, secureKeyFile: ownerFile,
    sessionStateFile: join(root, 'sessions.json'), previewShareStateFile: file, previewOriginTemplate: originTemplate, previewSharePorts: [appPort] }
  const backend = createRemoteHttpServer(config, new RemoteController(config, new CodexAppServer('unused')), files, null, undefined, undefined, undefined, undefined, undefined, services)
  gateway = await listen(backend); config.port = gateway
  // The disposable certificate is not installed into host trust; Chromium's SW
  // fetch needs this fixture-only process flag in addition to context TLS bypass.
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--no-proxy-server', '--ignore-certificate-errors', '--host-resolver-rules=MAP owner.admin.test 127.0.0.1,MAP *.preview.test 127.0.0.1'] }); cleanup.push(() => browser.close())
  const evidence = []
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 600 }]) {
    const context = await browser.newContext({ viewport, ignoreHTTPSErrors: true })
    const page = await context.newPage(), requests = [], errors = []
    page.on('request', r => requests.push({ url: r.url(), method: r.method(), body: r.postData() ?? '' }))
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(link.url)
    try { await page.getByRole('heading', { name: 'Shared app opened' }).waitFor({ timeout: 15000 }) }
    catch (error) {
      console.log(JSON.stringify({ failedPath: new URL(page.url()).pathname, status: await page.locator('body').innerText(),
        requestPaths: requests.map(r => ({ method: r.method, host: new URL(r.url).host, path: new URL(r.url).pathname, bodyBytes: r.body.length })), errors: errors.length }))
      throw error
    }
    assert.equal(new URL(page.url()).host, `p${appPort}.preview.test:${tlsPort}`)
    assert.equal(new URL(page.url()).hash, '#part')
    const cap = new URL(link.url).hash.slice(1)
    assert(requests.every(r => !new URL(r.url).search.includes(cap)))
    const bearing = requests.filter(r => r.body.includes(cap))
    assert.equal(bearing.length, 1); assert.equal(new URL(bearing[0].url).origin, publicOrigin)
    assert.equal(new URL(bearing[0].url).pathname, '/__codex_preview_share__/exchange')
    assert(!JSON.stringify(observed).includes(cap)); assert(!JSON.stringify(observed).includes('__Host-codex'))
    assert.equal(errors.length, 0)
    await page.reload(); await page.getByRole('heading', { name: 'Shared app opened' }).waitFor()
    const cookies = await context.cookies(); assert(cookies.some(c => c.name === '__Host-codex_preview_share' && c.httpOnly && c.secure && c.sameSite === 'Lax'))
    assert(!cookies.some(c => c.name.includes('remote_session') || c.name === '__Host-codex_preview_session'))
    const screenshotDir = process.env.SHARE_SCREENSHOTS
    if (screenshotDir) { mkdirSync(screenshotDir, { recursive: true }); await page.screenshot({ path: resolve(screenshotDir, `share-${viewport.width}.png`) }) }
    if (viewport.width === 1280) {
      await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready })
      await page.reload(); await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
      await page.goto(link.url)
      await page.waitForURL(url => url.pathname === '/__codex_preview__/share-redeem')
      const intercepted = JSON.parse(await page.locator('body').innerText())
      assert.equal(intercepted.intercepted, true)
      assert(!JSON.stringify(intercepted).includes(cap))
      assert.match(new URLSearchParams(intercepted.body).get('ticket'), /^[A-Za-z0-9_-]{43}$/)
      assert.equal(new URL(intercepted.url).hash, '')
      assert.equal(new URL(intercepted.referrer).origin, publicOrigin)
      assert(!intercepted.referrer.includes('/preview/'))
    }
    await page.goto(publicOrigin + '/preview/share#invalid')
    await page.getByRole('status').filter({ hasText: 'Link không hợp lệ' }).waitFor(); assert.equal(new URL(page.url()).hash, '')
    evidence.push({ viewport, crossSiteBootstrap: true, reload: true, noOwnerSession: true, fragmentCleared: true, capOnlySentToAdminExchange: true,
      appWorkerSeesOnlyOneUseHandoff: viewport.width === 1280, errors: errors.length })
    await context.close()
  }
  console.log(JSON.stringify({ passed: true, tests: evidence, realModelTurns: 0, productionAccess: false }, null, 2))
} finally {
  for (const close of cleanup.reverse()) await close()
  rmSync(root, { recursive: true, force: true })
}
