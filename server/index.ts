import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.js'
import { RemoteController } from './controller.js'
import { createRemoteHttpServer } from './http-app.js'
import { PushService } from './push.js'
import { AttachmentStore } from './attachments.js'

const config = loadConfig()
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distRoot = resolve(packageRoot, 'dist')
const vite = config.production
  ? null
  : await import('vite').then(({ createServer }) => createServer({
      root: packageRoot,
      server: { middlewareMode: true },
      appType: 'spa',
    }))

const controller = new RemoteController(config)
const push = new PushService(resolve(packageRoot, '.remote-push.json'), config.sessionSecret, config.publicOrigin.origin)
const attachments = new AttachmentStore()
controller.onTurnCompleted = (threadId, turnId) => {
  attachments.completeTurn(turnId)
  push.completed(threadId, turnId)
}
await controller.start()
push.start()

const server = createRemoteHttpServer(config, controller, distRoot, vite, push, attachments)
server.listen(config.port, config.host, () => {
  console.log(`Codex Remote listening on http://${config.host}:${config.port}`)
  console.log(`Public origin: ${config.publicOrigin.origin}`)
  console.log(`Workspace roots: ${config.workspaceRoots.join(', ')}`)
})

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`Received ${signal}; stopping Codex Remote`)
  controller.stop()
  push.stop()
  attachments.stop()
  await vite?.close()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 5_000).unref()
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
