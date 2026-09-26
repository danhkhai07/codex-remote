// Encrypted owner UI with an isolated in-memory preview-share API. No real service or share is touched.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'
import { once } from 'node:events'
import { SecureApi } from '../dist-server/secure-api.js'
import { SessionRegistry } from '../dist-server/session-registry.js'
import { createSession } from '../dist-server/auth.js'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = await mkdtemp(join(tmpdir(), 'preview-shares-browser-'))
const dist = join(root, 'dist'), files = join(root, 'files'), ownerFile = join(root, 'owner.json')
const random = size => randomBytes(size).toString('base64url')
const material = { version: 1, app: random(18), generation: random(18), key: random(32) }
const issued = createSession('preview-shares-browser-secret'.repeat(3), 600, 'fixture-password')
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const waitFor = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)) } throw new Error('Timed out waiting for fixture request') }
const readJson = async req => { const parts = []; for await (const part of req) parts.push(part); return JSON.parse(Buffer.concat(parts).toString() || '{}') }
const json = (res, status, value) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' }

let browser, server, secure
try {
  await cp(resolve('dist'), dist, { recursive: true })
  await mkdir(files)
  await writeFile(ownerFile, JSON.stringify(material), { mode: 0o600 })
  const config = {
    host: '127.0.0.1', port: 0, publicOrigin: new URL('http://127.0.0.1'), password: 'fixture-password',
    sessionSecret: 'preview-shares-browser-secret'.repeat(3), sessionTtlSeconds: 600, codexBin: 'unused', production: true,
    workspaceRoots: [files], fileRoots: [files], secureApiRequired: true, secureKeyFile: ownerFile, sessionStateFile: join(root, 'sessions.json'),
  }
  const sessions = new SessionRegistry(config.sessionSecret, config.sessionStateFile, config.password)
  secure = new SecureApi(config, sessions, [files])
  const thread = {
    id: 'fixture-thread', name: 'Preview share fixture', cwd: files, createdAt: 1, updatedAt: 1, status: { type: 'idle' },
    turns: [{ id: 'history', status: 'completed', items: Array.from({ length: 42 }, (_, index) => ({ id: `message-${index}`, type: 'agentMessage', text: `Fixture message ${index} ${'keeps the transcript scrollable. '.repeat(8)}` })) }],
    historyWindow: { revision: 'fixture', older: null, messages: 42 },
  }
  const services = [
    { port: 4173, name: 'Website demo', path: '/demo', running: true },
    { port: 5173, name: 'Stopped demo', path: '/', running: false },
  ]
  let links = [], failNextGet = false, getCount = 0, createCount = 0, revokeCount = 0, createGate, revokeGate, readGate
  const reset = () => {
    const now = Date.now()
    links = [
      { id: 'active', label: 'Khách hàng', serviceName: 'Website demo', port: 4173, path: '/demo', createdAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString(), revokedAt: null, status: 'active', url: 'https://share.fixture.test/s/active#secret' },
      { id: 'expired', label: 'Bản cũ', serviceName: 'Website demo', port: 4173, path: '/', createdAt: new Date(now - 7_200_000).toISOString(), expiresAt: new Date(now - 3_600_000).toISOString(), revokedAt: null, status: 'expired' },
    ]
    failNextGet = true; getCount = 0; createCount = 0; revokeCount = 0; createGate = undefined; revokeGate = undefined; readGate = undefined
  }
  const dispatch = async (req, res) => {
    const url = new URL(req.url, 'http://fixture.local'), method = req.method || 'GET'
    if (url.pathname === '/api/session' && method === 'GET') return json(res, 200, { csrf: issued.payload.csrf, expiresAt: issued.payload.expiresAt, workspaces: [{ id: 'fixture', label: 'Fixture', path: files }] })
    if (url.pathname === '/api/threads' && method === 'GET') return json(res, 200, { data: [{ ...thread, turns: [] }] })
    if (url.pathname === '/api/threads/fixture-thread/history' && method === 'GET') return json(res, 200, { thread })
    if (url.pathname === '/api/threads/fixture-thread/resume' && method === 'POST') return json(res, 200, { thread: { ...thread, turns: [] } })
    if (url.pathname === '/api/pending' && method === 'GET') return json(res, 200, { data: [], cursor: 0, epoch: 'fixture' })
    if (url.pathname === '/api/models' && method === 'GET') return json(res, 200, { data: [{ id: 'fixture', model: 'fixture', isDefault: true, supportedReasoningEfforts: [] }] })
    if (url.pathname === '/api/read-state' && method === 'GET') return json(res, 200, { revision: 0, unread: {} })
    if (url.pathname === '/api/conversation-groups' && method === 'GET') return json(res, 200, { revision: 1, groups: [], assignments: {} })
    if (url.pathname === '/api/events' && method === 'GET') return json(res, 503, { error: 'Fixture stream disabled' })
    if (url.pathname === '/api/preview-shares' && method === 'GET') {
      getCount++
      if (readGate) await readGate.promise
      if (res.destroyed) return
      if (failNextGet) { failNextGet = false; return json(res, 503, { error: 'Không tải được fixture' }) }
      return json(res, 200, { links, services, serverNow: new Date().toISOString() })
    }
    if (url.pathname === '/api/preview-shares' && method === 'POST') {
      assert.equal(req.headers['x-csrf-token'], issued.payload.csrf); createCount++
      const body = await readJson(req)
      if (createGate) await createGate.promise
      if (res.destroyed) return
      const service = services.find(item => item.port === body.port)
      assert(service && service.running)
      assert([900, 3600, 21600, 86400].includes(body.ttlSeconds))
      const createdAt = new Date(), link = { id: `created-${createCount}`, label: body.label || '', serviceName: service.name, port: service.port, path: body.path || service.path,
        createdAt: createdAt.toISOString(), expiresAt: new Date(createdAt.getTime() + body.ttlSeconds * 1000).toISOString(), revokedAt: null, status: 'active', url: `https://share.fixture.test/s/created-${createCount}#secret` }
      links.unshift(link); return json(res, 201, { link })
    }
    const revoke = url.pathname.match(/^\/api\/preview-shares\/([^/]+)$/)
    if (revoke && method === 'DELETE') {
      assert.equal(req.headers['x-csrf-token'], issued.payload.csrf); revokeCount++
      if (revokeGate) await revokeGate.promise
      if (res.destroyed) return
      const id = decodeURIComponent(revoke[1]); links = links.map(link => link.id === id ? { ...link, status: 'revoked', revokedAt: new Date().toISOString(), url: undefined } : link)
      return json(res, 200, { ok: true })
    }
    return json(res, 404, { error: `Fixture route not found: ${method} ${url.pathname}` })
  }
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture.local')
    if (url.pathname.startsWith('/api/secure/')) { void secure.handle(req, res, dispatch); return }
    if (url.pathname.startsWith('/api/')) { json(res, 403, { error: 'Encrypted owner API required' }); return }
    void (async () => {
      const relative = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^[/\\]+/, '')
      let path = join(dist, relative)
      try { if (!(await stat(path)).isFile()) path = join(dist, 'index.html') } catch { path = join(dist, 'index.html') }
      const bytes = await readFile(path); res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream'); res.end(bytes)
    })().catch(error => json(res, 500, { error: error.message }))
  })
  server.listen(0, config.host); await once(server, 'listening')
  config.port = server.address().port; config.publicOrigin = new URL(`http://127.0.0.1:${config.port}`)
  browser = await chromium.launch({ headless: true })
  const screenshots = process.env.PREVIEW_SHARES_SCREENSHOTS
  if (screenshots) await mkdir(screenshots, { recursive: true })

  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
    reset()
    const context = await browser.newContext({ viewport, serviceWorkers: 'allow', permissions: ['clipboard-read', 'clipboard-write'] })
    await context.addCookies([{ name: 'codex_remote_session', value: issued.token, url: config.publicOrigin.origin, httpOnly: true, sameSite: 'Strict' }])
    await context.route('https://share.fixture.test/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Shared fixture</h1>' }))
    const page = await context.newPage(), errors = []
    page.setDefaultTimeout(20_000); page.on('pageerror', error => errors.push(error.message))
    await page.goto(config.publicOrigin.origin)
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
    const unlock = page.getByLabel('Khóa mã hóa riêng', { exact: true })
    try { await unlock.waitFor() } catch (error) { console.error(JSON.stringify({ url: page.url(), body: await page.locator('body').innerText(), errors })); throw error }
    await unlock.fill(material.key)
    await page.getByRole('button', { name: 'Mở khóa', exact: true }).click()
    const composer = page.locator('#instruction')
    try { await composer.waitFor() } catch (error) { console.error(JSON.stringify({ stage: 'app', url: page.url(), body: await page.locator('body').innerText(), errors })); throw error }
    await composer.fill(`Bản nháp ${viewport.width} vẫn giữ nguyên`)
    const transcript = page.locator('.workspace-content'); await transcript.waitFor(); await transcript.evaluate(element => { element.scrollTop = 450 })
    const scrollBefore = await transcript.evaluate(element => element.scrollTop)
    const openMenu = async () => {
      if (viewport.width < 800 && !await page.locator('.thread-sidebar').evaluate(element => element.classList.contains('is-open'))) await page.getByRole('button', { name: 'Open conversations', exact: true }).click()
      await page.getByLabel('Settings', { exact: true }).click()
    }

    assert.equal(getCount, 0, 'collapsed gear menu must not load private share data')
    await openMenu(); await page.getByRole('button', { name: 'Link chia sẻ', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Link chia sẻ', exact: true }); await dialog.waitFor()
    await dialog.getByRole('alert').filter({ hasText: 'Không tải được fixture' }).waitFor()
    await dialog.getByRole('button', { name: 'Thử lại', exact: true }).click()
    const serviceSelect = dialog.locator('select').nth(0), lifetimeSelect = dialog.locator('select').nth(1)
    try { await serviceSelect.waitFor() } catch (error) { console.error(JSON.stringify({ stage: 'shares-retry', getCount, body: await dialog.innerText(), errors })); throw error }
    assert.equal(await serviceSelect.inputValue(), '4173')
    assert.equal(await lifetimeSelect.inputValue(), '3600')
    assert.equal(await dialog.getByRole('button', { name: 'Ngắt chia sẻ', exact: true }).count(), 1)
    const history = dialog.locator('.preview-shares-history'); assert.equal(await history.getAttribute('open'), null)
    assert.equal(await history.getByText('Bản cũ', { exact: true }).isVisible(), false)
    const requestsAfterLoad = getCount; await page.waitForTimeout(120); assert.equal(getCount, requestsAfterLoad, 'clock must not poll the API')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false)
    if (screenshots) await page.screenshot({ path: join(screenshots, `preview-shares-${viewport.width}.png`), fullPage: true })

    createGate = deferred()
    await dialog.getByLabel(/Tên gợi nhớ/).fill('Bản gửi khách')
    await lifetimeSelect.selectOption('900')
    const create = dialog.locator('.preview-shares-submit')
    await create.click(); await create.dispatchEvent('click'); await waitFor(() => createCount === 1)
    assert.equal(await create.isDisabled(), true); createGate.resolve(); await dialog.getByText('Bản gửi khách', { exact: true }).waitFor()
    assert.equal(createCount, 1, 'double submit creates only one link')
    await dialog.locator('.preview-share-list > li').filter({ hasText: 'Bản gửi khách' }).getByRole('button', { name: 'Sao chép', exact: true }).click()
    await dialog.getByText(/Đã sao chép link Bản gửi khách/).waitFor()
    const popupPromise = context.waitForEvent('page')
    await dialog.locator('.preview-share-list > li').filter({ hasText: 'Bản gửi khách' }).getByRole('link', { name: 'Mở', exact: true }).click()
    const popup = await popupPromise; await popup.getByText('Shared fixture', { exact: true }).waitFor(); await popup.close()

    revokeGate = deferred()
    const active = dialog.locator('.preview-shares-active .preview-share-list > li').filter({ hasText: 'Khách hàng' })
    const revoke = active.locator('.danger-button')
    await revoke.click(); await revoke.dispatchEvent('click'); await waitFor(() => revokeCount === 1)
    assert.equal(await revoke.isDisabled(), true); revokeGate.resolve(); await active.waitFor({ state: 'detached' })
    assert.equal(revokeCount, 1, 'double revoke sends only one mutation')

    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' })
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Settings')
    assert.equal(await composer.inputValue(), `Bản nháp ${viewport.width} vẫn giữ nguyên`)
    assert.equal(await transcript.evaluate(element => element.scrollTop), scrollBefore)

    // A request held past popup lifetime is aborted and cannot repaint a closed dialog.
    readGate = deferred(); await openMenu(); await page.getByRole('button', { name: 'Link chia sẻ', exact: true }).click(); await waitFor(() => getCount === requestsAfterLoad + 1)
    await page.getByRole('button', { name: 'Đóng quản lý link chia sẻ', exact: true }).click(); readGate.resolve()
    await page.waitForTimeout(80); assert.equal(await page.getByRole('dialog', { name: 'Link chia sẻ', exact: true }).count(), 0)
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`PASS ${viewport.width}: encrypted lazy load, retry, create/copy/open/revoke, focus, draft and abort`)
  }
  console.log(JSON.stringify({ encryptedOwnerApi: true, realShares: 0, realModelTurns: 0, viewports: [1280, 390, 320] }))
} finally {
  await browser?.close()
  secure?.close()
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await rm(root, { recursive: true, force: true })
}
