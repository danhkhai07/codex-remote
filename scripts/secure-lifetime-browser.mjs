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
import { AttachmentStore } from '../dist-server/attachments.js'
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
import {CipherCache} from ${modulePath('src/secureCache.ts')};
import {downloadSecureFile} from ${modulePath('src/SecureFiles.tsx')};
import {importOwner} from ${modulePath('server/secure-wire.ts')};
window.fixtureSecure={...secure,CipherCache,downloadSecureFile,importOwner};
const root=createRoot(document.getElementById('root'));
window.unmountGate=()=>root.unmount();
root.render(React.createElement(SecureGate,null,React.createElement('div',{id:'private-ui'},React.createElement('p',null,'Private content authorized'),React.createElement('button',{onClick:()=>secure.lockSecure()},'Fixture lock'))));`)
  await build({ configFile: false, logLevel: 'error', define: { 'process.env.NODE_ENV': JSON.stringify('production') }, build: { outDir: dist, emptyOutDir: false, lib: { entry, formats: ['es'], fileName: () => 'lifetime.js' } } })
  await writeFile(join(dist, 'index.html'), '<html><body><div id="root"></div><script type="module" src="/lifetime.js"></script></body></html>')
  const config = { host: '127.0.0.1', port: 0, publicOrigin: new URL('http://127.0.0.1'), password: 'FAKE lifetime password', sessionSecret: 'fake-lifetime-secret'.repeat(3), sessionTtlSeconds: 600, codexBin: 'UNUSED', production: true, workspaceRoots: [files], fileRoots: [files], secureApiRequired: true, secureKeyFile: join(root, 'key.json'), sessionStateFile: join(root, 'sessions.json') }
  const controller = new RemoteController(config, new CodexAppServer('UNUSED'))
  attachments = new AttachmentStore(join(root, 'uploads'))
  const add = attachments.add.bind(attachments); attachments.add = (...args) => { effects++; return add(...args) }
  server = createRemoteHttpServer(config, controller, dist, null, undefined, attachments)
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); config.port = server.address().port; config.publicOrigin = new URL('http://127.0.0.1:' + config.port)
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext(), a = await context.newPage(), b = await context.newPage(), errors = []
  for (const page of [a,b]) { page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message)) }
  assert.equal((await context.request.post(config.publicOrigin.origin + '/api/session/login', { headers: { Origin: config.publicOrigin.origin }, data: { password: config.password } })).status(), 200)
  await a.goto(config.publicOrigin.origin); await b.goto(config.publicOrigin.origin)
  const unlock = async page => { await page.getByLabel('Khóa mã hóa riêng', { exact: true }).fill(material.key); await page.getByRole('button', { name: 'Mở khóa', exact: true }).click(); await page.locator('#private-ui').waitFor() }
  const settle = page => page.evaluate(() => new Promise(resolve => setTimeout(resolve, 60)))
  for (const stage of ['setup', 'proof']) {
    await unlock(a)
    let release, entered
    const gate = new Promise(r => { release = r }), at = new Promise(r => { entered = r })
    const endpoint = stage === 'setup' ? 'setup' : 'handshake'
    let held = false
    const route = async route => { if (held) return route.continue(); held = true; const response = await route.fetch(); entered(); await gate; await route.fulfill({ response }) }
    await b.route('**/api/secure/' + endpoint, route)
    await b.getByLabel('Khóa mã hóa riêng', { exact: true }).fill(material.key)
    await b.getByRole('button', { name: 'Mở khóa', exact: true }).click(); await at
    await a.getByRole('button', { name: 'Fixture lock', exact: true }).click()
    await b.waitForFunction(() => !window.fixtureSecure.secureUnlocked() && !document.querySelector('#unlock-key')?.disabled)
    if (stage === 'proof') await unlock(b) // New proof while old proof response is held.
    const delivered = b.waitForResponse(r => r.url().endsWith('/api/secure/' + endpoint))
    release(); await delivered; await settle(b)
    assert.equal(await b.locator('#private-ui').count(), stage === 'proof' ? 1 : 0)
    assert.equal(await b.evaluate(() => window.fixtureSecure.secureUnlocked()), stage === 'proof')
    await b.unroute('**/api/secure/' + endpoint, route)
    if (stage === 'proof') { await b.getByRole('button', { name: 'Fixture lock', exact: true }).click(); await settle(a) }
  }
  // Same gate with a delayed migration barrier, invalidated by unmount.
  await b.evaluate(key => {
    const m = window.fixtureSecure
    m.installMigrationReady(() => new Promise(resolve => { window.releaseMigration = resolve }))
    window.oldUnlock = m.unlockSecure(key).then(() => 'BAD', () => 'cancelled')
  }, material.key)
  await b.waitForFunction(() => Boolean(window.releaseMigration)); await b.evaluate(() => window.unmountGate())
  assert.equal(await b.evaluate(async () => { window.releaseMigration(); return window.oldUnlock }), 'cancelled')
  await b.reload(); await unlock(b)
  const session = await b.evaluate(async () => (await (await window.fixtureSecure.secureFetch('/api/session')).json()))
  // Pending mutation identity lookup cannot adopt a new unlock.
  await b.evaluate(csrf => {
    const m = window.fixtureSecure, original = m.CipherCache.prototype.identify
    m.CipherCache.prototype.identify = async function (...args) { m.CipherCache.prototype.identify = original; await new Promise(r => { window.releaseIdentify = r }); return original.apply(this,args) }
    window.oldMutation = m.secureFetch('/api/attachments?name=old.txt', { method: 'POST', headers: { 'x-csrf-token': csrf }, body: 'OLD INTENT' }).then(() => 'BAD', () => 'cancelled')
  }, session.csrf)
  await b.waitForFunction(() => Boolean(window.releaseIdentify)); await b.getByRole('button', { name: 'Fixture lock', exact: true }).click(); await unlock(b)
  assert.equal(await b.evaluate(async () => { window.releaseIdentify(); return window.oldMutation }), 'cancelled'); assert.equal(effects,0)
  const beforePicker = []
  b.on('request', req => { if (req.url().endsWith('/api/secure/request')) beforePicker.push(req) })
  await b.evaluate(path => {
    window.writes = 0
    window.showSaveFilePicker = () => new Promise(resolve => { window.releasePicker = () => resolve({ createWritable() { window.writes++; return Promise.resolve(new WritableStream()) } }) })
    window.oldDownload = window.fixtureSecure.downloadSecureFile(path, 'note.txt', 23).then(() => 'BAD', () => 'cancelled')
  }, note)
  await b.waitForFunction(() => Boolean(window.releasePicker)); await b.getByRole('button', { name: 'Fixture lock', exact: true }).click(); await unlock(b)
  const dispatched = beforePicker.length
  assert.equal(await b.evaluate(async () => { window.releasePicker(); return window.oldDownload }), 'cancelled')
  assert.equal(beforePicker.length, dispatched); assert.equal(await b.evaluate(() => window.writes),0)
  // Writable handle delayed after an authorized GET cannot receive late bytes.
  await b.evaluate(path => {
    window.abortedSink = false; window.writes = 0
    window.showSaveFilePicker = async () => ({ createWritable: () => new Promise(resolve => { window.releaseWritable = () => resolve(new WritableStream({ write() { window.writes++ }, abort() { window.abortedSink = true } })) }) })
    window.oldDownload = window.fixtureSecure.downloadSecureFile(path, 'note.txt', 23).then(() => 'BAD', () => 'cancelled')
  }, note)
  await b.waitForFunction(() => Boolean(window.releaseWritable)); await b.getByRole('button', { name: 'Fixture lock', exact: true }).click(); await unlock(b)
  assert.equal(await b.evaluate(async () => { window.releaseWritable(); return window.oldDownload }), 'cancelled')
  assert.equal(await b.evaluate(() => window.writes),0); assert.equal(await b.evaluate(() => window.abortedSink),true)
  // Real IDB corruption: reject accounting, no getAll, bounded cursor pruning.
  const cache = await b.evaluate(async key => {
    const {CipherCache, importOwner} = window.fixtureSecure, c = new CipherCache('lifetime-cache:gen:owner')
    await c.unlock(await importOwner(key))
    const meta = id => ({ path: '/private/' + id, representation: '', expires: 0, response: { resource: id, revision: id, status: 200, headers: {} } })
    await c.put('good',meta('good'),new Uint8Array([1,2,3]))
    const db = await new Promise(resolve => { const r=indexedDB.open('codex-remote-cipher-cache-v1');r.onsuccess=()=>resolve(r.result) })
    const tx = db.transaction('entries','readwrite'), store=tx.objectStore('entries'), request=store.get(c.namespace+':good')
    request.onsuccess=()=>{ for(const [i,bytes] of [-1,NaN,Infinity,0,0.5,Number.MAX_SAFE_INTEGER].entries())store.put({...request.result,id:c.namespace+':bad-'+i,bytes}) }
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=reject})
    const original=IDBObjectStore.prototype.getAll;let getAll=0
    IDBObjectStore.prototype.getAll=function(){getAll++;throw Error('Unbounded cache read forbidden')}
    try {
      for(let i=0;i<6;i++)assertNull(await c.get('bad-'+i))
      await c.put('next',meta('next'),new Uint8Array([4,5,6]));await c.purgeOtherGenerations()
      const rows=await new Promise(resolve=>{const r=db.transaction('entries').objectStore('entries').openCursor(),rows=[];r.onsuccess=()=>{if(!r.result)return resolve(rows);rows.push({id:r.result.value.id,bytes:r.result.value.bytes});r.result.continue()}})
      if(rows.some(r=>r.id.includes(':bad-')))throw Error('Corrupt accounting retained')
      await c.purgeApp();return {getAll,rows:rows.length,bytes:rows.reduce((n,r)=>n+r.bytes,0)}
    } finally { IDBObjectStore.prototype.getAll=original;db.close();c.lock() }
    function assertNull(value){if(value!==null)throw Error('Corrupt cache accepted')}
  },material.key)
  assert.equal(cache.getAll,0);assert(cache.bytes<=64*1024*1024)
  // Normal control still uploads exactly once after a fresh explicit intent.
  const normal=await b.evaluate(async csrf=>{const r=await window.fixtureSecure.secureFetch('/api/attachments?name=normal.txt',{method:'POST',headers:{'x-csrf-token':csrf},body:'NORMAL INTENT'});await r.arrayBuffer();return r.status},session.csrf)
  assert.equal(normal,201);assert.equal(effects,1);assert.deepEqual(errors,[])
  console.log(JSON.stringify({realGateTwoTabs:true,delayedSetupLock:true,delayedProofNewUnlock:true,migrationUnmount:true,mutationIdentityCancelled:true,pickerCancelled:true,writableCancelled:true,cache,normalMutationEffects:effects,errors}))
} finally {
  await browser?.close(); attachments?.stop()
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
  await rm(root,{recursive:true,force:true})
}
