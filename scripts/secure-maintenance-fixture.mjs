// Post-build local CLI integration with fake credentials and no native/model RPC.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createRemoteHttpServer } from '../dist-server/http-app.js'
import { RemoteController } from '../dist-server/controller.js'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
import { ContextVault } from '../dist-server/context-vault.js'
import { ServicesStore } from '../dist-server/services.js'
import { loadConfig } from '../dist-server/config.js'
import { readOwnerKey } from '../dist-server/secure-key.js'
import { maintenanceClient } from './secure-maintenance.mjs'
import { restartReadiness } from './restart-readiness.mjs'
const run = promisify(execFile), root = await mkdtemp(join(tmpdir(), 'secure-cli-'))
let server, client, controller
try {
  const files = join(root, 'files'), vaultPath = join(root, 'vault'), key = join(root, 'private', 'owner.json')
  await mkdir(files); await mkdir(vaultPath)
  const env = { PATH: process.env.PATH, NODE_ENV: 'production', CODEX_REMOTE_PASSWORD: 'FAKE local CLI password', CODEX_REMOTE_SESSION_SECRET: 'fixture secret only'.repeat(4), CODEX_REMOTE_PUBLIC_ORIGIN: 'http://127.0.0.1', CODEX_REMOTE_WORKSPACE_ROOTS: files, CODEX_REMOTE_FILE_ROOTS: files, CODEX_REMOTE_CONTEXT_VAULT: vaultPath, CODEX_REMOTE_SESSION_STATE: join(root, 'sessions.json'), CODEX_REMOTE_SECURE_API: 'required', CODEX_REMOTE_SECURE_KEY_FILE: key }
  const cli = (script, args = []) => run(process.execPath, [resolve('scripts/' + script), ...args], { env, timeout: 15000 })
  const first = await cli('secure-key.mjs', ['init', key]), original = readOwnerKey(key, [files, vaultPath])
  assert.equal((await stat(key)).mode & 0o777, 0o600); assert(!first.stdout.includes(original.key)); assert(!first.stderr.includes(original.key))
  await assert.rejects(cli('secure-key.mjs', ['init', key]))
  await assert.rejects(cli('secure-key.mjs', ['init', join(files, 'hidden', 'key.json')]))
  await symlink(files, join(root, 'linked'))
  await assert.rejects(cli('secure-key.mjs', ['init', join(root, 'linked', 'key.json')]))
  const config = loadConfig(env), vault = new ContextVault(vaultPath)
  controller = new RemoteController(config, new CodexAppServer(process.execPath, [resolve('server/fixtures/plan-questions.mjs')]), vault)
  await controller.start()
  server = createRemoteHttpServer(config, controller, files, null, undefined, undefined, undefined, undefined, undefined, new ServicesStore(join(root, 'services.json')))
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); config.port = server.address().port; config.publicOrigin = new URL('http://127.0.0.1:' + config.port)
  env.CODEX_REMOTE_PORT = String(config.port); env.CODEX_REMOTE_PUBLIC_ORIGIN = config.publicOrigin.origin
  client = await maintenanceClient({ ...config, secureApiRequired: false }) // Discover production mode even without inherited NODE_ENV.
  const initialSession = await client.fetch('/api/session'); assert.equal(initialSession.status, 200); await initialSession.arrayBuffer()
  const note = join(root, 'note.md'); await writeFile(note, 'FAKE CLI KNOWLEDGE CANARY')
  const written = JSON.parse((await cli('knowledge.mjs', ['write', '--path', 'References/Fixture.md', '--file', note, '--revision', '', '--actor', 'fixture'])).stdout)
  const read = JSON.parse((await cli('knowledge.mjs', ['read', '--path', 'References/Fixture.md'])).stdout)
  assert.equal(read.content, 'FAKE CLI KNOWLEDGE CANARY'); assert.equal(read.revision, written.revision)
  await assert.rejects(cli('knowledge.mjs', ['write', '--path', 'References/Fixture.md', '--file', note, '--revision', '', '--actor', 'fixture']))
  const services = JSON.parse((await cli('services.mjs', ['list'])).stdout); assert(Array.isArray(services.services))
  const readiness = await restartReadiness(async path => { const response = await client.fetch(path); assert.equal(response.status, 200); return response.json() }); assert.equal(readiness.ready, true)
  const rotated = await cli('secure-key.mjs', ['rotate', key]), next = JSON.parse(await readFile(key, 'utf8'))
  assert.equal(next.app, original.app); assert.notEqual(next.generation, original.generation); assert.notEqual(next.key, original.key)
  assert(!rotated.stdout.includes(next.key)); assert.equal((await stat(key)).mode & 0o777, 0o600)
  await assert.rejects(client.fetch('/api/session'), error => error.status === 412)
  client.close(); client = await maintenanceClient(config)
  const session = await client.fetch('/api/session'); assert.equal(session.status, 200); await session.arrayBuffer()
  console.log(JSON.stringify({ ownerOnlyProvisionAndRotation: true, noPrintedKey: true, allowedRootsAndSymlinkRejected: true, knowledgeCheckedRevision: true, services: true, restartReadinessAdapter: true, oldChannelRejected: true, nativeModelTurns: 0 }))
} finally {
  client?.close(); controller?.stop(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await rm(root, { recursive: true, force: true })
}
