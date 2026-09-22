// Exact new-host renderings, owned fake upstream/TLS only. No live configuration writes.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, request as httpRequest } from 'node:http'
import { request } from 'node:https'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { hostNginxIdentity, startNginxFixture } from '../nginx-fixture.mjs'
import { renderNginx, HOST, PORT } from './nginx.mjs'
const run = promisify(execFile), root = await mkdtemp(join(tmpdir(), 'remote-nginx-'))
const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port }
const unused = async () => { const s = createServer(), p = await listen(s); await new Promise(resolve => s.close(resolve)); return p }
const before = await hostNginxIdentity()
let fixture, upstream, received = 0
try {
  await chmod(root, 0o755)
  await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(root, 'key.pem'), '-out', join(root, 'cert.pem'), '-days', '1', '-subj', '/CN=' + HOST, '-addext', 'subjectAltName=DNS:' + HOST], { timeout: 15000 })
  for (const name of ['cert.pem', 'key.pem']) await chmod(join(root, name), 0o644) // Fake, disposable TLS only.
  const ca = await readFile(join(root, 'cert.pem'))
  upstream = createServer((req, res) => {
    received++; let bytes = 0
    req.on('data', chunk => { bytes += chunk.length })
    req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ bytes, headers: req.headers })) })
  })
  upstream.on('upgrade', (req, socket) => { received++; socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n') })
  const upstreamPort = await listen(upstream)
  const cf = await readFile('/root/.local/state/codex-remote/releases/secure-api-80843c0-activation-0830369e/infra/cloudflare-real-ip.conf', 'utf8')
  for (const mode of ['bootstrap', 'parked', 'active']) {
    const http = await unused(), tls = await unused()
    const content = renderNginx(mode).replace(/^\s*listen \[::\].*;.*$/gm, '').replace(/listen 443 ssl;/g, `listen 127.0.0.1:${tls} ssl;`).replace(/listen 80;/g, `listen 127.0.0.1:${http};`)
      .replace(/ssl_certificate [^;]+;/g, `ssl_certificate ${root}/cert.pem;`).replace(/ssl_certificate_key [^;]+;/g, `ssl_certificate_key ${root}/key.pem;`)
      .replace(/include \/etc\/letsencrypt\/options-ssl-nginx.conf;/g, 'ssl_protocols TLSv1.2 TLSv1.3;').replace(/ssl_dhparam [^;]+;/g, '')
      .replace(/include \/etc\/nginx\/snippets\/codex-cloudflare-real-ip.conf;/g, cf).replaceAll('127.0.0.1:' + PORT, '127.0.0.1:' + upstreamPort)
    fixture = await startNginxFixture(content)
    const get = (url, { secure = true, headers = {}, method = 'GET', bytes = 0, declared = bytes } = {}) => new Promise((resolve, reject) => {
      const req = (secure ? request : httpRequest)({ host: '127.0.0.1', port: secure ? tls : http, servername: HOST, ca, path: url, method, headers: { Host: HOST, ...headers, ...(declared ? { 'Content-Length': declared } : {}) }, timeout: 15000 }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }))
      })
      req.on('upgrade', (res, socket) => { socket.destroy(); resolve({ status: res.statusCode, headers: res.headers }) })
      req.on('error', reject); req.on('timeout', () => req.destroy(Error('fixture timeout')))
      void (async () => { const chunk = Buffer.alloc(65536, 65); for (let left = bytes; left > 0;) { const part = chunk.subarray(0, Math.min(left, chunk.length)); left -= part.length; if (!req.write(part)) await once(req, 'drain') } req.end() })().catch(reject)
    })
    let ready
    for (let n = 0; n < 75; n++) { try { ready = await get('/', { secure: false }); break } catch { await new Promise(resolve => setTimeout(resolve, 20)) } }
    assert.equal(ready.status, 308); await fixture.assertIdentity()
    const count = received
    assert.equal((await get('/', { secure: false, headers: { Host: 'unlisted.invalid' } })).status, 421)
    if (mode === 'bootstrap') await assert.rejects(get('/'))
    else {
      assert.equal((await get('/', { headers: { Host: 'unlisted.invalid' } })).status, 421)
      assert.equal(received, count, 'unknown host must never reach gateway')
      const normal = await get('/')
      assert.equal(normal.status, mode === 'active' ? 200 : 503)
      if (mode === 'parked') { assert.equal(normal.headers['cache-control'], 'no-store'); assert.equal(normal.headers['set-cookie'], undefined); assert.equal(received, count) }
      else {
        for (const url of ['/workboard', '/workboard/', '/workboard/api/session']) assert.equal(new URL((await get(url)).headers.location, 'https://' + HOST).pathname, '/services')
        const forwarded = JSON.parse((await get('/api/secure/request', { headers: { 'X-Real-IP': '203.0.113.1', 'X-Forwarded-For': '203.0.113.2', Forwarded: 'for=203.0.113.3', 'CF-Connecting-IP': '203.0.113.4' } })).body).headers
        assert.equal(forwarded.host, HOST); assert.equal(forwarded['x-real-ip'], '127.0.0.1'); assert.equal(forwarded['x-forwarded-proto'], 'https')
        for (const name of ['x-forwarded-for', 'forwarded', 'cf-connecting-ip']) assert.equal(forwarded[name], undefined)
        const upload = await get('/api/secure/request', { method: 'POST', bytes: 35063561 })
        assert.equal(upload.status, 200); assert.equal(JSON.parse(upload.body).bytes, 35063561)
        assert.equal((await get('/api/secure/request', { method: 'POST', declared: 36 * 1024 * 1024 + 1 })).status, 413)
        assert.equal((await get('/vite-hmr', { headers: { Upgrade: 'websocket', Connection: 'Upgrade' } })).status, 101)
      }
    }
    await fixture.close(); fixture = undefined
  }
  console.log(JSON.stringify({ renderedModes: 3, exactHostDenial: 421, parked: 503, bootstrapRejectsTls: true, proxySpoofingStripped: true, tunnelBytes: 35063561, oversized: 413, websocket: 101, legacyAppNotContacted: true, nativeModelTurns: 0 }))
} finally {
  await fixture?.close(); if (upstream) { upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)) }
  await rm(root, { recursive: true, force: true }); assert.deepEqual(await hostNginxIdentity(), before)
  console.log(JSON.stringify({ nginxNonRoot: true, allFivePrivateTempPaths: true, restrictedFilesystem: true, hostNginxIdentityAndMetadataUnchanged: true }))
}
