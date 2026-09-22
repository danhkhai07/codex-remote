// Real accepted gateway + Workboard + staged Nginx. Owned fake data/keys only.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, cp, readFile, writeFile, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer, request as httpRequest } from 'node:http'
import { request } from 'node:https'
import { once } from 'node:events'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomBytes } from 'node:crypto'
import { createServer as createVite } from 'vite'
import { createRemoteHttpServer } from '../../dist-server/http-app.js'
import { RemoteController } from '../../dist-server/controller.js'
import { CodexAppServer } from '../../dist-server/codex-app-server.js'
import { maintenanceClient } from '../secure-maintenance.mjs'
import { startNginxFixture, hostNginxIdentity } from '../nginx-fixture.mjs'
import { APP, HOSTS, fileHash } from './common.mjs'

const run = promisify(execFile), pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port }
const unused = async () => { const server = createServer(), port = await listen(server); await new Promise(resolve => server.close(resolve)); return port }
const staged = resolve(process.argv[2]), evidence = resolve(process.argv[3])
const root = await mkdtemp(join(tmpdir(), 'workboard-gateway-readiness-'))
const candidate = '/root/WORKTREES/workboard-isolated-preview'
const password = 'FAKE Workboard readiness password'
const hostIdentity = await hostNginxIdentity()
let fixture, gateway, workboard, browser, client, vite, other
const summary = { app: APP, productionMutation: false, actualModelTurns: 0, harnessAdminOnly: true }
try {
  const inventory = JSON.parse(await readFile('/tmp/cr-secure-api-review-fixes-candidate-manifest.json', 'utf8'))
  assert.equal(inventory.commit, APP)
  for (const item of inventory.groups.backend) assert.equal(fileHash(resolve(item.path)), item.sha256, 'accepted backend fixture drift:' + item.path)
  await mkdir(evidence, { recursive: true, mode: 0o700 }); await chmod(root, 0o755)
  const files = join(root, 'files'), board = join(root, 'board'), privateRoot = join(root, 'private')
  for (const path of [files, board, privateRoot]) await mkdir(path, { mode: 0o700 })
  assert.equal(fileHash(join(staged, 'infra/workboard-server.py')), '4ef0bc4b12a9b2bff9b6149881e9c7becfa38f367dffbf23e3594cc6a0f18354')
  await cp(join(staged, 'infra/workboard-server.py'), join(board, 'server.py'))
  await cp(join(candidate, 'public'), join(board, 'public'), { recursive: true })
  await cp(join(candidate, 'tests'), join(board, 'tests'), { recursive: true, filter: source => !source.includes('__pycache__') })
  await cp(join(candidate, 'tests/fixture-seed.json'), join(board, 'seed.json'))
  const unit = await run('python3', ['-B', '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_server.py'], { cwd: board, timeout: 60000 })
  await writeFile(join(evidence, 'workboard-unit.log'), unit.stdout + unit.stderr); assert.match(unit.stderr, /Ran 10 tests/)
  const boardPort = await unused(), vitePort = await unused(), gatewayPort = await unused(), tlsPort = await unused(), httpPort = await unused()
  const adminHost = 'codex.fixture.test', adminOrigin = `https://${adminHost}:${tlsPort}`
  const boardHost = `p${boardPort}.fixture.test`, boardOrigin = `https://${boardHost}:${tlsPort}`
  const viteHost = `p${vitePort}.fixture.test`
  workboard = spawn('python3', ['-B', 'server.py'], { cwd: board, env: { PATH: process.env.PATH, WORKBOARD_PORT: String(boardPort), WORKBOARD_DATA: join(board, 'data'), WORKBOARD_ORIGIN: `http://127.0.0.1:${boardPort}`, WORKBOARD_FRAME_ANCESTOR: adminOrigin, WORKBOARD_SECURE_COOKIE: '1', WORKBOARD_INITIAL_PASSWORD: password }, stdio: 'ignore' })
  for (let n = 0; ; n++) { try { if ((await fetch(`http://127.0.0.1:${boardPort}/workboard/`)).ok) break } catch {} if (n > 100) throw Error('Workboard startup'); await pause(30) }
  const viteRoot = join(root, 'vite'); await mkdir(viteRoot)
  await writeFile(join(viteRoot, 'index.html'), '<html><body><script type="module" src="/main.js"></script></body></html>')
  await writeFile(join(viteRoot, 'main.js'), `import { value } from './dep.js'; document.body.dataset.version=value; if(import.meta.hot)import.meta.hot.accept('./dep.js',m=>{document.body.dataset.version=m.value});`)
  await writeFile(join(viteRoot, 'dep.js'), 'export const value="one";')
  await writeFile(join(viteRoot, 'evil.html'), `<html><body><iframe src="${boardOrigin}/workboard/"></iframe></body></html>`)
  vite = await createVite({ configFile: false, root: viteRoot, logLevel: 'error', server: { host: '127.0.0.1', port: vitePort, strictPort: true, watch: { usePolling: true, interval: 100 }, hmr: { protocol: 'wss', host: viteHost, clientPort: tlsPort } } }); await vite.listen()
  const key = join(privateRoot, 'owner.json')
  await writeFile(key, JSON.stringify({ version: 1, app: randomBytes(24).toString('base64url'), generation: randomBytes(24).toString('base64url'), key: randomBytes(32).toString('base64url') }), { mode: 0o600 })
  const config = { host: '127.0.0.1', port: gatewayPort, publicOrigin: new URL(adminOrigin), password: 'FAKE gateway password', sessionSecret: 'FAKE gateway secret'.repeat(4), sessionTtlSeconds: 600, workspaceRoots: [files], fileRoots: [files], production: true, previewOriginTemplate: `https://p{port}.fixture.test:${tlsPort}`, sessionStateFile: join(privateRoot, 'sessions.json'), secureApiRequired: true, secureKeyFile: key }
  const controller = new RemoteController(config, new CodexAppServer('unused'))
  gateway = createRemoteHttpServer(config, controller, files, null)
  const traffic = []
  gateway.prependListener('request', (req, res) => {
    let bytes = 0; const write = res.write.bind(res), end = res.end.bind(res)
    res.write = (chunk, ...args) => { if (chunk) bytes += Buffer.byteLength(chunk); return write(chunk, ...args) }
    res.end = (chunk, ...args) => { if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) bytes += Buffer.byteLength(chunk); return end(chunk, ...args) }
    res.on('finish', () => traffic.push({ host: req.headers.host, path: req.url?.split('?')[0], status: res.statusCode, bytes }))
  })
  gateway.listen(gatewayPort, '127.0.0.1'); await once(gateway, 'listening')
  client = await maintenanceClient(config)
  const launch = async (port, path = '/') => {
    const response = await client.fetch('/api/localhost-preview', { method: 'POST', body: JSON.stringify({ port, path }) }); assert.equal(response.status, 201); return (await response.json()).url
  }
  await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(root, 'key.pem'), '-out', join(root, 'cert.pem'), '-days', '1', '-subj', '/CN=fixture.test', '-addext', 'subjectAltName=DNS:*.fixture.test'], { timeout: 15000 })
  await chmod(join(root, 'key.pem'), 0o644); await chmod(join(root, 'cert.pem'), 0o644) // Throwaway TLS only; restricted Nginx must read it.
  const ca = await readFile(join(root, 'cert.pem')), cf = await readFile(join(staged, 'infra/cloudflare-real-ip.conf'), 'utf8')
  const translate = text => text.replaceAll('p5180.danhkhai.io.vn', boardHost).replaceAll('p5210.danhkhai.io.vn', viteHost).replaceAll('codex.danhkhai.io.vn', adminHost).replaceAll('.danhkhai.io.vn', '.fixture.test')
    .replace(/listen \[::\]:443 ssl[^;]*;[^\n]*/g, `listen [::1]:${tlsPort} ssl ipv6only=on;`).replace(/listen \[::\]:80;/g, `listen [::1]:${httpPort};`)
    .replace(/listen 443 ssl;/g, `listen 127.0.0.1:${tlsPort} ssl;`).replace(/listen 80;/g, `listen 127.0.0.1:${httpPort};`)
    .replace(/ssl_certificate [^;]+;/g, `ssl_certificate ${root}/cert.pem;`).replace(/ssl_certificate_key [^;]+;/g, `ssl_certificate_key ${root}/key.pem;`)
    .replace(/include \/etc\/letsencrypt\/options-ssl-nginx.conf;/g, 'ssl_protocols TLSv1.2 TLSv1.3;').replace(/ssl_dhparam [^;]+;/g, '')
    .replace(/include \/etc\/nginx\/snippets\/codex-cloudflare-real-ip.conf;/g, cf).replaceAll('127.0.0.1:5173', '127.0.0.1:' + gatewayPort)
    .replace(/proxy_set_header Host \$host;/g, `proxy_set_header Host $host:${tlsPort};`)
  const rawPreview = await readFile(join(staged, 'infra/preview-active.conf'), 'utf8')
  for (const host of HOSTS) assert(rawPreview.includes(`    ${host} 1;`))
  const preview = translate(rawPreview)
  const admin = translate(await readFile(join(staged, 'infra/admin-active.conf'), 'utf8')).replace('ssl ipv6only=on;', 'ssl;')
  // Preview first deliberately recreates the implicit IPv6 default; unrelated vhosts are absent.
  fixture = await startNginxFixture(preview + '\n' + admin)
  const get = (host, path, { address = '127.0.0.1', cookie, method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = request({ host: address, port: tlsPort, servername: boardHost, ca, path, method, headers: { Host: host, ...(cookie ? { Cookie: cookie } : {}), ...headers }, timeout: 5000 }, res => {
      const chunks = []; res.on('data', b => chunks.push(b)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }))
    }); req.on('error', reject); req.on('timeout', () => req.destroy(Error('request timeout'))); req.end()
  })
  for (let n = 0; ; n++) { try { await get(adminHost, '/'); break } catch {} if (n > 100) throw Error('Nginx startup'); await pause(30) }
  await fixture.assertIdentity()
  for (const path of ['/workboard', '/workboard/', '/workboard/api/session']) { const r = await get(adminHost, path); assert.equal(r.status, 303); assert.equal(new URL(r.headers.location, adminOrigin).pathname, '/services') }
  assert.equal((await get(adminHost, '/api/session')).status, 403, 'mandatory plaintext API rejects')
  // A valid gateway grant for an unlisted port proves auth is distinct from the Nginx host allowlist.
  let otherRequests = 0
  other = createServer((_req, res) => { otherRequests++; res.end('UNLISTED FIXTURE APP') }); const otherPort = await listen(other), otherHost = `p${otherPort}.fixture.test`
  const otherLaunch = new URL(await launch(otherPort))
  const rawGet = (host, path, cookie) => new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: gatewayPort, path, headers: { Host: host, ...(cookie ? { Cookie: cookie } : {}) } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }))
    }); req.on('error', reject); req.end()
  })
  const raw = await rawGet(otherHost + ':' + tlsPort, otherLaunch.pathname + otherLaunch.search)
  assert.equal(raw.status, 303); const grant = raw.headers['set-cookie'][0].split(';')[0]
  assert.equal((await rawGet(otherHost + ':' + tlsPort, '/', grant)).body, 'UNLISTED FIXTURE APP')
  assert.equal((await rawGet('unrecognized.fixture.test', '/api/session')).status, 400)
  // Inverse control: the same Nginx default without the new guard reaches that app.
  await fixture.close()
  fixture = await startNginxFixture(preview.replaceAll('    if ($codex_preview_allowed_host = 0) { return 421; }', '') + '\n' + admin)
  for (let n = 0; ; n++) { try { await get(adminHost, '/'); break } catch {} if (n > 100) throw Error('unguarded control startup'); await pause(30) }
  const unguarded = await get(otherHost, '/', { address: '::1', cookie: grant })
  assert.equal(unguarded.status, 200); assert.equal(unguarded.body, 'UNLISTED FIXTURE APP')
  await fixture.close(); fixture = await startNginxFixture(preview + '\n' + admin)
  for (let n = 0; ; n++) { try { await get(adminHost, '/'); break } catch {} if (n > 100) throw Error('guarded control startup'); await pause(30) }
  await fixture.assertIdentity()
  const count = otherRequests
  for (const address of ['127.0.0.1', '::1']) {
    for (const host of [otherHost, 'unrecognized.fixture.test']) {
      assert.equal((await get(host, '/', { address, cookie: grant })).status, 421)
      assert.equal((await get(host, '/socket', { address, cookie: grant, headers: { Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64') } })).status, 421)
    }
  }
  assert.equal(otherRequests, count)
  summary.exactHostDenial = { rawGatewayAuthorizedUnlisted: 200, unguardedNginxIpv6: 200, arbitraryGatewayHost: 400, stagedIpv4Ipv6HttpAndUpgrade: 421, rejectedRequestsReachedUpstream: 0 }
  const boardLaunch = await launch(boardPort, '/workboard/')
  await writeFile(join(files, 'fixture.css'), 'body{margin:0}iframe{display:block;border:0;width:100vw;height:100dvh}')
  await writeFile(join(files, 'index.html'), `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><iframe src="${boardLaunch.replaceAll('&', '&amp;')}" sandbox="allow-downloads allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"></iframe></body></html>`)
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--no-proxy-server', '--ignore-certificate-errors', '--host-resolver-rules=MAP *.fixture.test 127.0.0.1'] })
  const context = await browser.newContext({ ignoreHTTPSErrors: true }), page = await context.newPage(); page.setDefaultTimeout(15000)
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(adminOrigin + '/services')
  const panel = page.frameLocator('iframe')
  await panel.locator('#login-form input').fill(password); await panel.locator('#login-form button').click(); await panel.locator('#app').waitFor({ state: 'visible' })
  assert.equal(await panel.locator('tbody tr').count(), 5)
  assert.equal(await panel.locator('body').evaluate(() => { try { return !!parent.document.body } catch { return false } }), false)
  const workflow = await panel.locator('body').evaluate(async () => {
    const session = await (await fetch('./api/session')).json(), current = await (await fetch('./api/state')).json()
    current.state.tasks[0].nextStep = 'Actual gateway fixture save'
    const headers = { 'Content-Type': 'application/json' }
    const bad = await fetch('./api/state', { method: 'PUT', headers, body: JSON.stringify(current) })
    headers['X-CSRF-Token'] = session.csrf
    const good = await fetch('./api/state', { method: 'PUT', headers, body: JSON.stringify(current) })
    const stale = await fetch('./api/state', { method: 'PUT', headers, body: JSON.stringify(current) })
    return { bad: bad.status, good: good.status, stale: stale.status, saved: (await (await fetch('./api/state')).json()).state.tasks[0].nextStep }
  })
  assert.deepEqual(workflow, { bad: 403, good: 200, stale: 409, saved: 'Actual gateway fixture save' })
  await page.screenshot({ path: join(evidence, 'workboard-desktop.png') })
  await page.setViewportSize({ width: 390, height: 600 })
  await panel.locator('body').evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.screenshot({ path: join(evidence, 'workboard-mobile.png') })
  const mobile = await panel.locator('body').evaluate(() => ({ scrollWidth: document.body.scrollWidth, innerWidth }))
  assert(mobile.scrollWidth <= mobile.innerWidth, JSON.stringify(mobile))
  // Direct navigation keeps the preview grant; parent reload must use a new one-use ticket.
  const directPage = await context.newPage(); await directPage.goto(boardOrigin + '/workboard/'); await directPage.locator('#app').waitFor({ state: 'visible' }); await directPage.reload(); await directPage.locator('#app').waitFor({ state: 'visible' })
  const cookies = await context.cookies(boardOrigin + '/workboard/')
  assert(cookies.some(c => c.name === 'workboard_session' && c.secure && c.httpOnly && c.sameSite === 'Strict'))
  const htmlHeaders = await directPage.evaluate(async () => { const response = await fetch('./'); await response.arrayBuffer(); return Object.fromEntries(response.headers.entries()) })
  assert(htmlHeaders['content-security-policy'].includes(`frame-ancestors 'self' ${adminOrigin};`)); assert(!htmlHeaders['x-frame-options']); assert.equal(htmlHeaders['cache-control'], 'no-store')
  const boardCookie = cookies.map(c => c.name + '=' + c.value).join('; ')
  assert.equal((await get(boardHost, '/workboard/api/state', { cookie: boardCookie, headers: { Origin: adminOrigin } })).status, 403, 'parent cannot use preview API Origin')
  await directPage.locator('#logout-btn').click(); await directPage.locator('#login').waitFor({ state: 'visible' }); await directPage.reload(); await directPage.locator('#login').waitFor({ state: 'visible' })
  await directPage.locator('#login-form input').fill(password); await directPage.locator('#login-form button').click(); await directPage.locator('#app').waitFor({ state: 'visible' })
  summary.workboard = { unitTests: 10, encryptedTicket: true, parentIsolation: true, loginSaveCsrfConflictLogout: workflow, secureCookie: true, desktop: '1280x900', mobile: '390x600', reloadDirect: true, noStore: true }
  const vitePage = await context.newPage(); vitePage.setDefaultTimeout(15000); const sockets = []
  vitePage.on('websocket', socket => sockets.push(socket)); traffic.length = 0
  await vitePage.goto(await launch(vitePort)); await vitePage.waitForFunction(() => document.body.dataset.version === 'one'); await vitePage.waitForLoadState('networkidle')
  const initial = traffic.splice(0).filter(r => r.host?.startsWith(viteHost))
  await vitePage.reload(); await vitePage.waitForFunction(() => document.body.dataset.version === 'one'); await vitePage.waitForLoadState('networkidle')
  const reload = traffic.splice(0).filter(r => r.host?.startsWith(viteHost))
  assert(reload.some(r => r.status === 304)); const bytes = rows => rows.reduce((n, r) => n + r.bytes, 0); assert(bytes(reload) < bytes(initial))
  await writeFile(join(viteRoot, 'dep.js'), 'export const value="two";'); await vitePage.waitForFunction(() => document.body.dataset.version === 'two'); assert(sockets.length > 0)
  const denied = await context.newPage(); let ancestorDenied = false
  denied.on('console', message => { if (message.text().includes('frame-ancestors')) ancestorDenied = true })
  await denied.goto(`https://${viteHost}:${tlsPort}/evil.html`)
  for (let n = 0; n < 50 && !ancestorDenied; n++) await pause(50)
  assert(ancestorDenied, 'Workboard denies another authorized preview as its ancestor')
  assert.equal(await denied.frameLocator('iframe').locator('#app').count(), 0); await denied.close()
  summary.workboard.unapprovedPreviewAncestorDenied = true
  const socketClosed = sockets.at(-1).waitForEvent('close', { timeout: 10000 })
  const replayCookies = await context.cookies(), logout = await client.fetch('/api/session/logout', { method: 'POST', body: '{}' }); assert.equal(logout.status, 200); await logout.arrayBuffer(); await socketClosed
  assert.equal((await directPage.reload()).status(), 401); assert.equal((await vitePage.reload()).status(), 401)
  await context.addCookies(replayCookies); assert.equal((await directPage.reload()).status(), 401)
  summary.vite = { hmr: true, initialBytes: bytes(initial), reloadBytes: bytes(reload), revalidated: reload.filter(r => r.status === 304).length, wsClosedOnParentLogout: true }
  summary.parentRevocation = { workboardGrantReplay: 401, vite: 401 }
  await writeFile(join(evidence, 'workboard-preview-result.json'), JSON.stringify(summary, null, 2) + '\n')
  console.log(JSON.stringify(summary))
} finally {
  client?.close(); await browser?.close(); await fixture?.close()
  if (gateway) { gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve)) }
  if (other) { other.closeAllConnections(); await new Promise(resolve => other.close(resolve)) }
  await vite?.close()
  if (workboard && workboard.exitCode === null) { workboard.kill('SIGTERM'); await once(workboard, 'exit') }
  await rm(root, { recursive: true, force: true }); assert.deepEqual(await hostNginxIdentity(), hostIdentity)
}
