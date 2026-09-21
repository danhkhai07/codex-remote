// Isolated browser/native stub proof. No production configuration, cookies or model turns.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer, request } from 'node:http'
import { createServer as createTlsServer } from 'node:https'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRemoteHttpServer } from '../dist-server/http-app.js'
import { RemoteController } from '../dist-server/controller.js'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = await mkdtemp('/tmp/app-security-browser-'), dist = join(root, 'dist')
await mkdir(dist)
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const reserve = createServer(), port = await listen(reserve)
await new Promise(resolve => reserve.close(resolve))
const origin = `https://admin.fixture.test:${port}`
const sockets = new Set(), upstreamHeaders = [], nativeCalls = []
let browser, gateway, tls
const preview = createServer((req, res) => {
  upstreamHeaders.push(req.headers)
  if (req.url === '/asset.txt') { res.end('ASSET OK'); return }
  if (req.url === '/sw.js') { res.setHeader('Content-Type', 'application/javascript'); res.end('self.addEventListener("install",()=>self.skipWaiting())'); return }
  if (req.url === '/redirect') { res.writeHead(302, { Location: '/' }); res.end(); return }
  if (req.url === '/api/session') { res.writeHead(404); res.end('Not a control API'); return }
  res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': ['codex_remote_session=attack; Domain=fixture.test', '__Host-codex_remote_session=attack; Path=/; Secure', 'theme=dark; Domain=fixture.test; Path=/'] })
  res.end(`<!doctype html><title>Untrusted preview fixture</title><script>
(async()=>{
 const r={};
 try{r.parentReadable=!!parent.document.body&&parent!==window}catch{r.parentReadable=false}
 try{await parent.fetch(${JSON.stringify(origin + '/api/session')});r.parentFetch=parent!==window}catch{r.parentFetch=false}
 try{const q=await fetch(${JSON.stringify(origin + '/api/session')},{credentials:'include'});r.sessionReadable=q.ok}catch{r.sessionReadable=false}
 try{const q=await fetch(${JSON.stringify(origin + '/api/files/content?path=' + encodeURIComponent(join(root, '.env')))},{credentials:'include'});r.canaryReadable=(await q.text()).includes('CANARY')}catch{r.canaryReadable=false}
 try{const q=await fetch(${JSON.stringify(origin + '/api/threads/audit/turns')},{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-CSRF-Token':'fake'},body:JSON.stringify({text:'stub only',fullAccess:true})});r.controlMutation=q.ok}catch{r.controlMutation=false}
 try{await navigator.serviceWorker.register(${JSON.stringify(origin + '/sw.js')});r.adminWorker=true}catch{r.adminWorker=false}
 r.asset=await(await fetch('/asset.txt')).text();localStorage.setItem('preview-test','ok');r.storage=localStorage.getItem('preview-test');
 try{await navigator.serviceWorker.register('/sw.js');r.ownWorker=true}catch(error){r.ownWorker=false;r.ownWorkerError=String(error)}
 const ws=new WebSocket(location.origin.replace('http','ws')+'/socket');
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});r.websocket=true;
 ws.onclose=()=>{window.socketClosed=true};
 window.proof=r;parent.postMessage({securityProof:r},'*');
})().catch(e=>{window.proof={error:String(e)};parent.postMessage({securityProof:window.proof},'*')})
</script>`)
})
preview.on('upgrade', (req, socket) => {
  upstreamHeaders.push(req.headers); sockets.add(socket); socket.on('close', () => sockets.delete(socket))
  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
})
const previewPort = await listen(preview), previewOrigin = `https://p${previewPort}.fixture.test:${port}`
try {
  await writeFile(join(root, '.env'), 'NONSECRET-CANARY-ONLY')
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>Control fixture</title><script src="/harness.js"></script><body><h1>Control fixture</h1></body>')
  await writeFile(join(dist, 'harness.js'), 'window.addEventListener("message",e=>{if(e.data?.securityProof)window.proof=e.data.securityProof})')
  const config = { host: '127.0.0.1', port, publicOrigin: new URL(origin), password: 'fake password security only', sessionSecret: 'fake session security secret'.repeat(2), sessionTtlSeconds: 600, workspaceRoots: [root], fileRoots: [root], production: true, codexBin: 'unused', previewOriginTemplate: `https://p{port}.fixture.test:${port}`, sessionStateFile: join(root, 'sessions.json') }
  const app = new CodexAppServer('unused')
  app.request = async (method, params) => { nativeCalls.push({ method, params }); throw Error('No native call expected') }
  gateway = createRemoteHttpServer(config, new RemoteController(config, app), dist, null)
  const internalPort = await listen(gateway)
  config.port = internalPort
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(root, 'fixture-key.pem'), '-out', join(root, 'fixture-cert.pem'), '-days', '1', '-subj', '/CN=fixture.test', '-addext', 'subjectAltName=DNS:*.fixture.test'], { stdio: 'ignore' })
  tls = createTlsServer({ key: await readFile(join(root, 'fixture-key.pem')), cert: await readFile(join(root, 'fixture-cert.pem')) }, (req, res) => {
    const upstream = request({ host: '127.0.0.1', port: internalPort, path: req.url, method: req.method, headers: req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res) })
    upstream.on('error', () => res.destroy()); res.on('close', () => upstream.destroy()); req.pipe(upstream)
  })
  tls.on('upgrade', (req, socket, head) => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket))
    const upstream = request({ host: '127.0.0.1', port: internalPort, path: req.url, headers: req.headers })
    upstream.on('upgrade', (response, connected, extra) => {
      sockets.add(connected); connected.on('close', () => sockets.delete(connected))
      socket.write('HTTP/1.1 101 Switching Protocols\r\n' + Object.entries(response.headers).map(([k,v]) => k+': '+v).join('\r\n') + '\r\n\r\n')
      if (extra.length) socket.write(extra); if (head.length) connected.write(head)
      socket.on('error', () => connected.destroy()); connected.on('error', () => socket.destroy())
      socket.on('close', () => connected.destroy()); connected.on('close', () => socket.destroy())
      socket.pipe(connected).pipe(socket)
    })
    upstream.on('error', () => socket.destroy()); upstream.end()
  })
  await new Promise(resolve => tls.listen(port, '127.0.0.1', resolve))
  browser = await chromium.launch({ headless: true, args: ['--no-proxy-server', '--host-resolver-rules=MAP *.fixture.test 127.0.0.1', '--ignore-certificate-errors'] })
  const context = await browser.newContext(), page = await context.newPage()
  await page.goto(origin)
  const login = await page.evaluate(async password => { const r = await fetch('/api/session/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }); return r.json() }, config.password)
  const launch = await page.evaluate(async ({ csrf, port }) => (await fetch('/api/localhost-preview', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ port, path: '/redirect' }) })).json(), { csrf: login.csrf, port: previewPort })
  await page.evaluate(url => { const iframe = document.createElement('iframe'); iframe.src = url; iframe.sandbox = 'allow-same-origin allow-scripts allow-forms'; iframe.width = '700'; iframe.height = '400'; document.body.append(iframe) }, launch.url)
  await page.waitForFunction(() => window.proof, null, { timeout: 20000 })
  const embedded = await page.evaluate(() => window.proof)
  if (embedded.ownWorkerError) console.error(embedded.ownWorkerError)
  assert.deepEqual(embedded, { parentReadable: false, parentFetch: false, sessionReadable: false, canaryReadable: false, controlMutation: false, adminWorker: false, asset: 'ASSET OK', storage: 'ok', ownWorker: true, websocket: true })
  const direct = await context.newPage()
  await direct.goto(`${origin}/preview/${previewPort}/`)
  await direct.waitForFunction(() => window.proof)
  assert.equal(new URL(direct.url()).origin, previewOrigin)
  const standalone = await direct.evaluate(() => window.proof)
  assert.equal(standalone.sessionReadable, false); assert.equal(standalone.canaryReadable, false); assert.equal(standalone.controlMutation, false); assert.equal(standalone.adminWorker, false)
  assert.equal(nativeCalls.length, 0)
  assert.equal(upstreamHeaders.some(h => /codex_remote|codex_preview/i.test(h.cookie || '')), false)
  const session = await page.evaluate(async () => (await fetch('/api/session')).json())
  assert.equal(session.csrf, login.csrf)
  const shots = process.env.SECURITY_SCREENSHOTS
  if (shots) { await mkdir(shots, { recursive: true }); await page.screenshot({ path: resolve(shots, 'isolated-preview.png') }) }
  const cookies = await context.cookies(origin), token = cookies.find(c => c.name === '__Host-codex_remote_session')
  const logout = await page.evaluate(async csrf => (await fetch('/api/session/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: '{}' })).status, login.csrf)
  assert.equal(logout, 200)
  await direct.waitForFunction(() => window.socketClosed === true)
  await page.frames().find(f => f.url().startsWith(previewOrigin)).waitForFunction(() => window.socketClosed === true)
  const replay = await fetch(`http://127.0.0.1:${internalPort}/api/session`, { headers: { Host: new URL(origin).host, Cookie: `__Host-codex_remote_session=${token.value}` } })
  assert.equal(replay.status, 401)
  const previewDenied = await direct.evaluate(async () => (await fetch('/asset.txt')).status)
  assert.equal(previewDenied, 401)
  const evidence = { embedded, standalone, nativeCalls: nativeCalls.length, logout, replayAfterLogout: replay.status, previewAfterLogout: previewDenied, previewWebSocketsClosed: true, noProductionAccess: true }
  if (process.env.SECURITY_EVIDENCE) await writeFile(process.env.SECURITY_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await browser?.close()
  for (const socket of sockets) socket.destroy()
  for (const server of [tls, gateway, preview]) if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await rm(root, { recursive: true, force: true })
}
