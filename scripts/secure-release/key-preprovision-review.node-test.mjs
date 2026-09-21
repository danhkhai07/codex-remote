// Inverse PoC: PASS means the old gateway exposes a newly staged fake owner key.
// Loopback fixture only; no production request, credential, key, native turn or restart.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'

const run = promisify(execFile)
const release = process.env.REVIEW_RELEASE
const oldMain = '/root/RUNNING-SERVICES/codex-remote'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

test('P1 inverse PoC: old authenticated Files returns 0700/0600 fake owner key before ingress gating', { skip: !release }, async () => {
  const baseline = JSON.parse(await readFile(join(release, 'baseline.json'), 'utf8'))
  assert.equal(digest(await readFile(join(oldMain, 'dist-server/http-app.js'))), baseline.backend['http-app.js'].sha256)
  const { createRemoteHttpServer } = await import(pathToFileURL(join(oldMain, 'dist-server/http-app.js')).href)
  const { createSession } = await import(pathToFileURL(join(oldMain, 'dist-server/auth.js')).href)
  const root = await mkdtemp(join(tmpdir(), 'key-preprovision-review-'))
  let server
  try {
    const files = join(root, 'files'), privateKey = join(root, 'private', 'owner-key.json')
    await mkdir(files)
    const env = {
      PATH: process.env.PATH, HOME: root,
      CODEX_REMOTE_PASSWORD: 'fake-fixture-password',
      CODEX_REMOTE_SESSION_SECRET: 'fake-session-secret'.repeat(4),
      CODEX_REMOTE_PUBLIC_ORIGIN: 'http://127.0.0.1',
      CODEX_REMOTE_WORKSPACE_ROOTS: files, CODEX_REMOTE_FILE_ROOTS: files,
    }
    await run(process.execPath, [join(release, 'operator/scripts/secure-key.mjs'), 'init', privateKey], { cwd: root, env, timeout: 10000 })
    assert.equal((await stat(join(root, 'private'))).mode & 0o777, 0o700)
    assert.equal((await stat(privateKey)).mode & 0o777, 0o600)
    const config = {
      host: '127.0.0.1', port: 5173, publicOrigin: new URL('http://127.0.0.1'),
      password: env.CODEX_REMOTE_PASSWORD, sessionSecret: env.CODEX_REMOTE_SESSION_SECRET,
      sessionTtlSeconds: 60, workspaceRoots: [files], fileRoots: ['/'], production: true,
    }
    const controller = { events: { publish() {} }, appServer: { state: 'ready' } }
    server = createRemoteHttpServer(config, controller, files, null)
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    config.port = server.address().port
    const address = `http://127.0.0.1:${server.address().port}/api/files/content?${new URLSearchParams({ path: privateKey })}`
    const unauthenticated = await fetch(address)
    assert.equal(unauthenticated.status, 401); await unauthenticated.body.cancel()
    const session = createSession(config.sessionSecret, 60)
    const response = await fetch(address, { headers: { Cookie: `codex_remote_session=${session.token}` } })
    assert.equal(response.status, 200)
    assert.equal(digest(Buffer.from(await response.arrayBuffer())), digest(await readFile(privateKey)))
    // Output deliberately contains no key, token, file content or production secret.
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)) }
    await rm(root, { recursive: true, force: true })
  }
})

test('P1 inverse control: runner requires key in preflight before gate-public-ingress', async () => {
  const source = resolve(import.meta.dirname, 'production.mjs')
  const text = await readFile(source, 'utf8')
  assert.match(text, /key = await candidateConfig\(\)/)
  assert.match(text, /async preflight\(\) \{ const result = await gates\(true, true\)/)
  const { execute } = await import('./runner.mjs')
  const phases = []
  const ops = {
    acquire: async () => {}, release: async () => {}, state: async () => {},
    preflight: async () => { phases.push('requires-existing-key'); throw Error('fake-key-unavailable') },
    gateIngress: async () => { phases.push('gate-public-ingress') },
  }
  await assert.rejects(execute(ops), /fake-key-unavailable/)
  assert.deepEqual(phases, ['requires-existing-key'])
})
