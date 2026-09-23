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
const legacyFirstClaim = false
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
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
import ${modulePath('src/styles.css')};
import * as secure from ${modulePath('src/secureApi.ts')};
import {installControllerReload} from ${modulePath('src/pwaController.ts')};
${legacyFirstClaim ? `let refreshing=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(refreshing)return;refreshing=true;window.location.reload()});` : `installControllerReload(navigator.serviceWorker,()=>window.location.reload());`}
import {CipherCache} from ${modulePath('src/secureCache.ts')};
import {downloadSecureFile} from ${modulePath('src/SecureFiles.tsx')};
import {importOwner} from ${modulePath('server/secure-wire.ts')};
window.fixtureSecure={...secure,CipherCache,downloadSecureFile,importOwner};
import * as trust from ${modulePath('src/trustedDevice.ts')};
window.fixtureTrust=trust;
const root=createRoot(document.getElementById('root'));
window.unmountGate=()=>root.unmount();
root.render(React.createElement(SecureGate,null,React.createElement('p',{id:'private-ui'},'Private content authorized')));`)
  await build({ configFile: false, logLevel: 'error', define: { 'process.env.NODE_ENV': JSON.stringify('production') }, build: { outDir: dist, emptyOutDir: false, lib: { entry, formats: ['es'], fileName: () => 'lifetime.js', cssFileName: 'lifetime' } } })
  await writeFile(join(dist, 'index.html'), '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/lifetime.css"></head><body><div id="root"></div><script type="module" src="/lifetime.js"></script></body></html>')
  const config = { host: '127.0.0.1', port: 0, publicOrigin: new URL('http://127.0.0.1'), password: 'FAKE lifetime password', sessionSecret: 'fake-lifetime-secret'.repeat(3), sessionTtlSeconds: 30*86400, codexBin: 'UNUSED', production: true, workspaceRoots: [files], fileRoots: [files], secureApiRequired: true, secureKeyFile: join(root, 'key.json'), sessionStateFile: join(root, 'sessions.json') }
  const controller = new RemoteController(config, new CodexAppServer('UNUSED'))
  attachments = new AttachmentStore(join(root, 'uploads'))
  const add = attachments.add.bind(attachments); attachments.add = (...args) => { effects++; return add(...args) }
  server = createRemoteHttpServer(config, controller, dist, null, undefined, attachments)
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); config.port = server.address().port; config.publicOrigin = new URL('http://127.0.0.1:' + config.port)
  const engine = process.env.TRUST_BROWSER === 'webkit' ? webkit : chromium
  const profile = join(root, 'profile')
  const launch = async () => {const context=await engine.launchPersistentContext(profile, { headless: true, viewport: { width: 390, height: 844 }, isMobile: true });await context.newPage();return context}
  browser = await launch()
  let page = browser.pages()[0]
  page.setDefaultTimeout(15000)
  const login = async () => {
    const r=await browser.request.post(config.publicOrigin.origin+'/api/session/login',{headers:{Origin:config.publicOrigin.origin},data:{password:config.password}})
    assert.equal(r.status(),200)
  }
  const unlocked = target => target.locator('#private-ui').waitFor()
  const locked = target => target.getByLabel('Khóa mã hóa riêng',{exact:true}).waitFor()
  const unlock = async (target, remember = false) => {
    await locked(target)
    await target.getByRole('checkbox').setChecked(remember)
    await target.getByLabel('Khóa mã hóa riêng',{exact:true}).fill(material.key)
    await target.getByRole('button',{name:'Mở khóa',exact:true}).click()
    await unlocked(target)
  }
  const readRow = target => target.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('codex-remote-trusted-device-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('device');r.onsuccess=()=>resolve(r.result);r.onerror=reject})
    try{return await new Promise((resolve,reject)=>{const r=db.transaction('device').objectStore('device').get('current');r.onsuccess=()=>{const x=r.result;resolve(x?{id:x.id,created:x.created,expires:x.expires,extractable:x.owner.extractable,type:x.owner.algorithm.name,binding:x.binding,origin:x.origin,signatureBytes:x.signature?.length}:null)};r.onerror=reject})}finally{db.close()}
  })
  const mutate = (target, kind) => target.evaluate(async kind=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('codex-remote-trusted-device-v1',1);r.onsuccess=()=>resolve(r.result)})
    try{await new Promise((resolve,reject)=>{const tx=db.transaction('device','readwrite'),store=tx.objectStore('device'),r=store.get('current');r.onsuccess=()=>{
      const row=r.result
      if(kind==='ttl')row.expires+=1000
      if(kind==='binding')row.binding='A'.repeat(43)
      if(kind==='signature')row.signature=new Uint8Array(32)
      store.put(row,'current')
    };tx.oncomplete=resolve;tx.onerror=tx.onabort=reject})}finally{db.close()}
  },kind)
  const forget = async target => {await target.evaluate(()=>window.fixtureSecure.lockSecure());await locked(target)}
  await login();await page.goto(config.publicOrigin.origin);await locked(page)
  assert.equal(await page.getByRole('checkbox').isChecked(),false)
  if(process.env.TRUST_SCREENSHOTS){await mkdir(process.env.TRUST_SCREENSHOTS,{recursive:true,mode:0o700});await page.screenshot({path:join(process.env.TRUST_SCREENSHOTS,(engine===webkit?'webkit':'chromium')+'-390.png'),fullPage:true});await page.setViewportSize({width:1280,height:900});await page.screenshot({path:join(process.env.TRUST_SCREENSHOTS,(engine===webkit?'webkit':'chromium')+'-1280.png'),fullPage:true});await page.setViewportSize({width:390,height:844})}
  await unlock(page);assert.equal(await readRow(page),null)
  await page.reload();await locked(page) // Default-off never stores a key.
  await unlock(page,true)
  const initial=await readRow(page)
  assert.equal(initial.extractable,false);assert.equal(initial.type,'HKDF');assert.equal(initial.signatureBytes,32)
  assert(initial.expires-initial.created<=7*86400000 && initial.expires-initial.created>7*86400000-5000)
  assert.equal(initial.origin,config.publicOrigin.origin)
  const stored = await page.evaluate(()=>({local:Object.entries(localStorage),session:Object.entries(sessionStorage)}))
  assert(!JSON.stringify(stored).includes(material.key));assert(!JSON.stringify(stored).includes(config.password))
  await page.reload();await unlocked(page);assert.deepEqual(await readRow(page),initial)
  await page.close();page=await browser.newPage();await page.goto(config.publicOrigin.origin);await unlocked(page)
  await browser.close();browser=await launch();page=browser.pages()[0];await page.goto(config.publicOrigin.origin);await unlocked(page)
  assert.deepEqual(await readRow(page),initial) // No sliding renewal across any kind of reopen.
  if(engine===chromium){const cdp=await browser.newCDPSession(page);await cdp.send('Page.setWebLifecycleState',{state:'frozen'});await cdp.send('Page.setWebLifecycleState',{state:'active'});await unlocked(page)}
  // Network loss after reading trust must keep UI closed without deleting a valid opt-in.
  await page.route('**/api/secure/handshake',route=>route.abort('failed'))
  await page.reload();await locked(page);assert.deepEqual(await readRow(page),initial)
  await page.unroute('**/api/secure/handshake');await page.reload();await unlocked(page)
  const other=await browser.newPage();await other.goto(config.publicOrigin.origin);await unlocked(other)
  await forget(page);await locked(other);await page.reload();await locked(page)
  assert.equal(await readRow(page),null)
  // Fresh cookie session cannot use remembered owner capability, even with same password/key.
  await unlock(page,true);let handshakes=0
  page.on('request',request=>{if(request.url().endsWith('/api/secure/handshake'))handshakes++})
  await login();handshakes=0;await page.reload();await locked(page)
  assert.equal(handshakes,0);assert.equal(await readRow(page),null)
  // Revocation with a replayed cookie remains denied after cold reload.
  await unlock(page,true);const cookie=(await browser.cookies()).find(x=>x.name==='codex_remote_session')
  await page.evaluate(async()=>{const m=window.fixtureSecure,s=await(await m.secureFetch('/api/session')).json();const r=await m.secureFetch('/api/session/logout',{method:'POST',headers:{'X-CSRF-Token':s.csrf}});await r.arrayBuffer()})
  await locked(page);await locked(other)
  await browser.addCookies([cookie]);await page.reload();await locked(page)
  assert.equal((await browser.request.post(config.publicOrigin.origin+'/api/secure/challenge',{headers:{Origin:config.publicOrigin.origin}})).status(),401)
  await login();await unlock(page,true)
  // Validly signed remembered row expires without changing/forging its metadata.
  await page.addInitScript(()=>{const real=Date.now.bind(Date);Date.now=()=>real()+8*86400000})
  await page.reload();await locked(page);assert.equal(await readRow(page),null)
  await page.close();page=await browser.newPage();await page.goto(config.publicOrigin.origin);await unlock(page,true)
  // Cookie TTL caps the remembered deadline even when it is much shorter than seven days.
  const short=createSession(config.sessionSecret,60,config.password)
  await browser.addCookies([{...cookie,value:short.token}]);await forget(page);await unlock(page,true)
  assert.equal((await readRow(page)).expires,short.payload.expiresAt*1000)
  await login();await forget(page);await unlock(page,true)
  for(const kind of ['ttl','binding','signature']){
    await mutate(page,kind);await page.reload();await locked(page);assert.equal(await readRow(page),null);await unlock(page,true)
  }
  // Generation rotation discards remembered capability before any owner proof.
  const next={...material,generation:random(),key:random(32)}
  await writeFile(join(root,'key.json'),JSON.stringify(next),{mode:0o600})
  handshakes=0;page.on('request',request=>{if(request.url().endsWith('/api/secure/handshake'))handshakes++})
  await page.reload();await locked(page);assert.equal(handshakes,0);assert.equal(await readRow(page),null)
  Object.assign(material,next);await unlock(page,true)
  // Blocked IDB fails closed on restore, never mounts private content.
  await page.close();page=await browser.newPage()
  await page.addInitScript(()=>{const original=indexedDB.open.bind(indexedDB);indexedDB.open=(...args)=>args[0]==='codex-remote-trusted-device-v1'?{}:original(...args)})
  await page.goto(config.publicOrigin.origin);await locked(page);assert.equal(await page.locator('#private-ui').count(),0)
  await page.close();page=await browser.newPage();await page.goto(config.publicOrigin.origin);await unlocked(page)
  // Save quota failure cannot report a remembered/ready state; default-off still works online.
  await forget(page)
  await page.evaluate(()=>{const original=IDBObjectStore.prototype.put;window.restorePut=()=>IDBObjectStore.prototype.put=original;IDBObjectStore.prototype.put=function(...args){if(this.name==='device')throw new DOMException('fixture quota','QuotaExceededError');return original.apply(this,args)}})
  await page.getByRole('checkbox').check();await page.getByLabel('Khóa mã hóa riêng',{exact:true}).fill(material.key);await page.getByRole('button',{name:'Mở khóa',exact:true}).click()
  await page.getByRole('alert').waitFor();assert.equal(await page.locator('#private-ui').count(),0)
  await page.evaluate(()=>window.restorePut());await unlock(page,false)
  // Failure between durable key write and active-pointer publication leaves no usable trust.
  await forget(page)
  await page.evaluate(()=>{const original=Storage.prototype.setItem;window.restoreStorage=()=>Storage.prototype.setItem=original;Storage.prototype.setItem=function(key,...args){if(key==='codex-remote-trust-active-v1')throw new DOMException('fixture publication failure','QuotaExceededError');return original.call(this,key,...args)}})
  await page.getByRole('checkbox').check();await page.getByLabel('Khóa mã hóa riêng',{exact:true}).fill(material.key);await page.getByRole('button',{name:'Mở khóa',exact:true}).click()
  await page.getByRole('alert').waitFor();assert.equal(await page.locator('#private-ui').count(),0)
  await page.evaluate(()=>window.restoreStorage());await page.reload();await locked(page);assert.equal(await readRow(page),null)
  // Lock during delayed restore proof cannot restore stale UI; subsequent manual unlock is independent.
  await forget(page);await unlock(page,true);await other.reload();await unlocked(other)
  let release,entered
  const held=new Promise(r=>{release=r}),at=new Promise(r=>{entered=r});let delayed=false
  await page.route('**/api/secure/handshake',async route=>{if(delayed)return route.continue();delayed=true;const response=await route.fetch();entered();await held;await route.fulfill({response})})
  await page.reload();await at;await forget(other);release();await locked(page)
  assert.equal(await page.locator('#private-ui').count(),0);await page.unroute('**/api/secure/handshake')
  await unlock(page,true);await page.reload();await unlocked(page)
  // A pending remembered save cannot resurrect after Lock or damage a newer unlock.
  await forget(page);await other.reload();await locked(other)
  await page.evaluate(()=>{
    const original=indexedDB.open.bind(indexedDB);let held=false
    indexedDB.open=(...args)=>{
      const request=original(...args)
      if(args[0]!=='codex-remote-trusted-device-v1'||held)return request
      held=true
      const proxy={get result(){return request.result}}
      for(const name of ['onerror','onblocked','onupgradeneeded'])Object.defineProperty(proxy,name,{set(fn){request[name]=fn}})
      Object.defineProperty(proxy,'onsuccess',{set(fn){request.onsuccess=()=>{window.releaseSave=()=>fn()}}})
      return proxy
    }
  })
  await page.getByRole('checkbox').check();await page.getByLabel('Khóa mã hóa riêng',{exact:true}).fill(material.key);await page.getByRole('button',{name:'Mở khóa',exact:true}).click()
  await page.waitForFunction(()=>Boolean(window.releaseSave));await forget(other);await locked(page)
  await unlock(page,true);const newer=await readRow(page)
  await page.evaluate(()=>window.releaseSave());await page.evaluate(()=>new Promise(r=>setTimeout(r,80)))
  await unlocked(page);assert.equal((await readRow(page)).id,newer.id)
  // Expiry while the page stays alive invalidates private reads, not just future reloads.
  await page.evaluate(async()=>{const real=Date.now.bind(Date);Date.now=()=>real()+8*86400000;try{await window.fixtureSecure.secureFetch('/api/session');throw Error('BAD expiry')}catch(error){if(error.message==='BAD expiry')throw error}})
  await locked(page);await page.close();page=await browser.newPage();await page.goto(config.publicOrigin.origin);await unlock(page,true)
  await other.close()
  // Simulate process loss after the durable fence, before blocked key deletion completes.
  await page.evaluate(()=>{const original=indexedDB.open.bind(indexedDB);indexedDB.open=(...args)=>args[0]==='codex-remote-trusted-device-v1'?{}:original(...args);window.fixtureSecure.lockSecure()})
  await page.close();await browser.close();browser=await launch();page=browser.pages()[0]
  await page.goto(config.publicOrigin.origin);await locked(page);assert.equal(await readRow(page),null)
  // Unavailable localStorage may not resurrect an old record; RAM-only explicit unlock still works.
  await unlock(page,true);await page.close();page=await browser.newPage()
  await page.addInitScript(()=>{const original=Storage.prototype.getItem;Storage.prototype.getItem=function(key){if(key==='codex-remote-trust-fence-v1')throw new DOMException('fixture unavailable','SecurityError');return original.call(this,key)}})
  await page.goto(config.publicOrigin.origin);await locked(page);assert.equal(await page.locator('#private-ui').count(),0)
  await unlock(page,false);await unlocked(page)
  assert.equal(effects,0)
  console.log(JSON.stringify({engine:engine===webkit?'WebKit':'Chromium',viewport:'390x844',defaultOff:true,reloadTabAndBrowserRestore:true,nonextractableHkdf:true,noSliding:true, transientOfflineRetainsTrust:true,sevenDayAndSessionCap:true,sessionChangeBeforeProof:true,logoutReplay401:true,expiry:true,corruptionRejected:true,generationRotationBeforeProof:true,blockedStorageClosed:true,quotaFailureClosed:true, unpublishedCapabilityClosed:true,twoTabLock:true,lateRestoreLock:true, lateSaveNewUnlock:true, liveExpiry:true, crashFence:true, unavailableStorageClosed:true,nativeEffects:effects}))
} finally {
  await browser?.close();attachments?.stop()
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
  await rm(root,{recursive:true,force:true})
}
