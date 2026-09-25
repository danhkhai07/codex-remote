import { historyFixtureConfig } from '../server/fixtures/history-store.mjs'
// Real generated documents, SessionRegistry, tunnel, file handlers and HoursStore.
// Only the fixed Hours path is redirected at build time into a temporary fixture.
// Never read live Hours, call a real model, or write a production credential.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { execFileSync } from 'node:child_process'
import { build } from 'vite'
import { createRemoteHttpServer } from '../dist-server/http-app.js'
import { RemoteController } from '../dist-server/controller.js'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
import { WorkHoursStore } from '../dist-server/work-hours.js'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = await mkdtemp(join(tmpdir(), 'secure-documents-')), files = join(root, 'files'), dist = join(root, 'dist')
const fakeDashboard = join(files, 'index.html'), realDashboard = '/root/VAULTS/Flint-Software/Working-Hours/index.html'
const random = (n = 24) => randomBytes(n).toString('base64url')
const material = { version: 1, app: random(), generation: random(), key: random(32) }
let browser, server, controller
const shots = process.env.SECURE_DOCUMENT_SCREENSHOTS
try {
  await mkdir(files); if (shots) await mkdir(shots, { recursive: true })
  execFileSync('python3', ['scripts/fixtures/secure-documents.py', files])
  const large = await open(join(files, 'large.bin'), 'w'); await large.truncate(65 * 1024 * 1024); await large.close()
  await writeFile(join(root, 'owner.json'), JSON.stringify(material), { mode: 0o600 })
  let now = Date.parse('2026-09-21T12:00:00+07:00')
  const day = '2026-09-21', hour = 3600000
  const store = new WorkHoursStore(join(root, 'hours-state.json'), () => now)
  await writeFile(join(root, 'data.json'), JSON.stringify({ days: [], activityIntervals: [[now - 2 * hour, now]] }))
  const data = { generated: new Date(now).toISOString(), today: day, timezone: 'Asia/Ho_Chi_Minh', sourceFiles: 1, gapMinutes: 60, days: [{ date: day, hours: 2, estimatedHours: 2, source: 'recorded' }] }
  const html = (await readFile('working-hours/dashboard.template.html', 'utf8')).replace('__WORK_DATA__', JSON.stringify(data))
  await writeFile(fakeDashboard, html)
  await build({ logLevel: 'error', plugins: [{ name: 'fixture-hours-path', enforce: 'pre', transform(code, id) { if (id.endsWith('/src/workTimerStorage.ts')) { assert(code.includes(realDashboard)); return code.replace(realDashboard, fakeDashboard) } } }], build: { outDir: dist, emptyOutDir: true } })
  const config = { ...historyFixtureConfig(), host: '127.0.0.1', port: 0, publicOrigin: new URL('http://127.0.0.1'), password: 'FAKE documents password', sessionSecret: 'fake-documents-session'.repeat(3), sessionTtlSeconds: 600, codexBin: 'unused', production: true, workspaceRoots: ['/tmp'], fileRoots: [files], secureApiRequired: true, secureKeyFile: join(root, 'owner.json'), sessionStateFile: join(root, 'sessions.json') }
  controller = new RemoteController(config, new CodexAppServer(process.execPath, [resolve('server/fixtures/plan-questions.mjs')]))
  server = createRemoteHttpServer(config, controller, dist, null, undefined, undefined, undefined, store)
  await controller.start(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); config.port = server.address().port; config.publicOrigin = new URL('http://127.0.0.1:' + config.port)
  browser = await chromium.launch({ headless: true })
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'allow', acceptDownloads: true })
    const page = await context.newPage(), errors = [], network = []
    page.setDefaultTimeout(20000)
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', req => { if (req.url().includes('/api/')) network.push({ path: new URL(req.url()).pathname, body: req.postData() || '' }) })
    await page.goto(config.publicOrigin.origin)
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
    await page.getByRole('button', { name: 'Đăng nhập lại', exact: true }).click()
    await page.getByLabel('Mật khẩu đăng nhập', { exact: true }).fill(config.password)
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    const unlock = async () => { await page.getByLabel('Khóa mã hóa riêng', { exact: true }).fill(material.key); await page.getByRole('button', { name: 'Mở khóa', exact: true }).click() }
    await unlock(); await page.locator('#instruction').waitFor()
    const openFiles = async () => {
      const close = page.getByRole('button', { name: 'Close file viewer', exact: true })
      if (await close.isVisible()) await close.click()
      if (!await page.getByRole('dialog', { name: 'Files', exact: true }).isVisible()) await page.getByRole('button', { name: 'Files', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Files', exact: true })
      const recovery = dialog.getByRole('alert').getByRole('button', { name: files, exact: true })
      // Cached browser directory can already point at the authorized fixture root.
      await Promise.race([recovery.waitFor(), dialog.getByRole('button', { name: /canary.pdf/ }).first().waitFor()])
      if (await recovery.isVisible()) await recovery.click()
      return dialog
    }
    const dialog = await openFiles()
    await dialog.getByRole('button', { name: /canary.docx/ }).first().click()
    const docx = page.frameLocator('iframe[src="/secure-docx-frame"]')
    await docx.getByText('PRIVATE DOCX CANARY', { exact: true }).waitFor()
    assert.equal(await docx.locator('table td').count(), 2)
    await page.getByRole('button', { name: 'Phóng to', exact: true }).click()
    assert.equal(await page.locator('iframe[src="/secure-docx-frame"]').getAttribute('sandbox'), 'allow-same-origin')
    if (shots) await page.screenshot({ path: join(shots, `docx-${viewport.width}.png`) })
    await page.getByRole('button', { name: 'Close file viewer', exact: true }).click()
    await dialog.getByRole('button', { name: /canary.pptx/ }).first().click()
    await page.locator('.pptx-slides[aria-busy="false"] canvas').waitFor({ timeout: 70000 })
    await page.getByRole('button', { name: 'Slide sau', exact: true }).click()
    await page.getByRole('img', { name: 'canary.pptx — slide 2 / 2', exact: true }).waitFor()
    await page.locator('.pptx-slides[aria-busy="false"] canvas').waitFor()
    if (shots) await page.screenshot({ path: join(shots, `pptx-${viewport.width}.png`) })
    await page.getByRole('button', { name: 'Close file viewer', exact: true }).click()
    await dialog.getByRole('button', { name: /canary.pdf/ }).first().click()
    await page.locator('.pptx-slides[aria-busy="false"] canvas').waitFor()
    await page.getByRole('button', { name: 'Trang sau', exact: true }).click()
    await page.getByRole('img', { name: 'canary.pdf — trang 2 / 2', exact: true }).waitFor()
    await page.locator('.pptx-slides[aria-busy="false"] canvas').waitFor()
    if (shots) await page.screenshot({ path: join(shots, `pdf-${viewport.width}.png`) })
    await page.evaluate(() => { window.showSaveFilePicker = undefined })
    for (const name of ['canary.pdf', 'canary.docx', 'canary.pptx']) {
      if (name !== 'canary.pdf') { await page.getByRole('button', { name: 'Close file viewer', exact: true }).click(); await dialog.getByRole('button', { name: new RegExp(name) }).first().click() }
      const download = page.waitForEvent('download'); await page.getByRole('dialog').last().getByRole('button', { name: 'Download', exact: true }).click()
      assert((await readFile(await (await download).path())).equals(await readFile(join(files, name))))
    }
    await page.getByRole('button', { name: 'Close file viewer', exact: true }).click()
    await dialog.getByRole('button', { name: /large.bin/ }).first().click()
    await page.getByRole('dialog').last().getByRole('button', { name: 'Download', exact: true }).click()
    await page.getByText(/Tệp lớn hơn 64 MiB cần trình duyệt/).waitFor()
    await page.getByRole('button', { name: 'Close file viewer', exact: true }).click()
    await page.goto(config.publicOrigin.origin + '/working-hours'); await unlock()
    let hours = page.frameLocator('iframe[src="/secure-viewer"]')
    await hours.locator('#auto-toggle:enabled').waitFor()
    if (store.read().autoPaused) { await hours.getByRole('button', { name: 'Tiếp tục', exact: true }).click(); await hours.getByRole('button', { name: 'Tạm dừng', exact: true }).waitFor() }
    await hours.locator('#timer-start').click(); await hours.locator('#timer-stop:enabled').waitFor()
    now += hour / 2
    await hours.getByRole('button', { name: 'Tạm dừng', exact: true }).click(); await hours.getByRole('button', { name: 'Tiếp tục', exact: true }).waitFor()
    const paused = store.read(); assert.equal(paused.autoPaused, true); assert.equal(paused.timer, null)
    now += hour
    await page.reload(); await unlock(); hours = page.frameLocator('iframe[src="/secure-viewer"]')
    await hours.getByRole('button', { name: 'Tiếp tục', exact: true }).waitFor()
    assert.deepEqual(store.read().totals, paused.totals)
    if (shots) await page.screenshot({ path: join(shots, `hours-paused-${viewport.width}.png`) })
    await hours.getByRole('button', { name: 'Tiếp tục', exact: true }).click(); await hours.getByRole('button', { name: 'Tạm dừng', exact: true }).waitFor()
    assert.equal(store.read().autoPaused, false); assert.equal(store.read().timer, null)
    await page.goto(config.publicOrigin.origin); await unlock(); await page.locator('#instruction').waitFor()
    const filesAgain = await openFiles(); await filesAgain.getByRole('button', { name: /index.html/ }).first().click()
    hours = page.frameLocator('.file-viewer iframe[src="/secure-viewer"]')
    await hours.getByRole('button', { name: 'Tạm dừng', exact: true }).click(); await hours.getByRole('button', { name: 'Tiếp tục', exact: true }).waitFor()
    assert.equal(store.read().autoPaused, true)
    assert(network.every(r => ['/api/secure/setup', '/api/secure/challenge', '/api/secure/handshake', '/api/secure/request', '/api/session/login'].includes(r.path)))
    assert(!network.some(r => r.body.includes('PRIVATE') || r.body.includes(material.key) || r.body.includes('/api/working-hours') || r.body.includes(fakeDashboard)))
    assert.deepEqual(errors, [])
    console.log(`PASS ${viewport.width}: real DOCX/PPTX/PDF bytes, documents, >64MiB explicit refusal, encrypted Hours page+Files pause/resume/reload, no plaintext API`)
    await context.close()
  }
} finally {
  await browser?.close(); controller?.stop(); server?.closeAllConnections()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(root, { recursive: true, force: true })
}
