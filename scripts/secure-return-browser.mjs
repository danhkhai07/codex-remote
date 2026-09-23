// Real Chromium/Gate/BroadcastChannel/IDB + real SessionRegistry; fake credentials only.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { build } from 'vite'
import { createRemoteHttpServer } from '../dist-server/http-app.js'
import { RemoteController } from '../dist-server/controller.js'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
import { createSession } from '../dist-server/auth.js'
import { AttachmentStore } from '../dist-server/attachments.js'
const legacyFirstClaim = process.env.RETURN_LEGACY_CONTROLLER === '1'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = await mkdtemp(join(tmpdir(), 'secure-lifetime-')), files = join(root, 'files'), dist = join(root, 'dist')
const random = (n = 24) => randomBytes(n).toString('base64url')
const material = { version: 1, app: random(), generation: random(), key: random(32) }
let browser, server, attachments, effects = 0
const modulePath = path => JSON.stringify(resolve(path))
try {
  await mkdir(files); await mkdir(dist)
  const note = join(files, 'note.txt'); await writeFile(note, 'PRIVATE LIFETIME CANARY')
  await writeFile(join(root, 'key.json'), JSON.stringify(material), { mode: 0o600 })
  const entry = join(root, 'entry.tsx')
  await writeFile(entry, `import React from ${modulePath('node_modules/react/index.js')};
import {createRoot} from ${modulePath('node_modules/react-dom/client.js')};
import {SecureGate} from ${modulePath('src/SecureGate.tsx')};
import * as secure from ${modulePath('src/secureApi.ts')};
import {installControllerReload} from ${modulePath('src/pwaController.ts')};
${legacyFirstClaim ? `let refreshing=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(refreshing)return;refreshing=true;window.location.reload()});` : `installControllerReload(navigator.serviceWorker,()=>window.location.reload());`}
import {CipherCache} from ${modulePath('src/secureCache.ts')};
import {downloadSecureFile} from ${modulePath('src/SecureFiles.tsx')};
import {importOwner} from ${modulePath('server/secure-wire.ts')};
window.fixtureSecure={...secure,CipherCache,downloadSecureFile,importOwner};
const root=createRoot(document.getElementById('root'));
window.unmountGate=()=>root.unmount();
root.render(React.createElement(SecureGate,null,React.createElement('p',{id:'private-ui'},'Private content authorized')));`)
  await build({ configFile: false, logLevel: 'error', define: { 'process.env.NODE_ENV': JSON.stringify('production') }, build: { outDir: dist, emptyOutDir: false, lib: { entry, formats: ['es'], fileName: () => 'lifetime.js' } } })
  await writeFile(join(dist, 'index.html'), '<html><body><div id="root"></div><script type="module" src="/lifetime.js"></script></body></html>')
  const config = { host: '127.0.0.1', port: 0, publicOrigin: new URL('http://127.0.0.1'), password: 'FAKE lifetime password', sessionSecret: 'fake-lifetime-secret'.repeat(3), sessionTtlSeconds: 600, codexBin: 'UNUSED', production: true, workspaceRoots: [files], fileRoots: [files], secureApiRequired: true, secureKeyFile: join(root, 'key.json'), sessionStateFile: join(root, 'sessions.json') }
  const controller = new RemoteController(config, new CodexAppServer('UNUSED'))
  attachments = new AttachmentStore(join(root, 'uploads'))
  const add = attachments.add.bind(attachments); attachments.add = (...args) => { effects++; return add(...args) }
  server = createRemoteHttpServer(config, controller, dist, null, undefined, attachments)
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); config.port = server.address().port; config.publicOrigin = new URL('http://127.0.0.1:' + config.port)
  const profile = join(root, 'profile')
  const launch = () => chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 390, height: 844 }, isMobile: true })
  browser = await launch()
  let page = browser.pages()[0]
  const login = async () => {
    const r = await browser.request.post(config.publicOrigin.origin + '/api/session/login', { headers: { Origin: config.publicOrigin.origin }, data: { password: config.password } })
    assert.equal(r.status(), 200)
    const header = r.headers()['set-cookie']
    assert(header.includes('HttpOnly') && header.includes('SameSite=Strict') && header.includes('Max-Age=600'))
  }
  const unlock = async target => {
    await target.getByLabel('Khóa mã hóa riêng', { exact: true }).fill(material.key)
    await target.getByRole('button', { name: 'Mở khóa', exact: true }).click()
    await target.locator('#private-ui').waitFor()
  }
  const readSession = target => target.evaluate(async () => { const r = await window.fixtureSecure.secureFetch('/api/session'); await r.arrayBuffer(); return r.status })
  await login(); await page.goto(config.publicOrigin.origin); await unlock(page)
  const workerFile=join(dist,'return-worker.js')
  const workerSource=version=>`// ${version}\nself.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('message',e=>{if(e.data?.type==='SKIP_WAITING')self.skipWaiting()});`
  await writeFile(workerFile,workerSource(1))
  let navigations=0
  page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++})
  await page.evaluate(async()=>{await navigator.serviceWorker.register('/return-worker.js?v=1');await navigator.serviceWorker.ready})
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller))
  if(legacyFirstClaim){await page.getByLabel('Khóa mã hóa riêng',{exact:true}).waitFor();assert.equal(navigations,1);assert.equal(await page.evaluate(()=>window.fixtureSecure.secureUnlocked()),false);await unlock(page)}
  else {assert.equal(navigations,0);assert.equal(await readSession(page),200)}
  await writeFile(workerFile,workerSource(2))
  await page.evaluate(async()=>{await navigator.serviceWorker.register('/return-worker.js?v=2')})
  await page.waitForFunction(async()=>Boolean((await navigator.serviceWorker.getRegistration()).waiting))
  await page.evaluate(async()=>{(await navigator.serviceWorker.getRegistration()).waiting.postMessage({type:'SKIP_WAITING'})})
  await page.getByLabel('Khóa mã hóa riêng', {exact:true}).waitFor()
  assert.equal(navigations,legacyFirstClaim?2:1);await unlock(page)
  const before = (await browser.cookies()).find(c => c.name === 'codex_remote_session')
  assert(before && before.expires > Date.now() / 1000 + 590)
  const cdp = await browser.newCDPSession(page)
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' }); await cdp.send('Page.setWebLifecycleState', { state: 'active' })
  assert.equal(await readSession(page), 200)
  await page.reload(); await page.getByLabel('Khóa mã hóa riêng', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.fixtureSecure.secureUnlocked()), false)
  assert.equal((await browser.cookies()).find(c => c.name === before.name)?.value, before.value)
  await unlock(page); assert.equal(await readSession(page), 200) // No repeated password.
  await page.close(); page = await browser.newPage(); await page.goto(config.publicOrigin.origin)
  await unlock(page); assert.equal(await readSession(page), 200)
  await browser.close(); browser = await launch(); page = browser.pages()[0]
  await page.goto(config.publicOrigin.origin)
  assert.equal((await browser.cookies()).find(c => c.name === before.name)?.value, before.value)
  await unlock(page); assert.equal(await readSession(page), 200)
  const other = await browser.newPage(); await other.goto(config.publicOrigin.origin); await unlock(other)
  await page.evaluate(() => window.fixtureSecure.lockSecure())
  await other.getByLabel('Khóa mã hóa riêng', { exact: true }).waitFor()
  assert.equal((await browser.cookies()).find(c => c.name === before.name)?.value, before.value)
  await unlock(page)
  const rotated = { ...material, generation: random(), key: random(32) }
  await writeFile(join(root, 'key.json'), JSON.stringify(rotated), { mode: 0o600 })
  const rejected = await page.evaluate(async () => { try { await window.fixtureSecure.secureFetch('/api/session'); return false } catch { return true } })
  assert(rejected); await page.getByLabel('Khóa mã hóa riêng', { exact: true }).waitFor()
  material.generation = rotated.generation; material.key = rotated.key
  await unlock(page)
  await page.evaluate(async () => { const m=window.fixtureSecure,s=await(await m.secureFetch('/api/session')).json();const r=await m.secureFetch('/api/session/logout',{method:'POST',headers:{'X-CSRF-Token':s.csrf}});await r.arrayBuffer() })
  await other.getByLabel('Khóa mã hóa riêng', { exact: true }).waitFor()
  assert(!(await browser.cookies()).some(c => c.name === before.name))
  await browser.addCookies([{...before}]) // Replay the fixture cookie after explicit logout.
  assert.equal((await browser.request.post(config.publicOrigin.origin + '/api/secure/challenge', {headers:{Origin:config.publicOrigin.origin}})).status(),401)
  const expired=createSession(config.sessionSecret,-1,config.password).token
  await browser.addCookies([{...before,value:expired}])
  assert.equal((await browser.request.post(config.publicOrigin.origin + '/api/secure/challenge', {headers:{Origin:config.publicOrigin.origin}})).status(),401)
  assert.equal(effects,0)
  console.log(JSON.stringify({mobileViewport:'390x844 Chromium', firstPwaClaimKeepsRamKey:!legacyFirstClaim, explicitWorkerUpdateReloadsOnce:true, cookiePersistentAcrossBrowserRestart:true, backgroundResumeUnlocked:true, reloadLosesOnlyRamKey:true, closePageAndBrowserLosesOnlyRamKey:true, noPasswordRequiredWithValidCookie:true, twoTabLock:true, rotationRejectsOldKey:true, logoutReplay401:true, expiredSession401:true, nativeEffects:effects}))
} finally {
  await browser?.close(); attachments?.stop()
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
  await rm(root,{recursive:true,force:true})
}
