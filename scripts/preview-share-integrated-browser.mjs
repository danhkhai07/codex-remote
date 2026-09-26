// Actual candidate HTTP/secure/share implementation, owned HTTPS and fake native metadata only.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createServer, request } from 'node:http'
import { createServer as httpsServer } from 'node:https'
import { randomId } from '../dist-server/secure-wire.js'
import { ServicesStore } from '../dist-server/services.js'
import { createRemoteHttpServer } from '../dist-server/http-app.js'
import { RemoteController } from '../dist-server/controller.js'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
import { createSession } from '../dist-server/auth.js'
import { SecureTransport } from '../dist-server/secure-client.js'

const engines = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const engine = process.env.SHARE_BROWSER || 'chromium'
const root = mkdtempSync(join(tmpdir(), 'share-integrated-')), cleanup = []
async function listen(server) {
  const sockets = new Set(); server.on('connection', s => { sockets.add(s); s.once('close', () => sockets.delete(s)) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise(resolve => { for (const s of sockets) s.destroy(); server.close(resolve) }))
  return server.address().port
}
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(root, 'tls.key'), '-out', join(root, 'tls.crt'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' })
  const observed = []
  const appPort = await listen(createServer((req, res) => {
    observed.push({ path: req.url, cookie: req.headers.cookie || '' })
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Shared fixture</title><h1>Shared app opened</h1>')
  }))
  let gateway
  const tls = httpsServer({ key: readFileSync(join(root, 'tls.key')), cert: readFileSync(join(root, 'tls.crt')) }, (req, res) => {
    const upstream = request({ host: '127.0.0.1', port: gateway, path: req.url, method: req.method, headers: req.headers }, reply => { res.writeHead(reply.statusCode, reply.headers); reply.pipe(res) })
    upstream.on('error', () => res.destroy()); res.once('close', () => upstream.destroy()); req.pipe(upstream)
  })
  const tlsPort = await listen(tls)
  // localhost subdomains resolve without system hosts changes; Chromium uses explicit rules.
  const publicOrigin = `https://owner.localhost:${tlsPort}`, originTemplate = `https://p{port}.localhost:${tlsPort}`
  const files = join(root, 'files'); mkdirSync(files)
  const services = new ServicesStore(join(root, 'services.json'))
  services.upsert({ port: appPort, name: 'Integrated fixture', path: '/app?x=1', summary: 'Owned fake service only', prLabel: 'no PR' })
  const material = { version: 1, app: randomId(), generation: randomId(), key: randomId(32) }, ownerFile = join(root, 'owner.json')
  writeFileSync(ownerFile, JSON.stringify(material), { mode: 0o600 })
  const config = { host: '127.0.0.1', port: 0, publicOrigin: new URL(publicOrigin), password: 'fake integrated password', sessionSecret: 'fake integrated session secret '.repeat(3),
    sessionTtlSeconds: 600, codexBin: 'unused', production: true, workspaceRoots: [files], fileRoots: [files], secureApiRequired: true, secureKeyFile: ownerFile,
    sessionStateFile: join(root, 'sessions.json'), previewShareStateFile: join(root, 'shares.json'), previewOriginTemplate: originTemplate, previewSharePorts: [appPort] }
  const native = new CodexAppServer('unused'), controller = new RemoteController(config, native)
  const thread = { id: 'fixture-thread', cwd: files, name: 'Share integration', createdAt: 1, updatedAt: 1, status: { type: 'idle' }, turns: [] }
  const nativeReads = []
  native.request = async (method) => {
    nativeReads.push(method)
    if (method === 'thread/list') return { data: [thread], nextCursor: null }
    if (method === 'thread/read') return { thread }
    if (method === 'model/list') return { data: [{ id: 'fixture', model: 'fixture', isDefault: true, supportedReasoningEfforts: [] }] }
    if (method === 'thread/resume') return { thread }
    throw Error('Unexpected native method in read-only fixture: ' + method)
  }
  controller.readHistoryPage = async () => ({ thread: { ...thread, turns: [], historyWindow: { revision: 'fixture', older: null, messages: 0 } } })
  controller.readMessageIds = async () => ({ ids: [], nextCursor: null })
  const backend = createRemoteHttpServer(config, controller, resolve('dist'), null, undefined, undefined, undefined, undefined, undefined, services)
  gateway = await listen(backend); config.port = gateway
  const issued = createSession(config.sessionSecret, 600, config.password)
  const transport = new SecureTransport((url, init) => fetch(`http://127.0.0.1:${gateway}${new URL(String(url)).pathname}`, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), host: config.publicOrigin.host } }), publicOrigin, { Cookie: '__Host-codex_remote_session=' + issued.token, Origin: publicOrigin })
  cleanup.push(() => transport.lock()); await transport.unlock(material.key)
  const ownerApi = async (path, method = 'GET', body) => {
    const response = (await transport.request(path, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': issued.payload.csrf }, ...(body ? { body: JSON.stringify(body) } : {}) })).response
    assert(response.ok, `Owner fixture request ${response.status}`); return response.json()
  }
  const browser = await engines[engine].launch({ headless: true, ...(engine === 'chromium' ? { args: ['--no-sandbox', '--no-proxy-server', '--ignore-certificate-errors', '--host-resolver-rules=MAP *.localhost 127.0.0.1'] } : {}) }); cleanup.push(() => browser.close())
  const evidence = []
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 840 }, ignoreHTTPSErrors: true, ...(engine === 'chromium' ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}) })
    await context.addCookies([{ name: '__Host-codex_remote_session', value: createSession(config.sessionSecret, 600, config.password).token, url: publicOrigin, secure: true, httpOnly: true, sameSite: 'Strict' }])
    const page = await context.newPage(), errors = []; page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message))
    await page.goto(publicOrigin)
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
    await page.getByLabel('Khóa mã hóa riêng', { exact: true }).fill(material.key)
    await page.getByRole('button', { name: 'Mở khóa', exact: true }).click()
    try { await page.locator('#instruction').waitFor() } catch (e) { console.error(JSON.stringify({ body: await page.locator('body').innerText(), nativeReads, errors })); throw e };  await page.locator('#instruction').fill('Draft preserved')
    const openMenu = async () => { if (width < 800 && !await page.locator('.thread-sidebar').evaluate(e => e.classList.contains('is-open'))) await page.getByRole('button', { name: 'Open conversations', exact: true }).click(); await page.getByLabel('Settings', { exact: true }).click() }
    await openMenu(); await page.getByRole('button', { name: 'Link chia sẻ', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Link chia sẻ', exact: true }); await dialog.waitFor()
    await dialog.getByLabel('Dịch vụ', { exact: true }).selectOption(String(appPort))
    const label = `Review ${engine} ${width}`
    await dialog.getByLabel(/Tên gợi nhớ/).fill(label); await dialog.getByRole('button', { name: 'Tạo link chia sẻ', exact: true }).click()
    const row = dialog.locator('.preview-shares-active li').filter({ hasText: label }); await row.waitFor()
    await row.getByRole('button', { name: 'Sao chép', exact: true }).click(); await dialog.getByRole('status').filter({ hasText: 'Đã sao chép' }).waitFor()
    const link = await row.getByRole('link', { name: 'Mở', exact: true }).getAttribute('href')
    if (engine === 'chromium') assert.equal(await page.evaluate(() => navigator.clipboard.readText()), link)
    const tabWait = context.waitForEvent('page'); await row.getByRole('link', { name: 'Mở', exact: true }).click(); const tab = await tabWait
    await tab.getByRole('heading', { name: 'Shared app opened' }).waitFor(); await tab.close()
    const recipient = await browser.newContext({ viewport: { width, height: 700 }, ignoreHTTPSErrors: true }), target = await recipient.newPage()
    assert.equal((await recipient.cookies()).length, 0)
    await target.goto(link); await target.getByRole('heading', { name: 'Shared app opened' }).waitFor()
    assert(!(await recipient.cookies()).some(c => c.name.includes('remote_session')))
    assert(!JSON.stringify(observed).includes(new URL(link).hash.slice(1))); assert(!JSON.stringify(observed).includes('__Host-codex'))
    const screenshots = process.env.SHARE_SCREENSHOTS
    if (screenshots) { mkdirSync(screenshots, { recursive: true }); await page.screenshot({ path: join(screenshots, `${engine}-owner-${width}.png`) }); await target.screenshot({ path: join(screenshots, `${engine}-recipient-${width}.png`) }) }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false)
    await row.getByRole('button', { name: 'Ngắt chia sẻ', exact: true }).click(); await row.waitFor({ state: 'detached' })
    assert.equal((await target.reload()).status(), 401)
    // Real server expiry, short TTL through encrypted owner API; all state is under the temp root.
    const short = (await ownerApi('/api/preview-shares', 'POST', { port: appPort, ttlSeconds: 2, label: 'Expiry fixture' })).link
    await target.goto(short.url); await target.getByRole('heading', { name: 'Shared app opened' }).waitFor()
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(short.expiresAt) - Date.now()) + 50))
    assert.equal((await target.reload()).status(), 401)
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' }); assert.equal(await page.locator('#instruction').inputValue(), 'Draft preserved')
    await openMenu(); await page.getByRole('button', { name: /Khóa|Lock/ }).click(); await page.getByLabel('Khóa mã hóa riêng', { exact: true }).waitFor()
    assert.deepEqual(errors, [])
    await recipient.close(); await context.close(); console.log(`PASS ${engine} ${width}: real encrypted owner create/copy/open/revoke, fresh recipient, expiry and Lock`); evidence.push({ width, encryptedOwnerCreateCopyOpenRevoke: true, anonymousRecipient: true, expiry: true, lock: true })
  }
  assert(!nativeReads.some(m => /turn\/start|thread\/start/.test(m)))
  console.log(JSON.stringify({ passed: true, engine, evidence, realModelTurns: 0, productionAccess: false }))
} finally { for (const close of cleanup.reverse()) await close(); rmSync(root, { recursive: true, force: true }) }
