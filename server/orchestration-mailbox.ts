import { renameSync, unlinkSync } from 'node:fs'
import { ContextVaultError } from './context-vault.js'
import { VaultFiles } from './vault-files.js'

/** File transport for native sandboxes that deny AF_UNIX as well as TCP. */
export class OrchestrationMailbox {
  #files: VaultFiles
  #folders = new Map<string, string>()
  #running = new Set<string>()
  #timer?: ReturnType<typeof setInterval>
  constructor(root: string, private command: (token: string, body: Record<string, unknown>, threadId: string) => Promise<unknown>) {
    this.#files = new VaultFiles(root)
  }
  register(threadId: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(threadId)) throw new Error('Invalid mailbox thread')
    const folder = `Conversations/${threadId}/.orchestration`
    this.#files.write(`${folder}/.ready`, 'Codex Remote private command mailbox\n')
    this.#folders.set(threadId, folder)
    for (const name of this.#files.list(folder)) {
      if (!/^[a-f0-9-]{36}\.(request|response|processing)\.json$/.test(name)) continue
      const local = `${folder}/${name}`, stat = this.#files.inspect(local)
      if (stat?.isFile() && stat.mtimeMs < Date.now() - 24 * 60 * 60_000) unlinkSync(this.#files.path(local))
    }
    return this.#files.path(folder)
  }
  revoke(threadId: string) { this.#folders.delete(threadId) }
  start() {
    this.#timer = setInterval(() => this.poll(), 200)
    this.#timer.unref()
  }
  stop() { clearInterval(this.#timer); this.#folders.clear() }
  poll() {
    for (const [threadId, folder] of this.#folders) {
      try {
        for (const name of this.#files.list(folder).filter(name => /^[a-f0-9-]{36}\.request\.json$/.test(name)).slice(0, 8)) {
          const local = `${folder}/${name}`
          if (this.#running.has(local)) continue
          this.#running.add(local)
          void this.#handle(threadId, local).finally(() => this.#running.delete(local)).catch(error => console.error('Conversation mailbox failed:', error instanceof Error ? error.message : error))
        }
      } catch (error) { console.error('Cannot inspect conversation mailbox:', error instanceof Error ? error.message : error) }
    }
  }
  async #handle(threadId: string, local: string) {
    const claimed = local.replace('.request.json', '.processing.json'), response = local.replace('.request.json', '.response.json')
    let status = 200, body: unknown
    try {
      const stat = this.#files.inspect(local)
      if (!stat?.isFile() || stat.size > 128 * 1024) throw new ContextVaultError(413, 'Invalid or oversized mailbox command')
      this.#files.inspect(claimed)
      renameSync(this.#files.path(local), this.#files.path(claimed))
      let input: { capability?: unknown; command?: unknown }
      try { input = JSON.parse(this.#files.read(claimed) ?? '') } catch { throw new ContextVaultError(400, 'Invalid JSON command') }
      if (!input || typeof input.capability !== 'string' || !input.command || typeof input.command !== 'object' || Array.isArray(input.command)) throw new ContextVaultError(400, 'Invalid mailbox command')
      body = await this.command(input.capability, input.command as Record<string, unknown>, threadId)
    } catch (error) {
      status = error instanceof ContextVaultError ? error.status : 500
      body = { error: error instanceof ContextVaultError ? error.message : 'Command failed; check status before retrying with the same requestId' }
    }
    this.#files.write(response, JSON.stringify({ status, body }))
    for (const path of [claimed, local]) {
      try { if (this.#files.inspect(path)?.isFile()) unlinkSync(this.#files.path(path)) } catch { /* A completed response is already available. */ }
    }
  }
}
