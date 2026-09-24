// Real owner gate/encrypted API/App/SW; native RPCs and credentials are fake.
// No subscription registration or OS notification is sent by this fixture.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createRemoteHttpServer } from '../dist-server/http-app.js'
import { RemoteController } from '../dist-server/controller.js'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
import { ContextVault } from '../dist-server/context-vault.js'
import { AttachmentStore } from '../dist-server/attachments.js'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/tmp/working-hours-browser/node_modules/playwright/index.mjs')
const root = await mkdtemp(join(tmpdir(), 'contextual-push-')), files = join(root, 'files')
const material = { version: 1, app: randomBytes(24).toString('base64url'), generation: randomBytes(24).toString('base64url'), key: randomBytes(32).toString('base64url') }
let browser, server, attachments
const nativeCalls = [], screenshots = process.env.PUSH_SCREENSHOTS || join(root, 'screenshots')
try {
  await mkdir(files); await mkdir(screenshots, { recursive: true })
  await writeFile(join(root, 'owner.json'), JSON.stringify(material), { mode: 0o600 })
  const config = { host: '127.0.0.1', port: 0, publicOrigin: new URL('http://127.0.0.1'), password: 'FAKE contextual push password', sessionSecret: 'fake-push-secret'.repeat(4), sessionTtlSeconds: 600, codexBin: 'UNUSED', production: true, workspaceRoots: [files], fileRoots: [files], secureApiRequired: true, secureKeyFile: join(root, 'owner.json'), sessionStateFile: join(root, 'sessions.json') }
  const makeThread = (id, name, active = false) => ({ id, name, cwd: files, createdAt: 1, updatedAt: 2, modelProvider: 'fixture', status: { type: active ? 'active' : 'idle' }, turns: [{ id: id + '-turn', status: active ? 'inProgress' : 'completed', items: [{ id: 'answer', type: 'agentMessage', text: `Fixture answer for ${name}`, phase: 'final_answer' }] }] })
  const threads = [makeThread('thread-a', 'Convo A', true), makeThread('thread-b', 'Convo B')]
  const app = new CodexAppServer('UNUSED')
  app.request = async (method, params = {}) => {
    nativeCalls.push({ method, id: params.threadId })
    if (method === 'thread/list') return { data: threads, nextCursor: null }
    if (method === 'thread/read' || method === 'thread/resume') {
      const thread = threads.find(t => t.id === params.threadId)
      if (!thread) throw new Error('Fixture thread does not exist')
      return { thread }
    }
    if (method === 'model/list') return { data: [] }
    if (method === 'account/rateLimits/read') return { rateLimits: {} }
    throw new Error('Unexpected native method: ' + method)
  }
  const vault = new ContextVault(join(root, 'vault'))
  const group = vault.createGroup('Fixture group').groups[0]
  for (const thread of threads) vault.assignThread(thread.id, group.id)
  vault.setLeader(group.id, 'thread-a')
  const controller = new RemoteController(config, app, vault)
  attachments = new AttachmentStore(join(root, 'uploads'))
  server = createRemoteHttpServer(config, controller, resolve('dist'), null, undefined, attachments)
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  config.port = server.address().port; config.publicOrigin = new URL(`http://127.0.0.1:${config.port}`)
  browser = await chromium.launch({ headless: true })
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'allow' })
    const page = await context.newPage(); page.setDefaultTimeout(12000)
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    const login = async () => assert.equal((await context.request.post(config.publicOrigin.origin + '/api/session/login', { headers: { Origin: config.publicOrigin.origin }, data: { password: config.password } })).status(), 200)
    const unlock = async () => {
      await page.getByLabel('Khóa mã hóa riêng', { exact: true }).fill(material.key)
      await page.getByRole('button', { name: 'Mở khóa', exact: true }).click()
      await page.locator('#instruction').waitFor()
    }
    const title = value => page.waitForFunction(name => document.querySelector('.workspace-title h1')?.textContent === name, value)
    await login()
    const before = nativeCalls.length
    await page.goto(config.publicOrigin.origin + '/#thread=thread-b')
    await page.getByLabel('Khóa mã hóa riêng', { exact: true }).waitFor()
    assert.equal(nativeCalls.length, before, 'Locked target does not invoke native RPCs')
    await unlock(); await title('Convo B')
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
    const worker = context.serviceWorkers().find(w => new URL(w.url()).pathname === '/sw.js')
    assert(worker)
    // Synthetic events have no OS notification activation. Stub only the
    // privileged focus operation; matchAll/postMessage/ACK and app routing stay
    // real. Any fallback openWindow remains an error in this existing-app test.
    await worker.evaluate(() => { WindowClient.prototype.focus = async function () { return this } })
    // Exercise actual SW formatting without an OS alert or a real subscription.
    const display = await worker.evaluate(async () => {
      const originalShow = self.registration.showNotification.bind(self.registration)
      const originalClients = self.clients.matchAll.bind(self.clients)
      const shown = []
      self.registration.showNotification = async (title, options) => { shown.push({ title, body: options.body, threadId: options.data.threadId }) }
      self.clients.matchAll = async () => []
      try {
        for (const isLeader of [true, false]) {
          let task
          const event = new Event('push')
          Object.assign(event, { data: { json: () => ({ body: 'Đã sửa xong. Kết quả kiểm tra đạt.', notification: { threadId: 'thread-b', threadName: 'Convo B', groupName: 'Fixture group', isLeader } }) }, waitUntil(promise) { task = promise } })
          self.dispatchEvent(event); await task
        }
        return shown
      } finally { self.registration.showNotification = originalShow; self.clients.matchAll = originalClients }
    })
    assert.deepEqual(display, [true, false].map(() => ({ title: 'Convo B', body: 'Đã sửa xong. Kết quả kiểm tra đạt.', threadId: 'thread-b' })))
    const click = async threadId => worker.evaluate(async id => {
      let task
      const event = new Event('notificationclick')
      Object.assign(event, { notification: { close() {}, data: { threadId: id } }, waitUntil(promise) { task = promise } })
      self.dispatchEvent(event); await task
    }, threadId)
    let navigations = 0
    page.on('load', () => { navigations++ })
    const documentMarker = await page.evaluate(() => (window.__pushFixtureDocument = crypto.randomUUID()))
    await page.locator('#instruction').fill('Draft B survives notification')
    await click('thread-a'); await title('Convo A')
    assert.equal(await page.locator('#instruction').inputValue(), '')
    await page.locator('#instruction').fill('Draft A while running')
    await click('thread-b'); await title('Convo B')
    assert.equal(await page.locator('#instruction').inputValue(), 'Draft B survives notification')
    await click('thread-a'); await title('Convo A')
    assert.equal(await page.locator('#instruction').inputValue(), 'Draft A while running')
    assert.equal(navigations, 0, 'SW click routes in place without reload')
    assert.equal(await page.evaluate(() => window.__pushFixtureDocument), documentMarker)
    assert.equal(context.pages().length, 1)
    await click('missing-thread')
    await page.getByText('Cuộc hội thoại trong thông báo không còn khả dụng.', { exact: false }).waitFor()
    await title('Convo A')
    assert.equal(await page.locator('#instruction').inputValue(), 'Draft A while running')
    // Reload clears only the RAM key; the SW remains able to store a pending tap.
    await page.reload(); await page.getByLabel('Khóa mã hóa riêng', { exact: true }).waitFor()
    const lockedBefore = nativeCalls.length
    await click('thread-b')
    await page.waitForFunction(() => location.hash === '#thread=thread-b')
    assert.equal(nativeCalls.length, lockedBefore)
    await unlock(); await title('Convo B')
    await page.screenshot({ path: join(screenshots, `push-thread-${viewport.width}.png`) })
    assert.equal(errors.length, 0, JSON.stringify(errors))
    assert(nativeCalls.every(call => !['turn/start', 'thread/start', 'turn/interrupt'].includes(call.method)))
    await context.close()
  }
  console.log(JSON.stringify({ passed: true, viewports: [1280, 390], coldTargetAfterUnlock: true, lockedClickDeferred: true, encryptedThreadApi: true, inPlaceRouting: true, draftsPreserved: true, activeTurnNotInterrupted: true, missingTargetFallback: true, realPushSent: false, realModelTurns: 0, physicalIOS: false, screenshots }))
} finally {
  await browser?.close(); attachments?.stop()
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await rm(root, { recursive: true, force: true })
}
