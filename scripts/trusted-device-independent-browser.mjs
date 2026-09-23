// Independent acceptance additions to the author's real-browser/real-router fixture.
// The generated module is owned, temporary, and removed even after a failed assertion.
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
const source = new URL('./trusted-device-browser.mjs', import.meta.url)
const temporary = new URL(`./.trust-review-${randomUUID()}.mjs`, import.meta.url)
const additions = String.raw`
  await page.close();page=await browser.newPage();await page.goto(config.publicOrigin.origin)
  await forget(page);await unlock(page,true)
  const beforeUnmount=await readRow(page)
  await page.evaluate(()=>window.unmountGate())
  assert.deepEqual(await readRow(page),beforeUnmount)
  await page.reload();await unlocked(page)

  // A successful remembered proof is insufficient: the uncached encrypted session
  // response must complete before either private UI or cache use becomes possible.
  let proofBeforeSession=0
  page.on('request',r=>{if(r.url().endsWith('/api/secure/handshake'))proofBeforeSession++})
  await page.route('**/api/secure/request',route=>route.abort('failed'))
  await page.reload();await locked(page)
  assert(proofBeforeSession>0)
  assert.equal(await page.locator('#private-ui').count(),0)
  assert.deepEqual(await readRow(page),beforeUnmount)
  await page.unroute('**/api/secure/request');await page.reload();await unlocked(page)

  // Existing unlocked page must retain its identity pin when its channel expires.
  // A new cookie cannot elicit another owner proof from that page.
  await login()
  let reconnectProofs=0
  page.on('request',r=>{if(r.url().endsWith('/api/secure/handshake'))reconnectProofs++})
  await page.route('**/api/secure/challenge',async route=>{
    await page.evaluate(()=>{Date.now=window.reviewRealClock})
    await route.continue()
  })
  const reconnect=await page.evaluate(async()=>{
    const real=Date.now.bind(Date);window.reviewRealClock=real;Date.now=()=>real()+3600000
    try{await window.fixtureSecure.secureFetch('/api/session');return 'unexpected-success'}
    catch(error){return error.message}
    finally{Date.now=real}
  })
  assert.match(reconnect,/another session or key/)
  await page.unroute('**/api/secure/challenge')
  assert.equal(reconnectProofs,0);await locked(page)
  await unlock(page,true)

  // Exact origin is authenticated metadata; corrupt origin never sends a proof.
  await page.evaluate(async()=>{
    const db=await new Promise(r=>{const q=indexedDB.open('codex-remote-trusted-device-v1',1);q.onsuccess=()=>r(q.result)})
    try{await new Promise((resolve,reject)=>{const t=db.transaction('device','readwrite'),s=t.objectStore('device'),q=s.get('current');q.onsuccess=()=>s.put({...q.result,origin:'https://unrelated.invalid'},'current');t.oncomplete=resolve;t.onerror=t.onabort=reject})}finally{db.close()}
  })
  const proofsBeforeOrigin=reconnectProofs
  await page.reload();await locked(page)
  assert.equal(reconnectProofs,proofsBeforeOrigin);assert.equal(await readRow(page),null)
  await unlock(page,true)

  // Forget cannot claim success when BOTH durable revocation mechanisms fail.
  await page.evaluate(()=>{
    const put=Storage.prototype.setItem,open=indexedDB.open.bind(indexedDB)
    window.restoreFailures=()=>{Storage.prototype.setItem=put;indexedDB.open=open}
    Storage.prototype.setItem=function(key,...rest){if(key==='codex-remote-trust-fence-v1')throw new DOMException('fixture','QuotaExceededError');return put.call(this,key,...rest)}
    indexedDB.open=(...args)=>args[0]==='codex-remote-trusted-device-v1'?{}:open(...args)
    window.fixtureSecure.lockSecure()
  })
  await locked(page);await page.getByRole('alert').waitFor()
  assert.match(await page.getByRole('alert').innerText(),/Không thể xóa/)
  assert.equal(await page.locator('#private-ui').count(),0)
  await page.evaluate(()=>window.restoreFailures())
  await page.getByRole('button',{name:'Quên thiết bị này',exact:true}).click()
  await page.waitForFunction(async()=>{
    const db=await new Promise(r=>{const q=indexedDB.open('codex-remote-trusted-device-v1',1);q.onsuccess=()=>r(q.result)})
    try{return await new Promise(r=>{const q=db.transaction('device').objectStore('device').get('current');q.onsuccess=()=>r(!q.result)})}finally{db.close()}
  })
  await page.reload();await locked(page)
  console.log(JSON.stringify({independentReview:true,unmountRetainsTrust:true,uncachedSessionRequired:true,reconnectSessionPinBeforeProof:true,originTamperBeforeProof:true,doubleStorageFailureVisible:true,forgetRetryClearsTrust:true}))
`
try {
  const original = await readFile(source, 'utf8')
  if (original.split('  assert.equal(effects,0)').length !== 2) throw Error('Fixture insertion drift')
  await writeFile(temporary, original.replace('  assert.equal(effects,0)', additions + '\n  assert.equal(effects,0)'), { flag: 'wx', mode: 0o600 })
  await import(temporary.href)
} finally { await unlink(temporary).catch(() => {}) }
