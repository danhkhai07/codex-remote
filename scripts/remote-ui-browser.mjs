import { historyFixtureConfig } from '../server/fixtures/history-store.mjs'
// Isolated fake-native fixture: actual client, SecureGate, crypto and SessionRegistry.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createRemoteHttpServer } from '../dist-server/http-app.js'
import { RemoteController } from '../dist-server/controller.js'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
import { ContextVault } from '../dist-server/context-vault.js'
const engines = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = await mkdtemp(join(tmpdir(), 'remote-ui-')), output = process.env.UI_EVIDENCE || root
const material = { version: 1, app: randomBytes(24).toString('base64url'), generation: randomBytes(24).toString('base64url'), key: randomBytes(32).toString('base64url') }
let controller, server, menuServer, browser
let loginRelease, loginEntered
const writes = []
const results = []
try {
  await mkdir(join(root, 'files')); await mkdir(output, { recursive: true })
  await writeFile(join(root, 'owner.json'), JSON.stringify(material), { mode: 0o600 })
  const config = { ...historyFixtureConfig(), host: '127.0.0.1', port: 0, publicOrigin: new URL('http://127.0.0.1'), password: 'FAKE browser password', sessionSecret: 'fake-ui-secret'.repeat(5), sessionTtlSeconds: 600, production: true, workspaceRoots: ['/tmp'], fileRoots: [join(root, 'files')], secureApiRequired: true, secureKeyFile: join(root, 'owner.json'), sessionStateFile: join(root, 'sessions.json') }
  const app = new CodexAppServer(process.execPath, [resolve('server/fixtures/plan-questions.mjs')])
  controller = new RemoteController(config, app, new ContextVault(join(root, 'vault')))
  const realServer = createRemoteHttpServer(config, controller, resolve(process.env.CLIENT_DIST || 'dist'), null)
  server = createServer((req, res) => {
    if (req.url === '/api/session/login' && loginEntered) { loginEntered(); const held = loginRelease; held.then(() => realServer.emit('request', req, res)); return }
    realServer.emit('request', req, res)
  })
  server.on('close', () => realServer.emit('close'))
  server.on('upgrade', (...args) => realServer.emit('upgrade', ...args))
  await controller.start(); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  config.port = server.address().port; config.publicOrigin = new URL(`http://127.0.0.1:${config.port}`)
  const clientRoot = resolve(process.env.CLIENT_DIST || 'dist')
  const thread = id => ({ id, name: id === 'a' ? 'First fixture' : 'Second fixture', cwd: '/tmp', createdAt: 1, updatedAt: 1, status: { type: 'idle' }, turns: [] })
  menuServer = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://fixture').pathname
    if (path.startsWith('/api/')) {
      if (req.method !== 'GET') writes.push(path)
      let data = {}
      if (path === '/api/secure/setup') data = { version: 1, required: false }
      else if (path === '/api/session') data = { csrf: 'fixture', expiresAt: 9999999999, workspaces: [{ id: '0', label: 'Fixture', path: '/tmp' }] }
      else if (path === '/api/threads') data = { data: [thread('a'), thread('b')] }
      else if (path === '/api/models') data = { data: [{ id: 'fixture', model: 'fixture', isDefault: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: [] }] }
      else if (path === '/api/pending') data = { data: [], epoch: 'fixture', cursor: 0 }
      else if (path === '/api/conversation-groups') data = { revision: 0, groups: [{ id: 'folder', name: 'Fixture folder', contextPath: 'Groups/Fixture/Context.md', leaderThreadId: 'a' }], assignments: { a: 'folder', b: 'folder' } }
      else if (path === '/api/read-state') data = { revision: 0, unread: {} }
      else if (path.endsWith('/message-ids')) data = { ids: [] }
      else if (path === '/api/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(': fixture\n\n'); return }
      else if (path.startsWith('/api/threads/')) data = { thread: thread(path.split('/')[3]) }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); return
    }
    const target = resolve(clientRoot, '.' + (path === '/' ? '/index.html' : path))
    if (!target.startsWith(clientRoot + '/')) { res.writeHead(404); res.end(); return }
    try {
      const data = await readFile(target), ext = target.split('.').at(-1)
      res.writeHead(200, { 'Content-Type': ({ html: 'text/html', js: 'text/javascript', css: 'text/css', png: 'image/png', webmanifest: 'application/manifest+json' })[ext] || 'application/octet-stream', 'Service-Worker-Allowed': '/', 'Cache-Control': 'no-store' }); res.end(data)
    } catch { res.writeHead(404); res.end() }
  })
  menuServer.listen(0, '127.0.0.1'); await once(menuServer, 'listening')
  const menuOrigin = `http://127.0.0.1:${menuServer.address().port}`
  for (const engine of (process.env.UI_ENGINES || 'chromium,webkit').split(',')) {
    browser = await engines[engine].launch({ headless: true })
    for (const width of (process.env.UI_WIDTHS || '1280,320,375,390').split(',').map(Number)) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'allow' })
      const page = await context.newPage(), errors = []; writes.length = 0
      page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message))
      await page.goto(menuOrigin); await page.locator('#instruction').waitFor().catch(async error => { await page.screenshot({ path: join(output, 'fixture-failure.png') }); console.log('Fixture errors:', errors, await page.locator('body').innerText()); throw error })
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
      await page.locator('#instruction').waitFor()
      if (errors.length) console.log('Initial worker takeover navigation errors:', engine, errors.splice(0))
      if (width < 760) await page.getByRole('button', { name: 'Open conversations', exact: true }).click()
      // Simulate the rendering consequence of unsupported popover attributes:
      // closed panels receive no browser hiding rule. Does not claim old iOS emulation.
      await page.evaluate(() => document.styleSheets[0].insertRule('[popover] { display: block !important; }', 0))
      if (process.env.UI_BASELINE) {
        assert(await page.locator('.thread-actions-popover:visible').count() >= 3)
        await page.screenshot({ path: join(output, `before-menus-${engine}-${width}.png`) })
        await context.close(); continue
      }
      const panels = page.locator('.thread-actions-popover'), first = page.getByRole('button', { name: 'Actions for First fixture', exact: true }), second = page.getByRole('button', { name: 'Actions for Second fixture', exact: true })
      await panels.waitFor({ state: 'detached' })
      for (const button of [first, second, page.getByRole('button', { name: 'Folder actions for Fixture folder', exact: true })]) {
        await button.focus(); await button.press('Enter'); assert.equal(await panels.count(), 1)
        assert.equal(await button.getAttribute('aria-expanded'), 'true')
        const box = await panels.boundingBox(); assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= 844)
        assert(await panels.evaluate(el => el.contains(document.activeElement)))
      }
      await page.keyboard.press('Escape'); await panels.waitFor({ state: 'detached' })
      await first.focus(); await page.keyboard.press('Enter'); assert.equal(await panels.count(), 1)
      await page.screenshot({ path: join(output, `menus-${engine}-${width}.png`) })
      await page.keyboard.press('Escape'); assert(await first.evaluate(el => document.activeElement === el))
      await first.click(); await first.click(); await panels.waitFor({ state: 'detached' })
      await first.click(); await panels.getByRole('button', { name: 'Rename', exact: true }).click(); await page.getByRole('dialog', { name: 'Rename conversation', exact: true }).waitFor(); await panels.waitFor({ state: 'detached' }); await page.keyboard.press('Escape')
      await first.click(); await page.locator('.thread-row').filter({ hasText: 'Second fixture' }).evaluate(el => el.click()); await panels.waitFor({ state: 'detached' })
      if (width < 760) await page.getByRole('button', { name: 'Open conversations', exact: true }).click()
      await second.click(); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await panels.waitFor({ state: 'detached' })
      await first.click(); await page.getByRole('button', { name: 'App menu', exact: true }).click(); await panels.waitFor({ state: 'detached' })
      await page.getByRole('button', { name: 'Lock app', exact: true }).waitFor()
      await page.keyboard.press('Escape')
      await first.click()
      if (width < 760) await page.getByRole('button', { name: 'Close conversations', exact: true }).click({ position: { x: width - 3, y: 800 } })
      else await page.locator('#instruction').click()
      await panels.waitFor({ state: 'detached' })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      assert(writes.every(path => /^\/api\/threads\/[ab]\/resume$/.test(path)), 'Menu navigation only resumes fixture reads; no mutations'); assert.deepEqual(errors, [])
      await context.close()
      // Separate real authenticated/encrypted fixture, without plaintext API mocking.
      const secure = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'allow' }), gate = await secure.newPage()
      gate.setDefaultTimeout(12000)
      await gate.goto(config.publicOrigin.origin)
      await gate.getByLabel('Khóa mã hóa riêng', { exact: true }).waitFor()
      await gate.screenshot({ path: join(output, `unlock-${engine}-${width}.png`) })
      await gate.getByRole('button', { name: 'Đăng nhập lại', exact: true }).click()
      const password = gate.getByLabel('Mật khẩu đăng nhập', { exact: true })
      assert.equal(await password.getAttribute('autocomplete'), 'current-password'); assert.equal(await password.getAttribute('type'), 'password')
      assert(await password.evaluate(el => document.activeElement === el))
      await gate.screenshot({ path: join(output, `login-${engine}-${width}.png`) })
      let release, entered
      const held = new Promise(r => { release = r }), at = new Promise(r => { entered = r })
      loginEntered = entered; loginRelease = held
      await password.fill(config.password); await password.press('Enter'); await at
      assert(await gate.getByRole('button', { name: 'Đang kiểm tra…', exact: true }).isDisabled())
      assert(await gate.getByRole('button', { name: 'Đã đăng nhập · Mở khóa', exact: true }).isDisabled())
      await gate.screenshot({ path: join(output, `busy-${engine}-${width}.png`) })
      loginEntered = undefined; release(); await gate.getByLabel('Khóa mã hóa riêng', { exact: true }).waitFor()
      const input = gate.getByLabel('Khóa mã hóa riêng', { exact: true })
      assert(await input.evaluate(el => document.activeElement === el))
      await input.fill(randomBytes(32).toString('base64url')); await input.press('Enter'); await gate.getByRole('alert').waitFor()
      await gate.screenshot({ path: join(output, `error-${engine}-${width}.png`) })
      assert.equal(await input.inputValue(), '')
      await input.fill(material.key); await input.press('Enter'); await gate.locator('#instruction').waitFor().catch(async error => { console.log('Secure fixture UI:', await gate.locator('body').innerText()); throw error })
      assert.equal(await gate.locator('.secure-lock-button').count(), 0)
      if (width < 760) await gate.getByRole('button', { name: 'Open conversations', exact: true }).click()
      await gate.getByRole('button', { name: 'App menu', exact: true }).click(); await gate.getByRole('button', { name: 'Lock app', exact: true }).click()
      await gate.getByLabel('Khóa mã hóa riêng', { exact: true }).waitFor()
      assert.equal(await gate.locator('#instruction').count(), 0)
      assert.equal(await gate.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      await secure.close(); results.push({ engine, width, menus: true, realLoginProofUnlockLogout: true, floatingLockAbsent: true })
      await writeFile(join(output, 'browser-progress.json'), JSON.stringify(results)); console.log('PASS', engine, width)
    }
    await browser.close(); browser = undefined
  }
  await writeFile(join(output, process.env.UI_BASELINE ? 'browser-baseline.json' : 'browser.json'), JSON.stringify({ results, noModelTurns: true, realSafari: false }, null, 2))
} finally {
  await browser?.close(); menuServer?.closeAllConnections(); if (menuServer) await new Promise(r => menuServer.close(r)); server?.closeAllConnections(); if (server) await new Promise(r => server.close(r)); controller?.stop(); await rm(root, { recursive: true, force: true })
}
