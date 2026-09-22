// Syntax/start staged merges with fake TLS, five owned temp paths and non-root restrictive filesystem.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { request } from 'node:https'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { hostNginxIdentity, startNginxFixture } from '../nginx-fixture.mjs'
const root = await mkdtemp(join(tmpdir(), 'release-nginx-tls-')), release = resolve(process.argv[2]), run = promisify(execFile)
const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port }
const unusedPort = async () => { const s = createServer(), port = await listen(s); await new Promise(resolve => s.close(resolve)); return port }
const identity = await hostNginxIdentity(); let fixture, upstream
try {
  await chmod(root, 0o755)
  await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(root, 'key.pem'), '-out', join(root, 'cert.pem'), '-days', '1', '-subj', '/CN=codex.danhkhai.io.vn', '-addext', 'subjectAltName=DNS:codex.danhkhai.io.vn,DNS:p5180.danhkhai.io.vn'], { timeout: 15000 })
  await chmod(join(root, 'cert.pem'), 0o644)
  await chmod(join(root, 'key.pem'), 0o644) // Throwaway fixture key, never a production certificate.
  const ca = await readFile(join(root, 'cert.pem'))
  upstream = createServer((req, res) => {
    let bytes = 0
    req.on('data', chunk => { bytes += chunk.length })
    req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ bytes, headers: req.headers })) })
  }); const upstreamPort = await listen(upstream)
  const cf = await readFile(join(release, 'infra/cloudflare-real-ip.conf'), 'utf8')
  const scenarios = [['admin-active.conf', 'preview-active.conf', 200], ['admin-maintenance.conf', 'preview-parked.conf', 503], ['admin-active.conf', 'preview-parked.conf', 200]]
  for (const [admin, preview, expected] of scenarios) {
    const http = await unusedPort(), tls = await unusedPort()
    let content = (await readFile(join(release, 'infra', admin), 'utf8')) + '\n' + (await readFile(join(release, 'infra', preview), 'utf8'))
    content = content.replace(/^\s*listen \[::\].*;.*$/gm, '').replace(/listen 443 ssl;/g, `listen 127.0.0.1:${tls} ssl;`).replace(/listen 80;/g, `listen 127.0.0.1:${http};`)
      .replace(/ssl_certificate [^;]+;/g, `ssl_certificate ${root}/cert.pem;`).replace(/ssl_certificate_key [^;]+;/g, `ssl_certificate_key ${root}/key.pem;`)
      .replace(/include \/etc\/letsencrypt\/options-ssl-nginx.conf;/g, 'ssl_protocols TLSv1.2 TLSv1.3;').replace(/ssl_dhparam [^;]+;/g, '')
      .replace(/include \/etc\/nginx\/snippets\/codex-cloudflare-real-ip.conf;/g, cf).replaceAll('127.0.0.1:5173', '127.0.0.1:' + upstreamPort)
    fixture = await startNginxFixture(content)
    const get = (path, { method = 'GET', headers = {}, bytes = 0, declaredBytes = bytes } = {}) => new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: tls, servername: 'codex.danhkhai.io.vn', ca, path, method, headers: { Host: 'codex.danhkhai.io.vn', ...headers, ...(declaredBytes ? { 'Content-Length': declaredBytes } : {}) }, timeout: 15000 }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.once('end', () => resolve({ status: res.statusCode, location: res.headers.location, body: Buffer.concat(chunks).toString() }))
      })
      req.on('error', reject); req.on('timeout', () => req.destroy(Error('fixture request timeout')))
      void (async () => {
        const chunk = Buffer.alloc(64 * 1024, 65)
        for (let left = bytes; left > 0;) { const part = chunk.subarray(0, Math.min(left, chunk.length)); left -= part.length; if (!req.write(part)) await once(req, 'drain') }
        req.end()
      })().catch(reject)
    })
    let status
    for (let n = 0; n < 50; n++) { try { status = await get('/api/healthz'); break } catch { await new Promise(resolve => setTimeout(resolve, 20)) } }
    await fixture.assertIdentity(); assert.equal(status.status, expected)
    if (admin === 'admin-active.conf') {
      assert.equal((await get('/api/secure/request')).status, 200)
      for (const path of ['/workboard', '/workboard/', '/workboard/api/session']) {
        const redirect = await get(path)
        assert.equal(redirect.status, 303); assert.equal(new URL(redirect.location, 'https://codex.danhkhai.io.vn').pathname, '/services')
      }
      const forwarded = await get('/api/secure/request', { headers: { 'X-Real-IP': '203.0.113.40', 'X-Forwarded-For': '203.0.113.41', Forwarded: 'for=203.0.113.42', 'CF-Connecting-IP': '203.0.113.43' } })
      const received = JSON.parse(forwarded.body).headers
      assert.equal(received['x-real-ip'], '127.0.0.1')
      assert.equal(received['x-forwarded-proto'], 'https')
      for (const name of ['x-forwarded-for', 'forwarded', 'cf-connecting-ip']) assert.equal(received[name], undefined)
      // Actual encrypted25MiB fixture wire size: larger than the old26MiB cap.
      const upload = await get('/api/secure/request', { method: 'POST', bytes: 35_063_561 })
      assert.equal(upload.status, 200); assert.equal(JSON.parse(upload.body).bytes, 35_063_561)
      assert.equal((await get('/api/secure/request', { method: 'POST', declaredBytes: 36 * 1024 * 1024 + 1 })).status, 413)
    }
    await fixture.close(); fixture = undefined
  }
  console.log(JSON.stringify({ stagedNginxMerges: 3, actualTunnelWireBytes: 35_063_561, over36MiB: 413, spoofedForwardingStripped: true, fakeCertificateOnly: true, nonRootRestricted: true, hostMetadataAndIdentityUnchanged: true }))
} finally {
  await fixture?.close(); if (upstream) await new Promise(resolve => upstream.close(resolve))
  await rm(root, { recursive: true, force: true }); assert.deepEqual(await hostNginxIdentity(), identity)
}
