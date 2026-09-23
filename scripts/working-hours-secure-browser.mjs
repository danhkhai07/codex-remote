// Actual built app, login/unlock, SecureApi, HTTP file routes and WorkHoursStore.
// Only the exact configured NEW logical file is mapped into a temporary fixture.
// No production file, key, native process or model request is used.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { SecureApi } from '../dist-server/secure-api.js'
import { SessionRegistry } from '../dist-server/session-registry.js'
import { createRemoteHttpServer } from '../dist-server/http-app.js'
import { RemoteController } from '../dist-server/controller.js'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
import { WorkHoursStore } from '../dist-server/work-hours.js'
import { SECURE_VIEWER_HTML, SECURE_VIEWER_CSP } from '../dist-server/secure-viewer.js'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const dashboard = '/root/.local/state/codex-remote-secure/hours/index.html'
const root = mkdtempSync('/tmp/hours-secure-browser-'), files = join(root, 'hours')
mkdirSync(files)
const random = (size = 24) => randomBytes(size).toString('base64url')
const material = { version: 1, app: random(), generation: random(), key: random(32) }
writeFileSync(join(root, 'key.json'), JSON.stringify(material), { mode: 0o600 })
let now = Date.parse('2026-09-23T12:00:00+07:00')
const store = new WorkHoursStore(join(files, 'working-hours-state.json'), () => now)
store.change({ action: 'replace-totals', totals: { '2026-09-23': 2.25 }, expectedRevision: store.read().revision })
store.change({ action: 'pause', expectedRevision: store.read().revision })
const stateBefore = readFileSync(join(files, 'working-hours-state.json'), 'utf8')
// Deliberately different embedded totals: shared API must replace, not add them.
const data = { today: '2026-09-23', generated: new Date(now).toISOString(), timezone: 'Asia/Ho_Chi_Minh', days: [{ date: '2026-09-23', hours: 99, source: 'recorded' }] }
writeFileSync(join(files, 'index.html'), readFileSync('working-hours/dashboard.template.html', 'utf8').replace('__WORK_DATA__', JSON.stringify(data)))
const config = { host: '127.0.0.1', port: 0, publicOrigin: new URL('http://127.0.0.1'), password: 'FAKE-hours-password', sessionSecret: 'fixture-hours-secret'.repeat(3), sessionTtlSeconds: 3600, codexBin: 'UNUSED', production: true, workspaceRoots: [files], fileRoots: [files], secureApiRequired: true, secureKeyFile: join(root, 'key.json') }
const controller = new RemoteController(config, new CodexAppServer('UNUSED'))
const inner = createRemoteHttpServer({ ...config, secureApiRequired: false }, controller, resolve('dist'), null, undefined, undefined, undefined, store)
const secure = new SecureApi(config, new SessionRegistry(config.sessionSecret, undefined, config.password), [files])
const requested = [], failures = []
let hoursReads = 0, browser
const dispatch = async (req, res) => {
  const url = new URL(req.url, config.publicOrigin)
  if (url.pathname.startsWith('/api/files/')) {
    requested.push(url.searchParams.get('path'))
    assert.equal(url.searchParams.get('path'), dashboard, 'No OLD path or wildcard file interception')
    url.searchParams.set('path', join(files, 'index.html'))
    req.url = url.pathname + url.search
  }
  if (url.pathname === '/api/working-hours') { assert.equal(req.method, 'GET'); hoursReads++ }
  inner.emit('request', req, res)
}
const server = createServer((req, res) => {
  const path = new URL(req.url, config.publicOrigin).pathname
  if (path.startsWith('/api/secure/')) { void secure.handle(req, res, dispatch); return }
  if (path === '/secure-viewer') { res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': SECURE_VIEWER_CSP }); res.end(SECURE_VIEWER_HTML); return }
  if (path.startsWith('/api/') && path !== '/api/session/login') { res.writeHead(401); res.end(); return }
  inner.emit('request', req, res)
})
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  config.port = server.address().port
  // The inner gateway shares the URL object for origin validation.
  config.publicOrigin.port = String(config.port)
  browser = await chromium.launch({ headless: true })
  for (const width of [1280, 390, 320]) {
    // Fresh ephemeral profile; allow the real preview-migration worker on localhost.
    const context = await browser.newContext({ viewport: { width, height: 844 } })
    const page = await context.newPage(); page.setDefaultTimeout(15000)
    page.on('pageerror', error => failures.push(error.message))
    await page.goto(config.publicOrigin.origin + '/working-hours')
    await page.getByRole('button', { name: 'Đăng nhập lại', exact: true }).click().catch(async error => { console.error(await page.locator('body').innerText(), failures); throw error })
    await page.getByLabel('Mật khẩu đăng nhập', { exact: true }).fill(config.password)
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    const unlock = async () => {
      await page.getByLabel('Khóa mã hóa riêng', { exact: true }).fill(material.key)
      await page.getByRole('button', { name: 'Mở khóa', exact: true }).click()
    }
    await unlock()
    const verify = async () => {
      const frame = page.frameLocator('iframe')
      await frame.locator('#today-worked').filter({ hasText: '2 giờ 15 phút' }).waitFor()
      await frame.getByRole('button', { name: 'Tiếp tục', exact: true }).waitFor()
      assert.equal(await frame.locator('body').evaluate(body => body.scrollWidth > innerWidth), false)
    }
    await verify()
    const reads = hoursReads
    await page.goto(config.publicOrigin.origin + '/files?' + new URLSearchParams({ path: dashboard }))
    await unlock(); await verify()
    assert.ok(hoursReads > reads, 'Files NEW dashboard attaches shared API bridge')
    now += 60000
    assert.equal(readFileSync(join(files, 'working-hours-state.json'), 'utf8'), stateBefore)
    if (process.env.HOURS_SCREENSHOTS) await page.screenshot({ path: join(process.env.HOURS_SCREENSHOTS, `encrypted-files-${width}.png`), fullPage: true })
    await context.close()
    console.log(`PASS encrypted ${width}: actual login/unlock -> Hours -> NEW file -> shared API; Files bridge; paused totals replace embedded 99h`)
  }
  assert.ok(requested.length >= 6); assert.deepEqual(failures, [])
} finally {
  await browser?.close(); secure.close(); server.closeAllConnections()
  await new Promise(resolve => server.close(resolve)); inner.close()
  rmSync(root, { recursive: true, force: true })
}
