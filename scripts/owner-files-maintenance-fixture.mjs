// Disposable required-encrypted instance only; no native startup or production configuration.
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { loadConfig } from '../dist-server/config.js'
import { createRemoteHttpServer } from '../dist-server/http-app.js'
import { RemoteController } from '../dist-server/controller.js'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
import { maintenanceClient } from './secure-maintenance.mjs'
const root = await mkdtemp(join(tmpdir(), 'owner-maintenance-'))
let server, client
try {
  const random = n => randomBytes(n).toString('base64url')
  const keyFile = join(root, '.owner-key.json'), material = { version: 1, app: random(18), generation: random(18), key: random(32) }
  await writeFile(keyFile, JSON.stringify(material), { mode: 0o600 })
  const config = loadConfig({ NODE_ENV: 'production', CODEX_REMOTE_PASSWORD: 'FAKE maintenance password', CODEX_REMOTE_SESSION_SECRET: 'FAKE-session'.repeat(5), CODEX_REMOTE_PUBLIC_ORIGIN: 'http://127.0.0.1', CODEX_REMOTE_WORKSPACE_ROOTS: root, CODEX_REMOTE_FILE_ROOTS: '/', CODEX_REMOTE_FILE_ACCESS: 'owner-full', CODEX_REMOTE_SECURE_API: 'required', CODEX_REMOTE_SECURE_KEY_FILE: keyFile, CODEX_REMOTE_SESSION_STATE: join(root, 'sessions.json') })
  server = createRemoteHttpServer(config, new RemoteController(config, new CodexAppServer('unused')), root, null)
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); config.port = server.address().port; config.publicOrigin = new URL('http://127.0.0.1:' + config.port)
  client = await maintenanceClient(config)
  const result = await client.fetch('/api/files/roots'); assert.equal(result.status, 200); assert((await result.json()).roots.includes('/'))
  await chmod(keyFile, 0o644)
  await assert.rejects(maintenanceClient(config))
  console.log('PASS owner-full encrypted maintenance / roots; unsafe key permissions rejected; no key output or native turn')
} finally {
  client?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await rm(root, { recursive: true, force: true })
}
