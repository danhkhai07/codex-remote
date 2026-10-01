// Exact prepared active ingress under owned ports/non-root Nginx; no host edits.
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync, chmodSync, chownSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { request } from 'node:https'
import { startNginxFixture, hostNginxIdentity } from './nginx-fixture.mjs'
const root = mkdtempSync(join(tmpdir(), 'share-ingress-')), before = await hostNginxIdentity()
let fixture
const gateway = createServer((req, res) => { res.writeHead(401, { 'content-type': 'text/plain' }); res.end('private gateway: ' + req.headers.host) })
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const free = async () => { const s = createServer(), p = await listen(s); await new Promise(r => s.close(r)); return p }
try {
  chmodSync(root, 0o755)
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(root, 'key'), '-out', join(root, 'cert'), '-days', '1', '-subj', '/CN=fixture.invalid'], { stdio: 'ignore' })
  for (const name of ['key', 'cert']) { chownSync(join(root, name), 65534, 65534); chmodSync(join(root, name), 0o600) } // Owned synthetic fixture material only.
  const upstream = await listen(gateway), http = await free(), https = await free()
  let active = readFileSync(process.argv[2], 'utf8')
  active = active.replace(/listen 80;/g, `listen 127.0.0.1:${http};`).replace(/listen 443 ssl;/g, `listen 127.0.0.1:${https} ssl;`).replace(/^\s*listen \[::\].*$/gm, '')
    .replace(/ssl_certificate [^;]+;/, `ssl_certificate ${root}/cert;`).replace(/ssl_certificate_key [^;]+;/, `ssl_certificate_key ${root}/key;`)
    .replace(/^\s*(?:include|ssl_dhparam) [^;]+;$/gm, '').replace('127.0.0.1:5174', `127.0.0.1:${upstream}`)
  fixture = await startNginxFixture('map $http_upgrade $codex_remote_preview_connection { default upgrade; "" close; }\n' + active)
  const get = host => new Promise((resolve, reject) => { const req = request({ hostname: '127.0.0.1', port: https, path: '/', headers: { host }, servername: host, rejectUnauthorized: false }, res => { let body = ''; res.on('data', x => body += x); res.on('end', () => resolve({ status: res.statusCode, body })) }); req.on('error', reject); req.end() })
  for (let n = 0; n < 50; n++) { try { await get('p5217.danhkhai.io.vn'); break } catch { await new Promise(r => setTimeout(r, 100)) } }
  await fixture.assertIdentity()
  for (const port of [2345, 5180, 5210, 5211, 5212, 5213, 5215, 5217, 5221, 5222]) {
    const reply = await get(`p${port}.danhkhai.io.vn`)
    assert.equal(reply.status, 401); assert.equal(reply.body, `private gateway: p${port}.danhkhai.io.vn`)
  }
  for (const host of ['p5999.danhkhai.io.vn', 'remote.danhkhai.io.vn', 'p05221.danhkhai.io.vn']) assert.equal((await get(host)).status, 421)
  console.log(JSON.stringify({ exactHosts: 10, unknownHostDenied: true, anonymousReachesAuthNotUpstream: true, realCertificateReadinessTested: false, nonrootPrivateFixture: true }))
} finally { await fixture?.close(); await new Promise(r => gateway.close(r)); rmSync(root, { recursive: true, force: true }); assert.deepEqual(await hostNginxIdentity(), before) }
