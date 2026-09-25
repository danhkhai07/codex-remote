import { historyFixtureConfig } from '../server/fixtures/history-store.mjs'
// Real browser storage/old SW + tab across cutover. Fake credentials, no model turns.
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { createRemoteHttpServer } from '../dist-server/http-app.js'
import { RemoteController } from '../dist-server/controller.js'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = await mkdtemp(join(tmpdir(), 'migration-browser-'))
const shots = process.env.MIGRATION_SCREENSHOTS
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
let browser, gateway, front, controller
let legacy = true, sessionReads = 0, logins = 0, modelCalls = 0
const oldPath = '/preview/5180/'
const oldHtml = '<!doctype html><title>Legacy canary</title><body>LEGACY_CANARY<script>window.legacyCanary=true</script></body>'
try {
  const helper = ts.transpileModule(await readFile('src/legacyPreviewWorkers.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
  const config = { ...historyFixtureConfig(), host: '127.0.0.1', port: 0, publicOrigin: new URL('http://localhost'), password: 'migration fake password', sessionSecret: 'migration-fake-secret'.repeat(3), sessionTtlSeconds: 600, workspaceRoots: [root], fileRoots: [root], production: true, codexBin: 'unused', sessionStateFile: join(root, '.state', 'sessions.json') }
  controller = new RemoteController(config, new CodexAppServer(process.execPath, [resolve('server/fixtures/plan-questions.mjs')]))
  await controller.start()
  gateway = createRemoteHttpServer(config, controller, resolve('dist'), null)
  const internalPort = await listen(gateway)
  front = createServer((req, res) => {
    if (req.url === '/fixture-control') { res.setHeader('Content-Type','text/html'); res.end('<!doctype html><title>Fixture</title><body>Control fixture</body>'); return }
    if (req.url === '/fixture-cleanup.js' || req.url === '/fixture-app-sw.js') {
      res.setHeader('Content-Type','application/javascript'); res.setHeader('Cache-Control','no-store')
      res.end(req.url === '/fixture-cleanup.js' ? helper : 'self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));'); return
    }
    if (legacy && req.url.startsWith(oldPath)) {
      res.setHeader('Cache-Control', 'no-store')
      if (req.url === oldPath + 'evil-sw.js' || req.url === oldPath + 'arbitrary-sw.js') {
        res.setHeader('Content-Type', 'application/javascript'); res.setHeader('Service-Worker-Allowed', req.url.endsWith('arbitrary-sw.js') ? '/' : oldPath)
        res.end(`self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open('legacy-fixture');await c.put('${oldPath}',new Response(${JSON.stringify(oldHtml)},{headers:{'Content-Type':'text/html'}}));await self.skipWaiting()})()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(e.request.mode==='navigate')e.respondWith(caches.match('${oldPath}'))});`)
      } else { res.setHeader('Content-Type', 'text/html'); res.end(oldHtml) }
      return
    }
    if (req.url === '/api/session') sessionReads++
    if (req.url === '/api/session/login') logins++
    if (req.url.match(/^\/api\/threads\/.*\/turns/)) modelCalls++
    const upstream = request({ hostname: '127.0.0.1', port: internalPort, method: req.method, path: req.url, headers: req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res) })
    upstream.on('error', () => res.destroy()); res.on('close', () => upstream.destroy()); req.pipe(upstream)
  })
  const port = await listen(front), origin = 'http://localhost:' + port
  config.publicOrigin = new URL(origin); config.port = internalPort
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext(), admin = await context.newPage(), old = await context.newPage()
  await admin.goto(origin + '/fixture-control')
  await admin.evaluate(async () => {
    localStorage.setItem('draft-fixture','keep me')
    const c = await caches.open('app-fixture'); await c.put('/workboard/',new Response('LEGACY_WORKBOARD')); await c.put('/assets/keep.js',new Response('KEEP_ASSET'))
    await navigator.serviceWorker.register('/fixture-app-sw.js',{scope:'/'}); await navigator.serviceWorker.ready
  })
  await old.goto(origin + oldPath)
  await old.evaluate(async () => { await navigator.serviceWorker.register('./evil-sw.js', { scope: './' }) })
  await old.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith('evil-sw.js'))
  legacy = false
  assert((await old.reload()).fromServiceWorker())
  assert.equal(await old.evaluate(() => window.legacyCanary), true)
  await admin.evaluate(path => { const f = document.createElement('iframe'); f.src = path; document.body.append(f) }, oldPath)
  await admin.waitForFunction(() => document.querySelector('iframe')?.contentWindow.legacyCanary === true)
  await context.setOffline(true); assert((await old.reload()).fromServiceWorker()); await context.setOffline(false)
  const cleanupError = await admin.evaluate(async () => {
    try { await (await import('/fixture-cleanup.js')).cleanupLegacyPreviewEnvironment(); return '' } catch (e) { return e.message }
  })
  assert.match(cleanupError,/Còn 1 tab/)
  assert.equal(await admin.locator('iframe').count(),0,'owned legacy frame closed')
  assert.equal(sessionReads,0); assert.equal(logins,0)
  await admin.goto(origin)
  await admin.getByRole('alert').filter({hasText:'tab hoặc cửa sổ'}).waitFor()
  assert.equal(await admin.locator('#password').count(),0,'no login mounted before cleanup')
  assert.equal(sessionReads,0,'initial restore blocked'); assert.equal(logins,0)
  if (shots) { await mkdir(shots,{recursive:true}); await admin.setViewportSize({width:390,height:600}); await admin.screenshot({path:join(shots,'migration-blocked-mobile.png')}) }
  await old.close()
  await admin.getByRole('button',{name:'Thử lại',exact:true}).click()
  await admin.locator('#password').waitFor()
  assert(sessionReads>0)
  assert.equal(await admin.evaluate(() => localStorage.getItem('draft-fixture')),'keep me')
  const cacheState = await admin.evaluate(async () => ({ old: Boolean(await caches.match('/workboard/')) || Boolean(await caches.match('/preview/5180/')), kept: Boolean(await caches.match('/assets/keep.js')), scopes: (await navigator.serviceWorker.getRegistrations()).map(r=>new URL(r.scope).pathname) }))
  assert.equal(cacheState.old,false); assert.equal(cacheState.kept,true); assert(cacheState.scopes.includes('/'))
  assert(!cacheState.scopes.includes(oldPath))

  // An old document reappearing after initial readiness must also block login.
  legacy = true
  const late = await context.newPage(); await late.goto(origin+oldPath); legacy = false
  await admin.locator('#password').fill(config.password)
  await admin.getByRole('button',{name:'Open Codex Remote',exact:true}).click()
  await admin.getByRole('alert').filter({hasText:'tab hoặc cửa sổ'}).waitFor()
  assert.equal(logins,0,'password was not sent after late legacy client appeared')
  await late.close()

  // Delay actual browser cleanup: no POST until that Promise has completed.
  await admin.evaluate(() => {
    const original = navigator.serviceWorker.getRegistrations.bind(navigator.serviceWorker)
    navigator.serviceWorker.getRegistrations = () => new Promise(resolve => { window.releaseCleanup=()=>{navigator.serviceWorker.getRegistrations=original; original().then(resolve)} })
  })
  await admin.getByRole('button',{name:'Open Codex Remote',exact:true}).click()
  await admin.waitForFunction(()=>typeof window.releaseCleanup==='function')
  assert.equal(logins,0)
  await admin.evaluate(()=>window.releaseCleanup())
  await admin.waitForFunction(()=>!document.querySelector('#password'))
  assert.equal(logins,1)
  const fresh = await context.newPage(), response=await fresh.goto(origin+oldPath)
  assert.equal(response.status(),503); assert.equal(await fresh.evaluate(()=>Boolean(window.legacyCanary)),false)
  await context.close()

  // Recoverable enumeration failure in the real shell, with no network auth bypass.
  const failureContext=await browser.newContext(), failure=await failureContext.newPage()
  await failure.addInitScript(()=>{
    const original=navigator.serviceWorker.getRegistrations.bind(navigator.serviceWorker)
    navigator.serviceWorker.getRegistrations=async()=>{
      if(!sessionStorage.getItem('fixture-failed')){sessionStorage.setItem('fixture-failed','yes');throw Error('fixture unavailable')}
      return original()
    }
  })
  const priorReads=sessionReads, priorLogins=logins
  await failure.goto(origin)
  await failure.getByRole('alert').filter({hasText:'Không hoàn tất'}).waitFor()
  assert.equal(sessionReads,priorReads);assert.equal(logins,priorLogins)
  await failure.getByRole('button',{name:'Thử lại',exact:true}).click()
  await failure.locator('#password').waitFor()
  if(shots){await failure.setViewportSize({width:1280,height:900});await failure.screenshot({path:join(shots,'migration-recovered-desktop.png')})}
  await failureContext.close()

  // Deliberate boundary proof: arbitrary old SW persistence can live outside known URLs. The inspector
  // is not an integrity attestation, so the clean-profile operator gate is mandatory.
  const residual=await browser.newContext(), hidden=await residual.newPage(), clean=await residual.newPage()
  legacy=true; await hidden.goto(origin+oldPath)
  await hidden.evaluate(async()=>{await navigator.serviceWorker.register('./arbitrary-sw.js',{scope:'/other-cached-page/'})})
  await hidden.waitForFunction(async()=>Boolean((await navigator.serviceWorker.getRegistration('/other-cached-page/'))?.active))
  legacy=false
  assert((await hidden.goto(origin+'/other-cached-page/')).fromServiceWorker())
  assert.equal(await hidden.evaluate(()=>window.legacyCanary),true)
  await clean.goto(origin);await clean.locator('#password').fill(config.password)
  await clean.getByRole('button',{name:'Open Codex Remote',exact:true}).click()
  await clean.waitForFunction(()=>!document.querySelector('#password'))
  const residualRead=await hidden.evaluate(async()=>{const r=await fetch('/api/session');const data=await r.json();return r.status===200&&typeof data.csrf==='string'})
  assert(residualRead,'known-path detection cannot prove arbitrary same-origin residue absent')
  await residual.close()
  assert.equal(modelCalls,0)
  const result={oldSwTabAndOfflineCanaryReproduced:true,ownedIframeClosed:true,knownLegacyTabBlocksRestoreAndLogin:true,lateLegacyTabBlocksLogin:true,passwordWaitsForCleanup:true,retryAfterFailure:true,knownLegacyCacheRemoved:true,rootWorkerDraftOtherCachePreserved:true,afterClosingFreshPreview503:true,arbitraryScopeResidualStillReadsSession:residualRead,cleanProfileRequired:true,modelCalls}
  if(shots)await writeFile(join(shots,'result.json'),JSON.stringify(result,null,2))
  console.log(JSON.stringify(result))
} finally {
  await browser?.close()
  controller?.stop()
  for (const server of [front, gateway]) if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await rm(root,{recursive:true,force:true})
}
