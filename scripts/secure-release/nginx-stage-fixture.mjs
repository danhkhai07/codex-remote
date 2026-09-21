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
  upstream = createServer((_req, res) => { res.end('fixture-upstream') }); const upstreamPort = await listen(upstream)
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
    const get = path => new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: tls, servername: 'codex.danhkhai.io.vn', ca, path, headers: { Host: 'codex.danhkhai.io.vn' }, timeout: 2000 }, res => { res.resume(); res.once('end', () => resolve(res.statusCode)) })
      req.on('error', reject); req.on('timeout', () => req.destroy()); req.end()
    })
    let status
    for (let n = 0; n < 50; n++) { try { status = await get('/api/healthz'); break } catch { await new Promise(resolve => setTimeout(resolve, 20)) } }
    await fixture.assertIdentity(); assert.equal(status, expected)
    if (admin === 'admin-active.conf') assert.equal(await get('/api/secure/request'), 200)
    await fixture.close(); fixture = undefined
  }
  console.log(JSON.stringify({ stagedNginxMerges: 3, exactTunnel36m: true, fakeCertificateOnly: true, nonRootRestricted: true, hostMetadataAndIdentityUnchanged: true }))
} finally {
  await fixture?.close(); if (upstream) await new Promise(resolve => upstream.close(resolve))
  await rm(root, { recursive: true, force: true }); assert.deepEqual(await hostNginxIdentity(), identity)
}
