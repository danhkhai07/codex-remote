// Reproduce a pre-existing shared-origin preview SW/tab across a candidate cutover.
// Isolated local fake credentials only. This records a remaining migration gate.
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { createRemoteHttpServer } from '../dist-server/http-app.js'
import { RemoteController } from '../dist-server/controller.js'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = await mkdtemp(join(tmpdir(), 'migration-browser-'))
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
let browser, gateway, front
let legacy = true
const oldPath = '/preview/5180/'
const oldHtml = '<!doctype html><title>Legacy canary</title><body>LEGACY_CANARY<script>window.legacyCanary=true</script></body>'
try {
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Control fixture</title><body>Control fixture</body>')
  await writeFile(join(root, 'app-sw.js'), 'self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));')
  await writeFile(join(root, 'cleanup.js'), ts.transpileModule(await readFile('src/legacyPreviewWorkers.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText)
  const config = { host: '127.0.0.1', port: 0, publicOrigin: new URL('http://localhost'), password: 'migration fake password', sessionSecret: 'migration-fake-secret'.repeat(3), sessionTtlSeconds: 600, workspaceRoots: [root], fileRoots: [root], production: true, codexBin: 'unused', sessionStateFile: join(root, '.state', 'sessions.json') }
  gateway = createRemoteHttpServer(config, new RemoteController(config, new CodexAppServer('unused')), root, null)
  const internalPort = await listen(gateway)
  front = createServer((req, res) => {
    if (legacy && req.url.startsWith(oldPath)) {
      res.setHeader('Cache-Control', 'no-store')
      if (req.url === oldPath + 'evil-sw.js') {
        res.setHeader('Content-Type', 'application/javascript')
        res.setHeader('Service-Worker-Allowed', oldPath)
        res.end(`self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open('legacy-fixture');await c.put('${oldPath}',new Response(${JSON.stringify(oldHtml)},{headers:{'Content-Type':'text/html'}}));await self.skipWaiting()})()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(e.request.mode==='navigate')e.respondWith(caches.match('${oldPath}'))});`)
      } else { res.setHeader('Content-Type', 'text/html'); res.end(oldHtml) }
      return
    }
    const upstream = request({ hostname: '127.0.0.1', port: internalPort, method: req.method, path: req.url, headers: req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res) })
    upstream.on('error', () => res.destroy()); res.on('close', () => upstream.destroy()); req.pipe(upstream)
  })
  const port = await listen(front), origin = 'http://localhost:' + port
  config.publicOrigin = new URL(origin); config.port = internalPort
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext(), admin = await context.newPage(), old = await context.newPage()
  await admin.goto(origin)
  await admin.evaluate(async () => { localStorage.setItem('draft-fixture', 'keep me'); await navigator.serviceWorker.register('/app-sw.js', { scope: '/' }); await navigator.serviceWorker.ready })
  await old.goto(origin + oldPath)
  await old.evaluate(async () => { await navigator.serviceWorker.register('./evil-sw.js', { scope: './' }) })
  await old.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith('evil-sw.js'))
  legacy = false
  const intercepted = await old.reload()
  assert(intercepted.fromServiceWorker())
  assert.equal(await old.evaluate(() => window.legacyCanary), true)
  const frame = await admin.evaluateHandle(path => { const f = document.createElement('iframe'); f.src = path; document.body.append(f); return f }, oldPath)
  await admin.waitForFunction(() => document.querySelector('iframe')?.contentWindow.legacyCanary === true)
  await context.setOffline(true)
  assert((await old.reload()).fromServiceWorker())
  await context.setOffline(false)
  await admin.evaluate(async password => {
    const r = await fetch('/api/session/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }); if (!r.ok) throw Error('login failed')
    const { unregisterLegacyPreviewWorkers } = await import('/cleanup.js')
    await unregisterLegacyPreviewWorkers(navigator.serviceWorker, location.origin)
  }, config.password)
  const scopes = await admin.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(r => new URL(r.scope).pathname))
  assert.deepEqual(scopes, ['/'])
  const oldCanStillRead = await old.evaluate(async () => { const r = await fetch('/api/session'); const data = await r.json(); return r.status === 200 && typeof data.csrf === 'string' })
  assert(oldCanStillRead, 'unregister does not terminate the existing same-origin document')
  assert.equal(await admin.evaluate(() => localStorage.getItem('draft-fixture')), 'keep me')
  await frame.evaluate(f => f.remove()); await old.close()
  const fresh = await context.newPage(), response = await fresh.goto(origin + oldPath)
  assert.equal(response.status(), 503) // isolation intentionally unconfigured => fail closed
  assert.equal(await fresh.evaluate(() => Boolean(window.legacyCanary)), false)
  console.log(JSON.stringify({ oldNavigationIntercepted: true, oldIframeExecuted: true, oldOfflineNavigationIntercepted: true, actualCleanupRemovedPreviewScope: true, rootWorkerAndDraftPreserved: true, existingTabStillReadsNewSession: oldCanStillRead, afterClosingLegacyClientsFreshNavigation503: true, remainingP1: 'Migration requires closing all old preview/workboard clients before reauthentication; unregister alone is insufficient. Clean/new admin origin required if prior arbitrary same-origin compromise is assumed.' }))
} finally {
  await browser?.close()
  for (const server of [front, gateway]) if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await rm(root, { recursive: true, force: true })
}
