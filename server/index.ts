import { WorkHoursStore } from './work-hours.js'
import { WorkPresence } from './work-presence.js'
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

const hoursFile = process.env.CODEX_REMOTE_WORK_HOURS_FILE?.trim()
const workHours = hoursFile ? new WorkHoursStore(hoursFile) : undefined
const controller = new RemoteController(config)
const presenceFile = process.env.CODEX_REMOTE_WORK_PRESENCE_FILE?.trim()
const workPresence = presenceFile ? new WorkPresence(presenceFile) : undefined
controller.appServer.on('notification', (message) => {
  if (!workPresence || !['turn/started', 'turn/completed'].includes(message.method)) return
  const params = message.params ?? {}, turn = params.turn ?? {}
  if (typeof params.threadId === 'string' && typeof turn.id === 'string') {
    workPresence.processing(params.threadId, turn.id, message.method === 'turn/started')
  }
})
// push.js persists via atomic sibling-.tmp + rename(), so its state file must
// live inside a writable *directory* — not on a bind-mounted single file. The
// container sets CODEX_REMOTE_PUSH_STATE to a path under a host-backed dir
// mount; local runs keep the repo-root default.
const pushState = process.env.CODEX_REMOTE_PUSH_STATE?.trim() || resolve(packageRoot, '.remote-push.json')
const push = new PushService(pushState, config.sessionSecret, config.publicOrigin.origin)
const attachments = new AttachmentStore()
controller.onTurnCompleted = (threadId, turnId, answer) => {
  attachments.completeTurn(turnId)
  push.completed(threadId, turnId, answer)
}
await controller.start()
push.start()

const server = createRemoteHttpServer(config, controller, distRoot, vite, push, attachments, workPresence, workHours)
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
