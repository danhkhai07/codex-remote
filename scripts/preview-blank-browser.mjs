import { historyFixtureConfig, persistedFixtureThread } from '../server/fixtures/history-store.mjs'
// Disposable encrypted gateway + Services registry + localhost app only. No model turn or live state.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer, request } from 'node:http'
import { createServer as createSecureServer } from 'node:https'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { once } from 'node:events'
import { connect } from 'node:net'
import { createRemoteHttpServer } from '../dist-server/http-app.js'
import { RemoteController } from '../dist-server/controller.js'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
import { ContextVault } from '../dist-server/context-vault.js'
import { ServicesStore } from '../dist-server/services.js'

const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || '/tmp/working-hours-browser/node_modules/playwright/index.mjs')
const root = await mkdtemp(join(tmpdir(), 'services-middle-click-'))
const dist = join(root, 'dist')
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const reservePort = async () => { const server = createServer(); const port = await listen(server); await new Promise(resolve => server.close(resolve)); return port }
const random = size => randomBytes(size).toString('base64url')
const material = { version: 1, app: random(18), generation: random(18), key: random(32) }
let gateway, ingress, preview, browser, proxy
const proxySockets = new Set()

try {
  await cp(resolve('dist'), dist, { recursive: true })
  const files = join(root, 'files'); await mkdir(files)
  const keyFile = join(root, 'owner.json'); await writeFile(keyFile, JSON.stringify(material), { mode: 0o600 })
  const tlsKey = join(root, 'fixture.key'), tlsCert = join(root, 'fixture.crt')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=fixture.test', '-addext', 'subjectAltName=DNS:fixture.test,DNS:*.fixture.test', '-keyout', tlsKey, '-out', tlsCert], { stdio: 'ignore' })
  preview = createServer((req, res) => {
    if (req.url === '/frame-denied') res.setHeader('Content-Security-Policy', "frame-ancestors 'none'")
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<title>Preview service fixture</title><h1>PREVIEW SERVICE ${req.url}</h1>`)
  })
  const previewPort = await listen(preview)
  const gatewayPort = await reservePort(), backendPort = await reservePort(), stoppedPort = await reservePort()
  const services = new ServicesStore(join(root, 'services.json'))
  const common = { summary: 'Disposable browser fixture', prLabel: 'No PR', prUrl: '', branch: 'fixture', directory: root, kind: 'app' }
  services.upsert({ ...common, port: previewPort, path: '/workspace?from=services', name: 'Running preview' })
  services.upsert({ ...common, port: stoppedPort, path: '/', name: 'Stopped preview' })
  services.upsert({ ...common, port: gatewayPort, path: '/', name: 'Rejected preview' })
  services.upsert({ ...common, port: null, path: '/services?fixture=internal', name: 'Internal page' })
  const config = {
    ...historyFixtureConfig(), host: '127.0.0.1', port: gatewayPort, publicOrigin: new URL(`https://remote.fixture.test:${gatewayPort}`),
    password: 'FAKE services browser password', sessionSecret: 'fake-services-session-secret'.repeat(3), sessionTtlSeconds: 600,
    codexBin: 'unused', production: true, workspaceRoots: [files], fileRoots: [files], secureApiRequired: true,
    secureKeyFile: keyFile, sessionStateFile: join(root, 'sessions.json'), previewOriginTemplate: `https://p{port}.fixture.test:${gatewayPort}`,
  }
  const native = new CodexAppServer('unused'), nativeCalls = []
  const fakeThread = id => persistedFixtureThread({ id, name: `Preview convo ${id}`, cwd: files, createdAt: 1, updatedAt: 1, status: { type: 'idle' }, turns: [{ id: 'history', status: 'completed', items: [{ id: `${id}-answer`, type: 'agentMessage', phase: 'final_answer', text: 'Conversation fixture history' }] }] })
  native.request = async (method, params = {}) => {
    nativeCalls.push(method)
    if (method === 'thread/list') return { data: ['a', 'b'].map(id => ({ ...fakeThread(id), turns: [] })), nextCursor: null }
    if (['thread/read', 'thread/resume'].includes(method)) return { thread: { ...fakeThread(params.threadId), turns: [] } }
    if (method === 'thread/turns/list') return { data: [{ id: 'history', status: 'completed', items: [] }], nextCursor: null }
    if (method === 'model/list') return { data: [] }
    if (method === 'account/rateLimits/read') return { rateLimits: {} }
    throw Error(`Forbidden or unexpected fake RPC: ${method}`)
  }
  gateway = createRemoteHttpServer(config, new RemoteController(config, native, new ContextVault(join(root, 'vault'))), dist, null, undefined, undefined, undefined, undefined, undefined, services)
  gateway.listen(backendPort, config.host); await once(gateway, 'listening')
  ingress = createSecureServer({ key: await readFile(tlsKey), cert: await readFile(tlsCert) }, (incoming, outgoing) => {
    const upstream = request({ host: '127.0.0.1', port: backendPort, method: incoming.method, path: incoming.url, headers: incoming.headers }, response => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers)
      response.pipe(outgoing)
    })
    upstream.on('error', error => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(error.message) })
    incoming.pipe(upstream)
  })
  ingress.listen(gatewayPort, config.host); await once(ingress, 'listening')

  proxy = createServer((_req, res) => { res.writeHead(403); res.end() })
  proxy.on('connect', (req, socket, head) => {
    if (!new RegExp(`^[a-z0-9]+\\.fixture\\.test:${gatewayPort}$`).test(req.url || '')) { socket.destroy(); return }
    const target = connect(gatewayPort, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) target.write(head)
      socket.pipe(target).pipe(socket)
    })
    for (const s of [socket, target]) { proxySockets.add(s); s.once('close', () => proxySockets.delete(s)) }
    socket.on('error', () => target.destroy()); target.on('error', () => socket.destroy())
    socket.on('close', () => target.destroy()); target.on('close', () => socket.destroy())
  })
  const proxyPort = await listen(proxy)
  const results = []
  for (const engine of (process.env.PREVIEW_ENGINES || 'chromium,webkit').split(',')) {
    browser = await (engine === 'chromium' ? chromium : webkit).launch({ headless: true,
      ...(engine === 'chromium' ? { args: ['--no-proxy-server', '--ignore-certificate-errors', '--host-resolver-rules=MAP *.fixture.test 127.0.0.1'] } : { proxy: { server: `http://127.0.0.1:${proxyPort}` } }),
    })
    for (const viewport of (process.env.PREVIEW_WIDTHS || '1280,390').split(',').map(Number).map(width => ({ width, height: width === 1280 ? 800 : 844 }))) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'allow', ignoreHTTPSErrors: true })
      const page = await context.newPage(); page.setDefaultTimeout(15000)
      const errors = [], navigation = [], failures = []; page.on('pageerror', e => errors.push(e.message.replace(/ticket=[^&\s]+/gi, 'ticket=[redacted]')))
      const safeUrl = value => { try { const u = new URL(value); return { host: u.host, path: u.pathname } } catch { return { invalid: true } } }
      page.on('response', response => { if (response.request().resourceType() === 'document') navigation.push({ ...safeUrl(response.url()), status: response.status() }) })
      page.on('requestfailed', request => failures.push({ ...safeUrl(request.url()), error: request.failure()?.errorText }))
      await page.goto(config.publicOrigin.origin + '/services')
      if (engine === 'webkit') await page.getByRole('button', { name: 'Đăng nhập lại', exact: true }).waitFor().catch(async error => { console.error(JSON.stringify({ engine, body: (await page.locator('body').innerText()).slice(0, 600) })); throw error })
      if (engine === 'chromium') await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
      await page.getByRole('button', { name: 'Đăng nhập lại', exact: true }).click()
      await page.getByLabel('Mật khẩu đăng nhập', { exact: true }).fill(config.password)
      await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
      await page.getByLabel('Khóa mã hóa riêng', { exact: true }).fill(material.key)
      await page.getByRole('button', { name: 'Mở khóa', exact: true }).click()
      const card = name => page.locator('.service-card').filter({ has: page.getByRole('heading', { name, exact: true }) })
      const open = () => card('Running preview').getByRole('button', { name: 'Mở trong Browser', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Browser', exact: true })
      const iframe = dialog.locator('iframe')
      const content = () => iframe.contentFrame().getByText('PREVIEW SERVICE /workspace?from=services', { exact: true })
      await open()
      let freshOpen = true, externalVisitRecovery = false
      if (engine === 'webkit') {
        await iframe.contentFrame().locator('body').waitFor()
        await page.waitForFunction(() => !document.querySelector('.localhost-preview-loading'))
        freshOpen = await content().isVisible()
        if (!freshOpen) {
          assert.equal(await iframe.contentFrame().locator('body').innerText(), 'Open this localhost preview from Codex Remote to sign in.')
          assert(navigation.some(r => r.path === '/workspace' && r.status === 401))
          const diagnostic = { engine, viewport, navigation: [...navigation], failures: [...failures], frameStatus: 401, previewCookieSet: (await context.cookies()).some(c => c.name === '__Host-codex_preview_session'), frameBox: await iframe.boundingBox() }
          console.log(JSON.stringify({ freshWebkitDiagnostic: diagnostic }))
          if (process.env.PREVIEW_BLANK_EVIDENCE) await page.screenshot({ path: join(process.env.PREVIEW_BLANK_EVIDENCE, `${engine}-${viewport.width}-open-failure.png`) })
          // Diagnostic only: existing external action exercises first-party cookie
          // establishment. Do not alter security/cookie/origin policy or seed cookies.
          const opened = context.waitForEvent('page')
          await dialog.getByRole('button', { name: 'Mở tab ngoài', exact: true }).click()
          const tab = await opened; await tab.getByText('PREVIEW SERVICE /workspace?from=services', { exact: true }).waitFor()
          await tab.close()
          await dialog.getByRole('button', { name: 'Tải lại trang', exact: true }).click()
          await content().waitFor(); externalVisitRecovery = true
        }
      } else await content().waitFor()
      const firstSrc = await iframe.getAttribute('src')
      const box = await iframe.boundingBox(); assert(box && box.height > viewport.height / 2 && box.width > viewport.width * .9)
      await dialog.getByRole('button', { name: 'Tải lại trang', exact: true }).click()
      await page.waitForFunction(src => document.querySelector('.localhost-preview iframe')?.getAttribute('src') !== src, firstSrc)
      await content().waitFor()
      await dialog.getByRole('button', { name: 'Đóng Browser', exact: true }).click()
      await page.getByRole('button', { name: 'Browser ↗', exact: true }).click()
      await content().waitFor()
      await dialog.getByRole('button', { name: 'Đóng Browser', exact: true }).click()
      await card('Internal page').getByRole('button', { name: 'Mở trong Browser', exact: true }).click()
      await iframe.contentFrame().getByLabel('Khóa mã hóa riêng', { exact: true }).waitFor()
      const internalVisible = await iframe.contentFrame().getByLabel('Khóa mã hóa riêng', { exact: true }).isVisible()
      await dialog.getByTitle('Đổi địa chỉ', { exact: true }).click()
      await dialog.getByLabel('Địa chỉ trang', { exact: true }).fill(`http://localhost:${previewPort}/frame-denied`)
      await dialog.getByRole('button', { name: 'Mở trang', exact: true }).click()
      await page.waitForTimeout(1500)
      const blocked = { loading: await dialog.getByRole('status').count(), alert: await dialog.getByRole('alert').count(), iframeCount: await iframe.count(), body: await iframe.contentFrame().locator('body').innerText({ timeout: 1000 }).catch(() => null) }
      if (process.env.PREVIEW_BLANK_EVIDENCE) { await mkdir(process.env.PREVIEW_BLANK_EVIDENCE, { recursive: true }); await page.screenshot({ path: join(process.env.PREVIEW_BLANK_EVIDENCE, `${engine}-${viewport.width}-blocked.png`) }) }
      assert.equal(blocked.loading, 0); assert.equal(blocked.alert, 0); assert.equal(blocked.body, '')
      await dialog.getByRole('button', { name: 'Đóng Browser', exact: true }).click()
      await page.goto(config.publicOrigin.origin)
      await page.getByLabel('Khóa mã hóa riêng', { exact: true }).fill(material.key)
      await page.getByRole('button', { name: 'Mở khóa', exact: true }).click()
      await page.getByText('Conversation fixture history', { exact: true }).waitFor()
      const chooseThread = async name => {
        if (await page.locator('.thread-row-entry.is-selected .thread-row').filter({ hasText: name }).count()) return
        if (viewport.width < 800 && !(await page.locator('.thread-sidebar.is-open').count())) await page.getByRole('button', { name: 'Open conversations', exact: true }).click()
        await page.locator('.thread-row').filter({ hasText: name }).click()
      }
      await chooseThread('Preview convo a')
      const composer = page.locator('#instruction')
      await composer.fill('Preview diagnostic draft')
      await page.getByRole('button', { name: 'Browser', exact: true }).click()
      await dialog.getByLabel('Địa chỉ trang', { exact: true }).fill(`http://localhost:${previewPort}/conversation-a`)
      await dialog.getByRole('button', { name: 'Mở trang', exact: true }).click()
      await iframe.contentFrame().getByText('PREVIEW SERVICE /conversation-a', { exact: true }).waitFor()
      // Whole-app reload restores an address, never the consumed launch ticket.
      const oldSrc = await iframe.getAttribute('src')
      await page.reload()
      await page.getByLabel('Khóa mã hóa riêng', { exact: true }).fill(material.key)
      await page.getByRole('button', { name: 'Mở khóa', exact: true }).click()
      await iframe.contentFrame().getByText('PREVIEW SERVICE /conversation-a', { exact: true }).waitFor()
      assert.notEqual(await iframe.getAttribute('src'), oldSrc)
      await dialog.getByRole('button', { name: 'Đóng Browser', exact: true }).click()
      assert.equal(await composer.inputValue(), 'Preview diagnostic draft')
      await chooseThread('Preview convo b')
      await page.getByRole('button', { name: 'Browser', exact: true }).click()
      assert.equal(await dialog.getByLabel('Địa chỉ trang', { exact: true }).inputValue(), '')
      assert.equal(await iframe.count(), 0)
      await dialog.getByRole('button', { name: 'Đóng Browser', exact: true }).click()
      await chooseThread('Preview convo a')
      await page.getByRole('button', { name: 'Browser', exact: true }).click()
      await iframe.contentFrame().getByText('PREVIEW SERVICE /conversation-a', { exact: true }).waitFor()
      assert(!nativeCalls.includes('turn/start'))
      results.push({ engine, viewport, liveArtifactReuse: true, freshOpen, externalVisitRecovery, reloadFreshTicket: true, cachedAddressReopen: true, iframeBox: box, internalLockedUiVisible: internalVisible, conversationReloadFreshTicket: true, conversationScopedAddress: true, draftPreserved: true, realModelTurns: 0, blocked, pageErrorCount: errors.length, pageErrors: errors })
      console.log(JSON.stringify(results.at(-1)))
      await context.close()
    }
    await browser.close(); browser = null
  }
  if (process.env.PREVIEW_BLANK_EVIDENCE) await writeFile(join(process.env.PREVIEW_BLANK_EVIDENCE, `result-${process.env.PREVIEW_ENGINES || 'all'}-${process.env.PREVIEW_WIDTHS || 'all'}.json`), JSON.stringify(results, null, 2)+'\n')
} finally {
  await browser?.close()
  for (const socket of proxySockets) socket.destroy()
  if (proxy) await new Promise(resolve => proxy.close(resolve))
  if (ingress) { ingress.closeAllConnections(); await new Promise(resolve => ingress.close(resolve)) }
  if (gateway) { gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve)) }
  if (preview) { preview.closeAllConnections(); await new Promise(resolve => preview.close(resolve)) }
  await rm(root, { recursive: true, force: true })
}
