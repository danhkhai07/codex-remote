// Real local HTTP/encrypted API + fake native process and fake files only.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, cp, writeFile, readFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createRemoteHttpServer } from '../dist-server/http-app.js'
import { RemoteController } from '../dist-server/controller.js'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = await mkdtemp(join(tmpdir(), 'owner-files-browser-')), files = join(root, 'project'), dist = join(root, 'dist')
const random = n => randomBytes(n).toString('base64url')
const material = { version: 1, app: random(18), generation: random(18), key: random(32) }
let browser, server, controller
try {
  await mkdir(files); await cp(resolve('dist'), dist, { recursive: true })
  const home = join(root, 'root'), privateDir = join(home, '.local', 'state', 'app'); await mkdir(privateDir, { recursive: true })
  const secret = join(privateDir, '.env'), note = join(home, 'Báo cáo 日本語.md'), html = join(home, 'page.html')
  await writeFile(secret, 'FAKE OWNER FILE CANARY')
  await writeFile(note, `[Hidden file](${secret})`); await symlink(secret, join(home, 'alias.txt'))
  await writeFile(html, '<button onclick="document.body.dataset.clicked=1">HTML canary</button><script>try{parent.document.body.dataset.escaped=1}catch{}</script>')
  const keyFile = join(privateDir, 'owner-key.json'); await writeFile(keyFile, JSON.stringify(material), { mode: 0o600 })
  const config = { host: '127.0.0.1', port: 0, publicOrigin: new URL('http://127.0.0.1'), password: 'FAKE owner browser password', sessionSecret: 'fixture-secret'.repeat(4), sessionTtlSeconds: 600, codexBin: 'unused', production: true, workspaceRoots: [files], fileRoots: ['/'], fileAccess: 'owner-full', secureApiRequired: true, secureKeyFile: keyFile, sessionStateFile: join(root, 'sessions.json') }
  // Replace only the disposable native fixture's history with a file-link receipt.
  const fixture = join(root, 'native.mjs')
  const source = await readFile(resolve('server/fixtures/plan-questions.mjs'), 'utf8')
  const nativeSource = source.replace("cwd: '/tmp'", `cwd: ${JSON.stringify(files)}`).replace("`History ${i}\\n\\n${'Long conversation context. '.repeat(30)}`", JSON.stringify(`[Conversation file](${secret})`))
  assert(nativeSource.includes('[Conversation file]'), 'Native file-link fixture replacement must apply')
  await writeFile(fixture, nativeSource)
  const native = new CodexAppServer(process.execPath, [fixture])
  controller = new RemoteController(config, native); await controller.start()
  server = createRemoteHttpServer(config, controller, dist, null); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  config.port = server.address().port; config.publicOrigin = new URL('http://127.0.0.1:' + config.port)
  browser = await chromium.launch({ headless: true })
  const shots = process.env.OWNER_FILES_SCREENSHOTS
  if (shots) await mkdir(shots, { recursive: true })
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
    const context = await browser.newContext({ viewport, acceptDownloads: true, serviceWorkers: 'allow' }), page = await context.newPage()
    page.setDefaultTimeout(15000)
    const errors = [], wire = []
    page.on('pageerror', error => errors.push(error.message))
    context.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) wire.push({ url: request.url(), body: request.postData() ?? '' }) })
    const direct = path => config.publicOrigin.origin + '/files?' + new URLSearchParams({ path })
    const titleIs = async (target, title) => target.waitForFunction(expected => document.title === expected, title)
    const unlock = async target => { await target.getByLabel('Khóa mã hóa riêng', { exact: true }).fill(material.key); await target.getByRole('button', { name: 'Mở khóa', exact: true }).click() }
    await page.goto(direct(note))
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
    const defaultTitle = await page.title()
    assert(!defaultTitle.includes('Báo cáo'), 'Locked URL must not expose the filename in its title')
    assert.equal(await page.getByRole('dialog').count(), 0)
    await page.getByRole('button', { name: 'Đăng nhập lại', exact: true }).click()
    await page.getByLabel('Mật khẩu đăng nhập', { exact: true }).fill(config.password); await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    await unlock(page)
    const hidden = page.getByRole('link', { name: 'Hidden file', exact: true }); await hidden.waitFor()
    await titleIs(page, 'Báo cáo 日本語.md · Codex Remote')
    assert(new URL(await hidden.getAttribute('href'), config.publicOrigin.origin).pathname === '/files')
    // A normal click uses the current unlocked viewer. Open uses an independently locked tab.
    await hidden.click(); await page.locator('.file-text-raw').filter({ hasText: 'FAKE OWNER FILE CANARY' }).waitFor()
    await titleIs(page, '.env · Codex Remote')
    await page.goBack(); await titleIs(page, 'Báo cáo 日本語.md · Codex Remote')
    await page.goForward(); await titleIs(page, '.env · Codex Remote')
    const [popup] = await Promise.all([context.waitForEvent('page', { timeout: 15000 }), page.getByRole('link', { name: 'Open', exact: true }).click()])
    await popup.getByLabel('Khóa mã hóa riêng', { exact: true }).waitFor(); assert.equal(await popup.getByRole('dialog').count(), 0)
    await titleIs(popup, defaultTitle)
    await unlock(popup); await popup.locator('.file-text-raw').filter({ hasText: 'FAKE OWNER FILE CANARY' }).waitFor()
    await titleIs(popup, '.env · Codex Remote')
    await popup.evaluate(() => { window.showSaveFilePicker = undefined; navigator.share = undefined })
    const downloaded = popup.waitForEvent('download'); await popup.getByRole('button', { name: 'Download', exact: true }).click()
    assert.equal(await readFile(await (await downloaded).path(), 'utf8'), 'FAKE OWNER FILE CANARY')
    assert((await popup.locator('.file-viewer-title').boundingBox()).width > 20, 'File name remains visible beside/above Open on mobile')
    assert(await popup.locator('.file-viewer-header').evaluate(el => el.scrollWidth <= el.clientWidth), 'No header horizontal overflow')
    if (shots) await popup.screenshot({ path: join(shots, `owner-direct-${viewport.width}.png`) })
    await popup.reload(); await popup.getByLabel('Khóa mã hóa riêng', { exact: true }).waitFor(); assert.equal(await popup.getByRole('dialog').count(), 0); await titleIs(popup, defaultTitle); await popup.close()
    await page.goto(direct(html)); await unlock(page)
    const frame = page.frameLocator('iframe[src="/secure-viewer"]'); await frame.getByRole('button', { name: 'HTML canary' }).click()
    assert.equal(await frame.locator('body').getAttribute('data-clicked'), '1'); assert.equal(await page.locator('body').getAttribute('data-escaped'), null)
    await titleIs(page, 'page.html · Codex Remote')
    for (const path of [join(home, 'missing-private.txt'), home]) {
      await page.goto(direct(path)); await unlock(page)
      await page.getByRole('alert').filter({ hasText: 'Couldn’t open file' }).waitFor()
      await titleIs(page, 'Files · Codex Remote')
    }
    await page.goto(config.publicOrigin.origin + '/files'); await unlock(page)
    await page.getByText('Đường dẫn tệp không hợp lệ.', { exact: true }).waitFor(); await titleIs(page, defaultTitle)
    await page.goto(config.publicOrigin.origin); await unlock(page); await page.locator('#instruction').waitFor()
    if (viewport.width < 760) await page.getByRole('button', { name: 'Open conversations', exact: true }).click()
    await page.locator('.thread-row').filter({ hasText: 'Plan question fixture' }).click()
    await page.getByRole('link', { name: /^Conversation file/ }).last().waitFor()
    await page.locator('#instruction').fill('UNSENT OWNER DRAFT')
    await native.request('fixture/question', { id: 'owner-plan-' + viewport.width, questions: [{ id: 'files-plan', header: 'Plan', question: 'FAKE PLAN FILES CHECK', options: [{ label: 'Keep draft', description: 'Fixture only' }, { label: 'Inspect file', description: 'Fixture only' }] }] })
    await page.getByText('FAKE PLAN FILES CHECK', { exact: true }).waitFor()
    const conversationLink = page.getByRole('link', { name: /^Conversation file/ }).last(); await conversationLink.waitFor(); await conversationLink.click()
    await page.locator('.file-text-raw').filter({ hasText: 'FAKE OWNER FILE CANARY' }).waitFor(); await titleIs(page, '.env · Codex Remote'); await page.getByRole('button', { name: 'Close file viewer', exact: true }).click(); await titleIs(page, defaultTitle)
    assert.equal(await page.locator('#instruction').inputValue(), 'UNSENT OWNER DRAFT')
    await page.getByRole('button', { name: 'Files', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Files', exact: true })
    await dialog.getByRole('button', { name: 'Edit directory path', exact: true }).click(); await dialog.getByRole('textbox', { name: 'Directory path', exact: true }).fill(home); await dialog.getByRole('button', { name: 'Go', exact: true }).click()
    await dialog.getByLabel('File browser options', { exact: true }).click(); await dialog.getByLabel('Hidden files', { exact: true }).check()
    await dialog.getByLabel('File browser options', { exact: true }).click()
    await dialog.locator('.file-browser-entry').filter({ hasText: '.local' }).waitFor()
    if (shots) await page.screenshot({ path: join(shots, `owner-files-${viewport.width}.png`) })
    await dialog.locator('.file-browser-entry').filter({ hasText: 'alias.txt' }).click(); await page.locator('.file-text-raw').filter({ hasText: 'FAKE OWNER FILE CANARY' }).waitFor()
    await page.getByRole('button', { name: 'Close file viewer', exact: true }).click(); await page.getByRole('button', { name: 'Close file browser', exact: true }).click();
    await page.getByText('FAKE PLAN FILES CHECK', { exact: true }).waitFor(); assert.equal(await page.locator('#instruction').inputValue(), 'UNSENT OWNER DRAFT')
    await native.request('turn/interrupt', { threadId: 'plan-fixture', turnId: 'plan-turn' })
    const lockedViewer = await context.newPage()
    await lockedViewer.goto(direct(note)); await unlock(lockedViewer)
    await titleIs(lockedViewer, 'Báo cáo 日本語.md · Codex Remote')
    if (viewport.width < 760) await page.getByRole('button', { name: 'Open conversations', exact: true }).click();
    await page.getByLabel('Settings', { exact: true }).click(); await page.getByRole('button', { name: 'Lock app', exact: true }).click(); await page.getByLabel('Khóa mã hóa riêng', { exact: true }).waitFor(); assert.equal(await page.getByRole('dialog').count(), 0)
    await titleIs(page, defaultTitle)
    await lockedViewer.getByLabel('Khóa mã hóa riêng', { exact: true }).waitFor()
    await titleIs(lockedViewer, defaultTitle)
    assert(!wire.some(r => new URL(r.url).pathname.startsWith('/api/files/')))
    assert(!wire.some(r => r.body.includes('FAKE OWNER FILE CANARY') || r.body.includes(material.key)))
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`PASS ${viewport.width}: direct URL/login/unlock/reload, new tab, hidden listing, symlink, download, HTML sandbox, conversation link/draft and Lock`)
  }
} catch (error) {
  for (const [i, page] of (browser?.contexts().flatMap(c => c.pages()) ?? []).entries()) await page.screenshot({ path: `/tmp/owner-files-failure-${i}.png` }).catch(() => {})
  console.error(error); throw error
} finally {
  await browser?.close(); controller?.stop()
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await rm(root, { recursive: true, force: true })
}
