// Owned loopback process. Fake credentials; real baseline/new HTTP implementation.
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
const [mode, root] = process.argv.slice(2), env = parseEnv(readFileSync(join(root, 'main/.env'), 'utf8'))
let server, controller
if (mode === 'old') {
  const { createRemoteHttpServer } = await import('/root/RUNNING-SERVICES/codex-remote/dist-server/http-app.js')
  const config = { host: '127.0.0.1', port: Number(env.CODEX_REMOTE_PORT), publicOrigin: new URL(env.CODEX_REMOTE_PUBLIC_ORIGIN), password: env.CODEX_REMOTE_PASSWORD, sessionSecret: env.CODEX_REMOTE_SESSION_SECRET, sessionTtlSeconds: 60, workspaceRoots: [env.CODEX_REMOTE_FILE_ROOTS], fileRoots: ['/'], production: true }
  server = createRemoteHttpServer(config, { events: { publish() {} }, appServer: { state: 'ready' } }, env.CODEX_REMOTE_FILE_ROOTS, null)
  // Synthetic upgraded connection held by the same old process, to verify shutdown.
  server.removeAllListeners('upgrade'); server.on('upgrade', (_req, socket) => { socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\n') })
} else {
  const base = '/root/WORKTREES/cr-secure-api-review-fixes'
  const { createRemoteHttpServer } = await import(pathToFileURL(base + '/dist-server/http-app.js'))
  const { RemoteController } = await import(pathToFileURL(base + '/dist-server/controller.js'))
  const { CodexAppServer } = await import(pathToFileURL(base + '/dist-server/codex-app-server.js'))
  const { ContextVault } = await import(pathToFileURL(base + '/dist-server/context-vault.js'))
  const { ServicesStore } = await import(pathToFileURL(base + '/dist-server/services.js'))
  const { loadConfig } = await import(pathToFileURL(base + '/dist-server/config.js'))
  const config = loadConfig({ ...env, NODE_ENV: 'production' })
  controller = new RemoteController(config, new CodexAppServer(process.execPath, [base + '/server/fixtures/plan-questions.mjs']), new ContextVault(env.CODEX_REMOTE_CONTEXT_VAULT))
  await controller.start()
  server = createRemoteHttpServer(config, controller, env.CODEX_REMOTE_FILE_ROOTS, null, undefined, undefined, undefined, undefined, undefined, new ServicesStore(join(root, 'services.json')))
}
server.listen(Number(env.CODEX_REMOTE_PORT), '127.0.0.1', () => process.send({ ready: true, pid: process.pid }))
process.on('message', value => { if (value === 'shutdown') { controller?.stop(); server.closeAllConnections(); server.close(() => process.exit()) } })
