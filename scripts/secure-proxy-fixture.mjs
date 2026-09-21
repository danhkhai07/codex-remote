// Ephemeral Nginx + real encrypted gateway, fake credentials, no production config/model.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createRemoteHttpServer } from '../dist-server/http-app.js'
import { RemoteController } from '../dist-server/controller.js'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
import { AttachmentStore } from '../dist-server/attachments.js'
import { createSession } from '../dist-server/auth.js'
import { SecureTransport } from '../dist-server/secure-client.js'
import { randomId } from '../dist-server/secure-wire.js'
const root = await mkdtemp(join(tmpdir(), 'secure-proxy-')), binary = process.env.NGINX_FIXTURE_BIN || '/usr/sbin/nginx'
const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port }
let nginx, server, attachments, client
try {
  const files = join(root, 'files'), uploads = join(root, 'uploads'); await mkdir(files)
  const material = { version: 1, app: randomId(), generation: randomId(), key: randomId(32) }, keyFile = join(root, 'owner.json')
  await writeFile(keyFile, JSON.stringify(material), { mode: 0o600 })
  const reservation = createServer(), port = await listen(reservation); await new Promise(resolve => reservation.close(resolve))
  const config = { host: '127.0.0.1', port: 0, publicOrigin: new URL('http://127.0.0.1:' + port), password: 'FAKE maximum upload password', sessionSecret: 'fake-proxy-secret'.repeat(4), sessionTtlSeconds: 600, production: true, codexBin: 'unused', workspaceRoots: [files], fileRoots: [files], secureApiRequired: true, secureKeyFile: keyFile, sessionStateFile: join(root, 'sessions.json') }
  attachments = new AttachmentStore(uploads)
  server = createRemoteHttpServer(config, new RemoteController(config, new CodexAppServer('unused')), files, null, undefined, attachments)
  config.port = await listen(server)
  const wireLengths = []
  server.prependListener('request', req => { if (req.url === '/api/secure/request') wireLengths.push(Number(req.headers['content-length'])) })
  const snippet = (await readFile(resolve('deploy/nginx/secure-api-location.conf'), 'utf8')).replace('127.0.0.1:5173', '127.0.0.1:' + config.port)
  const nginxConfig = join(root, 'nginx.conf')
  await writeFile(nginxConfig, `daemon off; master_process off; pid ${root}/nginx.pid; error_log stderr error;
events { worker_connections 64; }
http { access_log off; server { listen 127.0.0.1:${port}; server_name 127.0.0.1;
client_max_body_size 26m;
${snippet}
location / { proxy_pass http://127.0.0.1:${config.port}; proxy_set_header Host $http_host; }
} }`)
  await promisify(execFile)(binary, ['-t', '-p', root, '-c', nginxConfig], { timeout: 10000 })
  nginx = spawn(binary, ['-p', root, '-c', nginxConfig], { stdio: 'ignore' })
  let ready = false
  for (let n = 0; n < 100; n++) { try { if ((await fetch(config.publicOrigin.origin + '/api/secure/setup')).ok) { ready = true; break } } catch { /* only local listener startup */ }; await new Promise(resolve => setTimeout(resolve, 20)) }
  assert(ready, 'fixture Nginx must start')
  const session = createSession(config.sessionSecret, 600, config.password)
  client = new SecureTransport(fetch, config.publicOrigin.origin, { Origin: config.publicOrigin.origin, Cookie: 'codex_remote_session=' + session.token })
  await client.unlock(material.key)
  const body = new Uint8Array(25 * 1024 * 1024).fill(81)
  const result = await client.request('/api/attachments?name=maximum.bin', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': session.payload.csrf }, body })
  const item = await result.response.json(); assert.equal(result.response.status, 201); assert.equal(item.size, body.length)
  assert((await readFile(join(uploads, item.id + '-maximum.bin'))).equals(body))
  const count = wireLengths.length, wireBytes = wireLengths.at(-1)
  assert(wireBytes > 26 * 1024 * 1024 && wireBytes < 36 * 1024 * 1024)
  await assert.rejects(client.request('/api/attachments?name=oversized.bin', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': session.payload.csrf }, body: new Uint8Array(26 * 1024 * 1024) }), /Upload exceeds limit/)
  assert.equal(wireLengths.length, count, 'oversized local upload must not be dispatched')
  const removed = await client.request('/api/attachments/' + item.id, { method: 'DELETE', headers: { 'x-csrf-token': session.payload.csrf } }); await removed.response.arrayBuffer(); assert.equal(removed.response.status, 200)
  console.log(JSON.stringify({ nginxSyntax: true, plaintextBytes: body.length, encryptedWireBytes: wireBytes, maximumUploadUnchanged: true, oversizedRejectedBeforeDispatch: true, separatePorts: true, nativeModelTurns: 0, processPeakRssKiB: process.resourceUsage().maxRSS }))
} finally {
  client?.lock(); attachments?.stop()
  if (nginx && nginx.exitCode === null) { nginx.kill('SIGQUIT'); await once(nginx, 'exit') }
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await rm(root, { recursive: true, force: true })
}
