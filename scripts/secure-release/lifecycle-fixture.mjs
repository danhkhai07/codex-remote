// OLD sealed watcher auth -> NEW required tunnel. Fake credentials/process/RPC only.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRemoteHttpServer } from '../../dist-server/http-app.js'
import { RemoteController } from '../../dist-server/controller.js'
import { CodexAppServer } from '../../dist-server/codex-app-server.js'
import { ContextVault } from '../../dist-server/context-vault.js'
import { loadConfig } from '../../dist-server/config.js'
import { randomId } from '../../dist-server/secure-wire.js'
import { maintenanceClient } from '../secure-maintenance.mjs'
import { restartReadiness } from '../restart-readiness.mjs'
const release = resolve(process.argv[2]), run = promisify(execFile)
const root = await mkdtemp(join(tmpdir(), 'release-lifecycle-'))
let oldServer, server, controller, client
try {
  const files = join(root, 'files'), vault = join(root, 'vault'), key = join(root, 'owner.json'); await mkdir(files); await mkdir(vault)
  await writeFile(key, JSON.stringify({ version: 1, app: randomId(), generation: randomId(), key: randomId(32) }), { mode: 0o600 })
  const { getSession } = await import(pathToFileURL(join(release, 'old/dist-server/auth.js')).href)
  const env = { PATH: process.env.PATH, HOME: root, CODEX_REMOTE_PASSWORD: 'fixture password only', CODEX_REMOTE_SESSION_SECRET: 'fixture secret'.repeat(4), CODEX_REMOTE_PUBLIC_ORIGIN: 'http://127.0.0.1', CODEX_REMOTE_WORKSPACE_ROOTS: files, CODEX_REMOTE_FILE_ROOTS: files, CODEX_REMOTE_CONTEXT_VAULT: vault, CODEX_REMOTE_SECURE_API: 'required', CODEX_REMOTE_SECURE_KEY_FILE: key, CODEX_REMOTE_SESSION_STATE: join(root, 'sessions.json') }
  oldServer = createServer((req, res) => {
    if (!getSession(req, env.CODEX_REMOTE_SESSION_SECRET, false)) { res.writeHead(401); res.end('{}'); return }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(req.url === '/api/threads' ? { data: [{ id: 'fake', status: { type: 'idle' } }] } : { data: [] }))
  })
  oldServer.listen(0, '127.0.0.1'); await once(oldServer, 'listening'); env.CODEX_REMOTE_PORT = String(oldServer.address().port)
  const oldCheck = () => run(process.execPath, [join(release, 'old/scripts/restart-when-idle.mjs'), '--check'], { env, cwd: root, timeout: 15000 })
  assert.equal(JSON.parse((await oldCheck()).stdout).ready, true)
  oldServer.closeAllConnections(); await new Promise(resolve => oldServer.close(resolve)); oldServer = null
  const config = loadConfig(env)
  controller = new RemoteController(config, new CodexAppServer(process.execPath, [resolve('server/fixtures/plan-questions.mjs')]), new ContextVault(vault))
  await controller.start()
  server = createRemoteHttpServer(config, controller, files, null)
  server.listen(config.port, '127.0.0.1'); await once(server, 'listening'); config.publicOrigin = new URL('http://127.0.0.1:' + config.port)
  await assert.rejects(oldCheck(), 'old cookie-only readiness cannot be used against required tunnel')
  client = await maintenanceClient(config)
  const ready = await restartReadiness(async path => { const response = await client.fetch(path); assert(response.ok); return response.json() })
  assert.equal(ready.ready, true)
  console.log(JSON.stringify({ oldSealedWatcherAuthenticated: true, oldAdapterRejectedAfterReplacement: true, newEncryptedAdapterVerified: true, realFakeGatewayLifecycle: true, nativeModelTurns: 0, productionRestarts: 0 }))
} finally {
  client?.close(); controller?.stop()
  for (const item of [oldServer, server]) if (item) { item.closeAllConnections(); await new Promise(resolve => item.close(resolve)) }
  await rm(root, { recursive: true, force: true })
}
