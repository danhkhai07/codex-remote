import { createServer, type Server } from 'node:http'
import { connect } from 'node:net'
import { chmodSync, lstatSync, unlinkSync } from 'node:fs'
import { ContextVaultError } from './context-vault.js'
import type { ConversationOrchestrator } from './orchestration.js'

/** Local IPC also works without granting the agent network access or the app's login secret. */
export async function listenOrchestration(orchestrator: ConversationOrchestrator): Promise<Server> {
  const path = orchestrator.socketPath
  try {
    const stat = lstatSync(path)
    if (!stat.isSocket()) throw new Error('Orchestration socket path is occupied by a non-socket file')
    const live = await new Promise<boolean>((resolve, reject) => {
      const socket = connect(path)
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', error => { if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') resolve(false); else reject(error) })
    })
    if (live) throw new Error('Orchestration socket is already in use')
    unlinkSync(path)
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || req.url !== '/command') throw new ContextVaultError(404, 'Unknown command route')
      const token = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1]
      if (!token) throw new ContextVaultError(403, 'A leader turn capability is required')
      let size = 0
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        size += chunk.length
        if (size > 128 * 1024) throw new ContextVaultError(413, 'Command is too large')
        chunks.push(Buffer.from(chunk))
      }
      let body: unknown
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new ContextVaultError(400, 'Invalid JSON command') }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ContextVaultError(400, 'Command must be an object')
      const result = await orchestrator.command(token, body as Record<string, unknown>)
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(result))
    } catch (error) {
      res.writeHead(error instanceof ContextVaultError ? error.status : 500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ error: error instanceof ContextVaultError ? error.message : 'Conversation command failed; check status before retrying' }))
    }
  })
  server.requestTimeout = 30_000
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, () => { server.off('error', reject); resolve() }) })
  chmodSync(path, 0o600)
  return server
}
