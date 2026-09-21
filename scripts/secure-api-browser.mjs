// Local fixture only: fake native RPC/credentials, no model turn or live config.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, cp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { build } from 'vite'
import { createRemoteHttpServer } from '../dist-server/http-app.js'
import { RemoteController } from '../dist-server/controller.js'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
import { ContextVault } from '../dist-server/context-vault.js'
import { AttachmentStore } from '../dist-server/attachments.js'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = await mkdtemp(join(tmpdir(), 'secure-browser-')), files = join(root, 'files'), dist = join(root, 'dist')
const random = (n = 24) => randomBytes(n).toString('base64url')
const material = { version: 1, app: random(), generation: random(), key: random(32) }
let browser, server, controller, attachments
const requests = [], responses = []
const activeResponses = new Set()
try {
  await mkdir(files); await cp(resolve('dist'), dist, { recursive: true })
  await writeFile(join(root, 'owner.json'), JSON.stringify(material), { mode: 0o600 })
  const note = join(files, 'private-note.txt'), content = 'PRIVATE RESOURCE CANARY\n' + 'abcdef'.repeat(24000)
  await writeFile(note, content)
  await writeFile(join(files, 'download.bin'), Buffer.alloc(2 * 1024 * 1024, 81))
  await writeFile(join(files, 'interactive.html'), '<html><body><button onclick="document.body.dataset.clicked=1">HTML canary</button><script>try{parent.document.body.dataset.escaped=1}catch{};fetch("/api/session").then(()=>document.body.dataset.network=1).catch(()=>{});</script></body></html>')
  const entry = join(root, 'harness.ts')
  await writeFile(entry, `export * from ${JSON.stringify(resolve('src/secureApi.ts'))}; export { CipherCache } from ${JSON.stringify(resolve('src/secureCache.ts'))}; export { importOwner } from ${JSON.stringify(resolve('server/secure-wire.ts'))}; export { SecureEvents } from ${JSON.stringify(resolve('src/secureEvents.ts'))};`)
  await build({ configFile: false, logLevel: 'error', build: { outDir: dist, emptyOutDir: false, minify: true, lib: { entry, formats: ['es'], fileName: () => 'secure-fixture-harness.js' } } })
  const config = { host: '127.0.0.1', port: 0, publicOrigin: new URL('http://127.0.0.1'), password: 'FAKE browser login password', sessionSecret: 'fake-browser-secret'.repeat(3), sessionTtlSeconds: 600, codexBin: 'unused', production: true, workspaceRoots: ['/tmp'], fileRoots: [files], secureApiRequired: true, secureKeyFile: join(root, 'owner.json'), sessionStateFile: join(root, 'sessions.json') }
  const app = new CodexAppServer(process.execPath, [resolve('server/fixtures/plan-questions.mjs')])
  const vault = new ContextVault(join(root, 'vault')); attachments = new AttachmentStore(join(root, 'uploads'))
  controller = new RemoteController(config, app, vault)
  server = createRemoteHttpServer(config, controller, dist, null, undefined, attachments)
  server.prependListener('request', (req, res) => {
    activeResponses.add(res); res.once('close', () => activeResponses.delete(res))
    let bytes = 0
    const write = res.write.bind(res), end = res.end.bind(res)
    res.write = (chunk, ...args) => { if (chunk) bytes += Buffer.byteLength(chunk); return write(chunk, ...args) }
    res.end = (chunk, ...args) => { if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) bytes += Buffer.byteLength(chunk); return end(chunk, ...args) }
    res.once('finish', () => responses.push({ path: req.url, bytes, status: res.statusCode }))
  })
  await controller.start(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); config.port = server.address().port; config.publicOrigin = new URL('http://127.0.0.1:' + config.port)
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ serviceWorkers: 'allow', acceptDownloads: true }), page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('request', req => { if (req.url().includes('/api/')) requests.push({ url: req.url(), body: req.postData() ?? '' }) })
  const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error(error.stack) })
  await page.goto(config.publicOrigin.origin)
  // First activation claims the page and the existing PWA handler reloads it.
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller) && performance.getEntriesByType('navigation')[0]?.type === 'reload')
  try { await page.getByRole('button', { name: 'Đăng nhập lại', exact: true }).click() }
  catch (error) { console.error(JSON.stringify({ errors, text: await page.locator('body').innerText(), setup: await page.evaluate(async () => (await fetch('/api/secure/setup')).json()) })); throw error }
  await page.getByLabel('Mật khẩu đăng nhập', { exact: true }).fill(config.password)
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
  const unlock = async target => {
    const field = target.getByLabel('Khóa mã hóa riêng', { exact: true })
    await field.waitFor(); assert.equal(await field.getAttribute('type'), 'password'); assert.equal(await field.getAttribute('autocomplete'), 'current-password')
    await field.fill(material.key); await target.getByRole('button', { name: 'Mở khóa', exact: true }).click(); await target.locator('#instruction').waitFor()
  }
  // A legacy tab appearing after the root gate must block key proof too.
  const stale = await context.newPage()
  await stale.route('**/preview/5180/late-fixture', route => route.fulfill({ contentType: 'text/html', body: '<body>Fixture old tab</body>' }))
  await stale.goto(config.publicOrigin.origin + '/preview/5180/late-fixture')
  const proofsBefore = requests.filter(r => r.url.endsWith('/api/secure/handshake')).length
  await page.getByLabel('Khóa mã hóa riêng', { exact: true }).fill(material.key)
  await page.getByRole('button', { name: 'Mở khóa', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'tab hoặc cửa sổ' }).waitFor()
  assert.equal(requests.filter(r => r.url.endsWith('/api/secure/handshake')).length, proofsBefore)
  assert.equal(await page.locator('#instruction').count(), 0)
  await stale.close()
  await unlock(page)
  const harness = async target => { await target.evaluate(async key => { const m = await import('/secure-fixture-harness.js'); await m.secureSetup(); await m.unlockSecure(key); window.fixtureSecure = m }, material.key) }
  await harness(page)
  const read = target => target.evaluate(async path => { const r = await window.fixtureSecure.secureFetch('/api/files/content?' + new URLSearchParams({ path })); return { status: r.status, body: await r.text() } }, note)
  responses.length = 0; assert.equal((await read(page)).body, content)
  const first = responses.filter(r => r.path === '/api/secure/request').reduce((sum, r) => sum + r.bytes, 0)
  await page.reload(); await page.getByLabel('Khóa mã hóa riêng', { exact: true }).waitFor(); assert.equal(await page.locator('#instruction').count(), 0)
  await unlock(page); await harness(page)
  responses.length = 0; assert.equal((await read(page)).body, content)
  const reload = responses.filter(r => r.path === '/api/secure/request').reduce((sum, r) => sum + r.bytes, 0)
  assert(reload < first / 5, `cipher cache must save bytes: ${first} -> ${reload}`)
  const stored = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('codex-remote-cipher-cache-v1'); r.onsuccess = () => resolve(r.result); r.onerror = reject })
    const rows = await new Promise(resolve => { const r = db.transaction('entries').objectStore('entries').getAll(); r.onsuccess = () => resolve(r.result) }); db.close()
    return { rows: JSON.stringify(rows), local: JSON.stringify(localStorage), total: rows.reduce((n, r) => n + r.bytes, 0), opaqueBodyIds: rows.every(row => /^[A-Za-z0-9_-]{43}$/.test(JSON.parse(atob(row.body.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))).id)) }
  })
  assert(!stored.rows.includes('PRIVATE RESOURCE CANARY')); assert(!stored.rows.includes(note)); assert(!stored.rows.includes(material.key)); assert(!stored.local.includes(material.key)); assert(stored.total <= 64 * 1024 * 1024); assert(stored.opaqueBodyIds)
  await writeFile(note, 'CHANGED CANARY'); assert.equal((await read(page)).body, 'CHANGED CANARY')
  // Exercise actual Files UI, with opaque HTML and an authenticated binary save.
  await page.evaluate(() => { const create = URL.createObjectURL.bind(URL); window.privateObjectUrls = []; URL.createObjectURL = value => { const url = create(value); window.privateObjectUrls.push(url); return url } })
  await page.getByRole('button', { name: 'Files', exact: true }).click()
  const filesDialog = page.getByRole('dialog', { name: 'Files', exact: true })
  await filesDialog.getByRole('alert').getByRole('button', { name: files, exact: true }).click()
  await filesDialog.getByRole('button', { name: /interactive.html/ }).first().click()
  const html = page.frameLocator('iframe[src="/secure-viewer"]')
  await html.getByRole('button', { name: 'HTML canary' }).click()
  assert.equal(await html.locator('body').getAttribute('data-clicked'), '1')
  assert.equal(await page.locator('body').getAttribute('data-escaped'), null)
  assert.equal(await html.locator('body').getAttribute('data-network'), null)
  assert.equal(await page.locator('iframe[src="/secure-viewer"]').getAttribute('sandbox'), 'allow-scripts')
  await page.getByRole('button', { name: 'Close file viewer', exact: true }).click()
  await filesDialog.getByRole('button', { name: /download.bin/ }).first().click()
  // Explicitly test the bounded fallback, not the browser's native file picker.
  await page.evaluate(() => { window.showSaveFilePicker = undefined })
  const downloaded = page.waitForEvent('download')
  await page.getByRole('dialog').last().getByRole('button', { name: 'Download', exact: true }).click()
  const saved = await downloaded
  assert((await readFile(await saved.path())).equals(Buffer.alloc(2 * 1024 * 1024, 81)))
  await page.getByRole('button', { name: 'Close file viewer', exact: true }).click()
  await filesDialog.getByRole('button', { name: 'Close file browser', exact: true }).click()
  await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('codex-remote-cipher-cache-v1'); r.onsuccess = () => resolve(r.result) })
    await new Promise(resolve => { const tx = db.transaction('entries', 'readwrite'), s = tx.objectStore('entries'), r = s.getAll(); r.onsuccess = () => { for (const row of r.result) s.put({ ...row, body: 'corrupt' }) }; tx.oncomplete = resolve }); db.close()
  })
  assert.equal((await read(page)).body, 'CHANGED CANARY')
  // Storage failure is optional caching failure, not loss of online content/draft.
  await writeFile(note, 'QUOTA CANARY')
  await page.evaluate(() => { window.originalCachePut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args) { if (this.name === 'entries') throw new DOMException('fixture quota', 'QuotaExceededError'); return window.originalCachePut.apply(this, args) } })
  assert.equal((await read(page)).body, 'QUOTA CANARY')
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalCachePut })
  assert.equal((await read(page)).body, 'QUOTA CANARY')
  await rm(note); assert.equal((await read(page)).status, 404)
  // Fake-native Plan request traverses the encrypted SSE and answer mutation.
  await app.request('fixture/question', { id: 'secure-plan' })
  await page.locator('.plan-question').waitFor()
  await page.locator('.plan-question').getByRole('button', { name: 'Skip', exact: true }).click()
  // A click only queues encryption/dispatch; await the authenticated acknowledgement.
  await page.locator('.plan-question').waitFor({ state: 'detached' })
  assert.equal((await app.request('fixture/replies', {})).at(-1).id, 'secure-plan')
  const upload = await page.evaluate(async () => {
    const m = window.fixtureSecure, s = await (await m.secureFetch('/api/session')).json()
    const result = await m.secureFetch('/api/attachments?name=private-upload.txt', { method: 'POST', headers: { 'content-type': 'text/plain', 'x-csrf-token': s.csrf }, body: new Blob(['FAKE PRIVATE UPLOAD CANARY']) })
    const item = await result.json()
    const deleted = await m.secureFetch('/api/attachments/' + item.id, { method: 'DELETE', headers: { 'x-csrf-token': s.csrf } }); await deleted.arrayBuffer()
    return result.status === 201 && deleted.status === 200
  }); assert(upload)
  const privateFeatures = await page.evaluate(async () => {
    const m = window.fixtureSecure, session = await (await m.secureFetch('/api/session')).json(), headers = { 'content-type': 'application/json', 'x-csrf-token': session.csrf }
    const path = 'References/Fixture-Secure.md', content = 'VAULT PRIVATE CANARY'
    const write = await m.secureFetch('/api/knowledge/note', { method: 'PUT', headers, body: JSON.stringify({ path, content, revision: '', actor: 'browser-fixture' }) })
    const saved = await write.json(), reread = await (await m.secureFetch('/api/knowledge/note?' + new URLSearchParams({ path }))).json()
    const conflict = await m.secureFetch('/api/knowledge/note', { method: 'PUT', headers, body: JSON.stringify({ path, content: 'must not replace', revision: '', actor: 'browser-fixture' }) }); await conflict.arrayBuffer()
    const team = await m.secureFetch('/api/threads/plan-fixture/orchestration'); await team.arrayBuffer()
    return { vault: write.ok && reread.content === content && saved.revision === reread.revision, conflict: conflict.status, team: team.status }
  })
  assert.deepEqual(privateFeatures, { vault: true, conflict: 409, team: 200 })
  // Real cursor replay after a broken fetch stream; no duplicate event delivery.
  await page.evaluate(async () => {
    window.reconnectedEvents = []; window.reopened = 0
    const events = new window.fixtureSecure.SecureEvents('/api/events')
    window.fixtureEvents = events
    events.onopen = () => window.reopened++
    events.onmessage = event => { const value = JSON.parse(event.data); if (value.type === 'cache-fixture') window.reconnectedEvents.push(value.payload) }
  })
  await page.waitForFunction(() => window.reopened === 1)
  controller.events.publish('cache-fixture', { number: 1 })
  await page.waitForFunction(() => window.reconnectedEvents.length === 1)
  for (const response of activeResponses) response.destroy()
  controller.events.publish('cache-fixture', { number: 2 })
  await page.waitForFunction(() => window.reopened > 1 && window.reconnectedEvents.length === 2)
  assert.deepEqual(await page.evaluate(() => window.reconnectedEvents), [{ number: 1 }, { number: 2 }])
  await page.evaluate(() => window.fixtureEvents.close())
  const cacheBounds = await page.evaluate(async key => {
    const { CipherCache, importOwner } = window.fixtureSecure, c = new CipherCache('other-fixture:generation:owner')
    await c.unlock(await importOwner(key))
    const body = new Uint8Array(4 * 1024 * 1024).fill(42)
    for (let n = 0; n < 13; n++) await c.put('record-' + n, { path: 'secret-fixture-' + n, representation: '', expires: 0, response: { status: 200, resource: 'record-' + n, headers: {}, revision: 'revision-' + n } }, body)
    const old = await c.get('record-0'), latest = await c.get('record-12')
    const wrong = new CipherCache(c.namespace); await wrong.unlock(await importOwner('AQ'.repeat(21) + 'A')); const wrongRead = await wrong.get('record-12')
    const db = await new Promise(resolve => { const r = indexedDB.open('codex-remote-cipher-cache-v1'); r.onsuccess = () => resolve(r.result) })
    const rows = await new Promise(resolve => { const r = db.transaction('entries').objectStore('entries').getAll(); r.onsuccess = () => resolve(r.result) })
    db.close(); c.lock(); wrong.lock()
    return { total: rows.reduce((n, row) => n + row.bytes, 0), lru: !old && Boolean(latest), wrongKeyDenied: wrongRead === null, otherRows: rows.filter(r => r.namespace.startsWith('other-fixture:')).length }
  }, material.key)
  assert(cacheBounds.total <= 64 * 1024 * 1024); assert(cacheBounds.lru); assert(cacheBounds.wrongKeyDenied)
  // Lock broadcasts across two unlocked tabs, without logging out or stopping jobs.
  const other = await context.newPage(); await other.goto(config.publicOrigin.origin); await unlock(other)
  await page.getByRole('button', { name: 'Khóa', exact: true }).click()
  await other.getByLabel('Khóa mã hóa riêng', { exact: true }).waitFor()
  assert.equal(await other.locator('#instruction').count(), 0)
  assert(await page.evaluate(async () => { for (const url of window.privateObjectUrls) { try { await fetch(url); return false } catch { /* revoked */ } } return window.privateObjectUrls.length > 0 }))
  await page.setViewportSize({ width: 390, height: 680 }); await unlock(page)
  await harness(page)
  const ui = await page.getByLabel('Khóa mã hóa riêng', { exact: true }).count(); assert.equal(ui, 0)
  // A generation change locks old pages, purges that app's encrypted namespace,
  // and demands a new proof before current content can be fetched again.
  const oldKey = material.key
  material.generation = random(); material.key = random(32)
  await writeFile(join(root, 'owner.json'), JSON.stringify(material))
  assert.equal(await page.evaluate(async () => { try { await window.fixtureSecure.secureFetch('/api/session'); return 200 } catch (e) { return e.status } }), 412)
  await page.getByLabel('Khóa mã hóa riêng', { exact: true }).waitFor()
  await unlock(page); await harness(page)
  await writeFile(note, content)
  responses.length = 0; assert.equal((await read(page)).body, content)
  const afterRotation = responses.filter(r => r.path === '/api/secure/request').reduce((sum, r) => sum + r.bytes, 0)
  assert(afterRotation >= first, 'new key generation must authorize and fetch current bytes')
  // Logout purges only this app's ciphertext; user drafts and other namespaces stay.
  await page.locator('#instruction').fill('KEEP MY DRAFT')
  await page.getByRole('button', { name: 'Open conversations', exact: true }).click()
  await page.getByRole('button', { name: 'App menu', exact: true }).click()
  await page.getByRole('button', { name: 'Lock app', exact: true }).click()
  await page.getByLabel('Khóa mã hóa riêng', { exact: true }).waitFor()
  await page.waitForFunction(async app => {
    const db = await new Promise(resolve => { const r = indexedDB.open('codex-remote-cipher-cache-v1'); r.onsuccess = () => resolve(r.result) })
    const rows = await new Promise(resolve => { const r = db.transaction('entries').objectStore('entries').getAll(); r.onsuccess = () => resolve(r.result) }); db.close()
    return !rows.some(r => r.namespace.startsWith(app + ':')) && rows.some(r => r.namespace.startsWith('other-fixture:'))
  }, material.app)
  assert(await page.evaluate(() => JSON.stringify(localStorage).includes('KEEP MY DRAFT')))
  assert(requests.filter(r => r.url.includes('/api/secure/request')).every(r => !r.body.includes('PRIVATE') && !r.body.includes('private-note') && !r.body.includes(material.key) && !r.body.includes(oldKey) && !r.body.includes('/api/files')))
  assert(await page.evaluate(async keys => { for (const name of await caches.keys()) { const store = await caches.open(name); for (const request of await store.keys()) { if (new URL(request.url).pathname.startsWith('/api/')) return false; const body = await (await store.match(request)).text(); if (keys.some(key => body.includes(key))) return false } } return true }, [oldKey, material.key]))
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ firstEncryptedBytes: first, revalidatedEncryptedBytes: reload, ciphertextOnlyStorage: true, reloadUnlock: true, changedBytes: true, corruptCacheRefetch: true, quotaFallback: true, cacheBounds, deletedResourceDenied: true, planSse: true, sseReconnectDedup: true, privateFeatures, htmlSandbox: true, binaryDownload: true, uploadDelete: true, multiTabLock: true, objectUrlsRevoked: true, mobileUnlock: true, rotationRequiresNewProofAndBody: true, pwaNoPrivateCache: true, logoutScopedPurge: true, draftsPreserved: true, rendererUsedJsHeapBytes: await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null), nativeModelTurns: 0, errors }))
} finally {
  await browser?.close(); controller?.stop(); attachments?.stop()
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await rm(root, { recursive: true, force: true })
}
