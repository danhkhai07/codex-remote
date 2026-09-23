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
import { createRemoteHttpServer } from '../dist-server/http-app.js'
import { RemoteController } from '../dist-server/controller.js'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
import { ServicesStore } from '../dist-server/services.js'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = await mkdtemp(join(tmpdir(), 'services-middle-click-'))
const dist = join(root, 'dist')
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const reservePort = async () => { const server = createServer(); const port = await listen(server); await new Promise(resolve => server.close(resolve)); return port }
const random = size => randomBytes(size).toString('base64url')
const material = { version: 1, app: random(18), generation: random(18), key: random(32) }
let gateway, ingress, preview, browser

try {
  await cp(resolve('dist'), dist, { recursive: true })
  const files = join(root, 'files'); await mkdir(files)
  const keyFile = join(root, 'owner.json'); await writeFile(keyFile, JSON.stringify(material), { mode: 0o600 })
  const tlsKey = join(root, 'fixture.key'), tlsCert = join(root, 'fixture.crt')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=fixture.test', '-addext', 'subjectAltName=DNS:fixture.test,DNS:*.fixture.test', '-keyout', tlsKey, '-out', tlsCert], { stdio: 'ignore' })
  preview = createServer((req, res) => {
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
    host: '127.0.0.1', port: gatewayPort, publicOrigin: new URL(`https://remote.fixture.test:${gatewayPort}`),
    password: 'FAKE services browser password', sessionSecret: 'fake-services-session-secret'.repeat(3), sessionTtlSeconds: 600,
    codexBin: 'unused', production: true, workspaceRoots: [files], fileRoots: [files], secureApiRequired: true,
    secureKeyFile: keyFile, sessionStateFile: join(root, 'sessions.json'), previewOriginTemplate: `https://p{port}.fixture.test:${gatewayPort}`,
  }
  gateway = createRemoteHttpServer(config, new RemoteController(config, new CodexAppServer('unused')), dist, null, undefined, undefined, undefined, undefined, undefined, services)
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
  browser = await chromium.launch({
    headless: true,
    // Keep admin and preview on separate origins under one registrable site so
    // SameSite=Strict preview cookies behave like remote.danhkhai.io.vn / p*.danhkhai.io.vn.
    args: [
      '--no-proxy-server',
      '--ignore-certificate-errors',
      '--host-resolver-rules=MAP *.fixture.test 127.0.0.1',
    ],
  })
  const screenshots = process.env.SERVICES_MIDDLE_SCREENSHOTS

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'allow', ignoreHTTPSErrors: true })
    const page = await context.newPage(), errors = [], privateBodies = [], previewLaunches = [], failed = []
    page.setDefaultTimeout(20_000)
    page.on('pageerror', error => errors.push(error.message))
    page.on('requestfailed', request => failed.push({ url: request.url(), error: request.failure()?.errorText }))
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/secure/request') privateBodies.push(request.postData() ?? '')
      if (new URL(request.url()).pathname === '/api/localhost-preview') previewLaunches.push(request.url())
    })
    await page.goto(config.publicOrigin.origin + '/services')
    if (!await page.evaluate(() => 'serviceWorker' in navigator)) {
      throw new Error(`fixture origin is not service-worker capable: ${JSON.stringify(await page.evaluate(() => ({ href: location.href, secure: isSecureContext, body: document.body.innerText.slice(0, 300) })))}`)
    }
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
    await page.getByRole('button', { name: 'Đăng nhập lại', exact: true }).click()
    await page.getByLabel('Mật khẩu đăng nhập', { exact: true }).fill(config.password)
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    await page.getByLabel('Khóa mã hóa riêng', { exact: true }).fill(material.key)
    await page.getByRole('button', { name: 'Mở khóa', exact: true }).click()
    const card = name => page.locator('.service-card').filter({ has: page.getByRole('heading', { name, exact: true }) })
    await card('Running preview').waitFor()

    // Left click retains the existing embedded Browser behavior and uses one ticket.
    const requestsBeforeEmbed = privateBodies.length
    await card('Running preview').getByRole('button', { name: 'Mở trong Browser', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Browser', exact: true })
    const embedded = dialog.locator('iframe'); await embedded.waitFor()
    try { await embedded.contentFrame().getByText('PREVIEW SERVICE /workspace?from=services', { exact: true }).waitFor() }
    catch (error) {
      console.error(JSON.stringify({ iframe: await embedded.getAttribute('src'), body: await embedded.contentFrame().locator('body').innerText().catch(() => ''), failed }))
      throw error
    }
    assert.equal(privateBodies.length, requestsBeforeEmbed + 1)
    await dialog.getByRole('button', { name: 'Đóng Browser', exact: true }).click()

    // Middle click reserves a real tab synchronously, then exchanges its own fresh one-use ticket.
    const requestsBeforeTab = privateBodies.length
    const tabPromise = context.waitForEvent('page')
    await card('Running preview').getByRole('button', { name: 'Mở trong Browser', exact: true }).click({ button: 'middle' })
    const tab = await tabPromise
    await tab.getByText('PREVIEW SERVICE /workspace?from=services', { exact: true }).waitFor()
    assert.equal(new URL(tab.url()).hostname, `p${previewPort}.fixture.test`)
    assert.equal(new URL(tab.url()).pathname, '/workspace')
    assert(!tab.url().includes('ticket='), 'one-use launch ticket must not remain in the visible URL')
    assert.equal(privateBodies.length, requestsBeforeTab + 1)
    await tab.close()

    // Internal paths need no preview ticket and still open in a separate locked tab.
    const launchesBeforeInternal = privateBodies.length
    const internalPromise = context.waitForEvent('page')
    await card('Internal page').getByRole('button', { name: 'Mở trong Browser', exact: true }).click({ button: 'middle' })
    const internal = await internalPromise
    await internal.waitForURL('**/services?fixture=internal')
    await internal.getByLabel('Khóa mã hóa riêng', { exact: true }).waitFor()
    assert.equal(privateBodies.length, launchesBeforeInternal)
    await internal.close()

    // A server rejection closes the reserved blank tab and reports the error in Services.
    const requestsBeforeRejected = privateBodies.length
    const rejectedPromise = context.waitForEvent('page')
    await card('Rejected preview').getByRole('button', { name: 'Mở trong Browser', exact: true }).click({ button: 'middle' })
    const rejected = await rejectedPromise
    await rejected.waitForEvent('close')
    await page.getByRole('alert').filter({ hasText: 'reserved' }).waitFor()
    assert.equal(privateBodies.length, requestsBeforeRejected + 1)

    await page.evaluate(() => { window.fixtureOpen = window.open; window.open = () => null })
    await card('Internal page').getByRole('button', { name: 'Mở trong Browser', exact: true }).dispatchEvent('auxclick', { button: 1 })
    await page.getByRole('alert').filter({ hasText: 'chặn tab mới' }).waitFor()
    await page.evaluate(() => { window.open = window.fixtureOpen; delete window.fixtureOpen })

    const stopped = card('Stopped preview').getByRole('button', { name: 'Mở trong Browser', exact: true })
    assert(await stopped.isDisabled())
    const pageCount = context.pages().length, requestsBeforeDisabled = privateBodies.length
    await stopped.dispatchEvent('auxclick', { button: 1 })
    await card('Internal page').getByRole('button', { name: 'Mở trong Browser', exact: true }).dispatchEvent('auxclick', { button: 2 })
    await page.waitForTimeout(50)
    assert.equal(context.pages().length, pageCount); assert.equal(privateBodies.length, requestsBeforeDisabled)
    assert(privateBodies.every(body => !body.includes(material.key)), 'owner key must never appear in request bodies')
    assert.deepEqual(errors, [])
    if (screenshots) {
      await mkdir(screenshots, { recursive: true })
      await page.evaluate(() => scrollTo(0, 0))
      await page.screenshot({ path: join(screenshots, `services-middle-${viewport.width}.png`) })
    }
    assert.equal(previewLaunches.length, 0, 'required mode must carry ticket requests only inside encrypted envelopes')
    await context.close()
    console.log(`PASS ${viewport.width}: left embed, middle new tab/ticket, internal path, rejected and stopped service`)
  }
} finally {
  await browser?.close()
  if (ingress) { ingress.closeAllConnections(); await new Promise(resolve => ingress.close(resolve)) }
  if (gateway) { gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve)) }
  if (preview) { preview.closeAllConnections(); await new Promise(resolve => preview.close(resolve)) }
  await rm(root, { recursive: true, force: true })
}
