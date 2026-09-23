// Read-only Hours acceptance on a disposable server. Only the fixture HTML path is rewritten;
// transformed artifacts never enter the release. Actual owner Files UI uses the unmodified build.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { build } from 'vite'
import { createRemoteHttpServer } from '../dist-server/http-app.js'
import { RemoteController } from '../dist-server/controller.js'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
import { WorkHoursStore } from '../dist-server/work-hours.js'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = await mkdtemp(join(tmpdir(), 'owner-hours-')), path = join(root, 'index.html'), state = join(root, 'hours.json'), dist = join(root, 'dist')
let browser, server
try {
  const now = Date.parse('2026-09-23T12:00:00+07:00'), day = '2026-09-23'
  const source = JSON.stringify({ revision: 7, autoPaused: true, pausedAt: now, estimateSince: now, estimateBaselines: {}, totals: { [day]: 3.5 }, timer: null })
  await writeFile(state, source)
  const data = { generated: new Date(now).toISOString(), today: day, timezone: 'Asia/Ho_Chi_Minh', sourceFiles: 0, gapMinutes: 60, days: [{ date: day, hours: 3.5, estimatedHours: 3.5, source: 'recorded' }] }
  await writeFile(path, (await readFile('working-hours/dashboard.template.html', 'utf8')).replace('__WORK_DATA__', JSON.stringify(data)))
  await build({ logLevel: 'error', plugins: [{ name: 'owned-hours-path', enforce: 'pre', transform(code, id) { if (id.endsWith('/src/workTimerStorage.ts')) { assert(code.includes('/root/VAULTS/Flint-Software/Working-Hours/index.html')); return code.replace('/root/VAULTS/Flint-Software/Working-Hours/index.html', path) } } }], build: { outDir: dist, emptyOutDir: true } })
  const rand = n => randomBytes(n).toString('base64url'), material = { version: 1, app: rand(18), generation: rand(18), key: rand(32) }, key = join(root, 'owner.json')
  await writeFile(key, JSON.stringify(material), { mode: 0o600 })
  const config = { host: '127.0.0.1', port: 0, publicOrigin: new URL('http://127.0.0.1'), password: 'FAKE owner hours password', sessionSecret: 'FAKE-hours-secret'.repeat(4), sessionTtlSeconds: 600, codexBin: 'unused', production: true, workspaceRoots: [root], fileRoots: ['/'], fileAccess: 'owner-full', secureApiRequired: true, secureKeyFile: key, sessionStateFile: join(root, 'sessions.json') }
  const store = new WorkHoursStore(state, () => now)
  server = createRemoteHttpServer(config, new RemoteController(config, new CodexAppServer('unused')), dist, null, undefined, undefined, undefined, store)
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); config.port = server.address().port; config.publicOrigin = new URL('http://127.0.0.1:' + config.port)
  browser = await chromium.launch({ headless: true })
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport }), page = await context.newPage(); page.setDefaultTimeout(15000)
    await page.goto(config.publicOrigin.origin + '/working-hours'); await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
    await page.getByRole('button', { name: 'Đăng nhập lại', exact: true }).click(); await page.getByLabel('Mật khẩu đăng nhập', { exact: true }).fill(config.password); await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    await page.getByLabel('Khóa mã hóa riêng', { exact: true }).fill(material.key); await page.getByRole('button', { name: 'Mở khóa', exact: true }).click()
    await page.frameLocator('iframe[src="/secure-viewer"]').getByRole('button', { name: 'Tiếp tục', exact: true }).waitFor()
    assert.equal(await readFile(state, 'utf8'), source)
    if (process.env.OWNER_FILES_SCREENSHOTS) { await mkdir(process.env.OWNER_FILES_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: join(process.env.OWNER_FILES_SCREENSHOTS, `hours-readonly-${viewport.width}.png`) }) }
    await context.close(); console.log(`PASS ${viewport.width}: Hours shows paused state without any timer/pause/resume/edit or state-byte change`)
  }
} finally { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) } await rm(root, { recursive: true, force: true }) }
