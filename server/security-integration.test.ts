import { mkdtemp, mkdir, writeFile, rm, symlink, rename } from 'node:fs/promises'
import { createServer, request, type Server } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it } from 'vitest'
import { createSession } from './auth.js'
import { createRemoteHttpServer } from './http-app.js'
import { RemoteController } from './controller.js'
import { CodexAppServer } from './codex-app-server.js'
import { inspectServerFile, readInspectedFile } from './server-files.js'
import type { RemoteConfig } from './config.js'
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  return (server.address() as AddressInfo).port
}
async function fixture(trustedProxies: string[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'security-http-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const config: RemoteConfig = { host: '127.0.0.1', port: 0, publicOrigin: new URL('http://localhost'), password: 'fixture password only', sessionSecret: 'test-secret'.repeat(4), sessionTtlSeconds: 600,
    codexBin: 'unused', workspaceRoots: [root], fileRoots: [root], production: true, trustedProxies, sessionStateFile: join(root, 'private-state', 'sessions.json') }
  const controller = new RemoteController(config, new CodexAppServer('unused'))
  const server = createRemoteHttpServer(config, controller, root, null), port = await listen(server)
  config.port = port; config.publicOrigin = new URL(`http://127.0.0.1:${port}`)
  const call = (path: string, options: RequestInit = {}) => fetch(config.publicOrigin + path.slice(1), { ...options, headers: { Origin: config.publicOrigin.origin, 'Content-Type': 'application/json', ...options.headers }, redirect: 'manual' })
  const login = async (headers = {}, password = config.password) => {
    const response = await call('/api/session/login', { method: 'POST', headers, body: JSON.stringify({ password }) })
    const data = await response.json()
    return { response, headers: { Cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '', 'X-CSRF-Token': data.csrf } }
  }
  return { root, config, controller, server, port, call, login }
}
it('revokes replayed cookies and closes existing SSE on logout or expiry', async () => {
  const f = await fixture(), auth = await f.login()
  const open = (cookie: string) => new Promise<{ closed: Promise<void>; destroy: () => void }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: f.port, path: '/api/events', headers: { Cookie: cookie } }, res => {
      expect(res.statusCode).toBe(200); res.resume()
      const closed = new Promise<void>(end => res.once('close', end))
      resolve({ closed, destroy: () => req.destroy() })
    }); req.on('error', reject); req.end()
  })
  const stream = await open(auth.headers.Cookie)
  expect((await f.call('/api/session/logout', { method: 'POST', headers: auth.headers, body: '{}' })).status).toBe(200)
  await stream.closed
  expect((await f.call('/api/session', { headers: auth.headers })).status).toBe(401)
  const short = createSession(f.config.sessionSecret, 1, f.config.password)
  const expiry = await open(`codex_remote_session=${short.token}`)
  await expiry.closed
  expect((await f.call('/api/session', { headers: { Cookie: `codex_remote_session=${short.token}` } })).status).toBe(401)
})
it('distinguishes trusted proxy clients without trusting arbitrary forwarding headers', async () => {
  const f = await fixture(['127.0.0.1'])
  for (let n = 0; n < 8; n++) expect((await f.login({ 'X-Real-IP': '192.0.2.10', 'X-Forwarded-For': `198.51.100.${n}` }, 'wrong')).response.status).toBe(401)
  expect((await f.login({ 'X-Real-IP': '192.0.2.10', 'X-Forwarded-For': '198.51.100.99' })).response.status).toBe(429)
  expect((await f.login({ 'X-Real-IP': '192.0.2.20' })).response.status).toBe(200)
  const untrusted = await fixture()
  for (let n = 0; n < 8; n++) await untrusted.login({ 'X-Real-IP': `192.0.2.${n}` }, 'wrong')
  expect((await untrusted.login({ 'X-Real-IP': '203.0.113.55' })).response.status).toBe(429)
})
it('protects every file route with lexical/canonical secret policy using canaries only', async () => {
  const f = await fixture(), auth = await f.login()
  await mkdir(join(f.root, '.ssh')); await writeFile(join(f.root, '.ssh', 'id_ed25519'), 'NONSECRET SSH CANARY')
  await writeFile(join(f.root, '.env'), 'NONSECRET ENV CANARY'); await writeFile(join(f.root, 'readme.md'), 'Public project text')
  await symlink(join(f.root, '.env'), join(f.root, 'alias.txt'))
  for (const path of [join(f.root, '.env'), join(f.root, '.ssh', 'id_ed25519'), join(f.root, 'alias.txt'), join(f.root, 'dir', '..', '.env')]) {
    for (const route of ['info', 'content', 'html-preview', 'pptx-preview']) {
      const response = await f.call(`/api/files/${route}?path=${encodeURIComponent(path)}`, { headers: auth.headers })
      expect(response.status).toBe(403); expect(await response.text()).not.toContain('CANARY')
    }
  }
  expect((await f.call(`/api/files/content?path=${encodeURIComponent(encodeURIComponent(join(f.root, '.env')))}`, { headers: auth.headers })).status).toBe(400)
  expect((await f.call(`/api/files/content?path=${encodeURIComponent(join(f.root, 'readme.md'))}`, { headers: auth.headers })).status).toBe(200)
  const list = await (await f.call(`/api/files/list?hidden=1&path=${encodeURIComponent(f.root)}`, { headers: auth.headers })).json()
  expect(list.entries.some((entry: { name: string }) => ['.ssh', '.env'].includes(entry.name))).toBe(false)
  expect(list.entries.find((entry: { name: string }) => entry.name === 'alias.txt').kind).toBe('unavailable')
})
it('detects file and parent symlink replacement between inspection and read', async () => {
  const f = await fixture()
  const parent = join(f.root, 'folder'); await mkdir(parent)
  const path = join(parent, 'note.txt'); await writeFile(path, 'good')
  const file = await inspectServerFile(path, [f.root])
  await rename(parent, join(f.root, 'moved')); await mkdir(join(f.root, '.ssh')); await writeFile(join(f.root, '.ssh', 'note.txt'), 'CANARY')
  await symlink(join(f.root, '.ssh'), parent)
  await expect(readInspectedFile(file)).rejects.toMatchObject({ status: 403 })
})
it('requires configured isolation and never proxies an untrusted app on the administrative origin', async () => {
  const f = await fixture(), auth = await f.login()
  let requests = 0
  const appPort = await listen(createServer((_req, res) => { requests++; res.end('<script>evil()</script>') }))
  expect((await f.call(`/preview/${appPort}/`, { headers: auth.headers })).status).toBe(503)
  expect(requests).toBe(0)
  expect((await f.call('/api/localhost-preview', { method: 'POST', headers: auth.headers, body: JSON.stringify({ port: appPort }) })).status).toBe(503)
})
