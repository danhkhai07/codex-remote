import { EventEmitter } from 'node:events'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

export type JsonRpcId = string | number

export type AppServerMessage = {
  id?: JsonRpcId
  method?: string
  params?: unknown
  result?: unknown
  error?: { code?: number; message?: string; data?: unknown }
}

type PendingRpc = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export type AppServerState = 'stopped' | 'starting' | 'ready' | 'failed'

function redactLog(line: string): string {
  return line
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, '$1[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[redacted-api-key]')
    .slice(0, 32_000)
}

export class CodexAppServer extends EventEmitter {
  readonly #command: string
  readonly #commandArgs: string[]
  #child: ChildProcessWithoutNullStreams | null = null
  #state: AppServerState = 'stopped'
  #startPromise: Promise<void> | null = null
  #nextId = 1
  #pending = new Map<JsonRpcId, PendingRpc>()
  #stopping = false

  constructor(command = 'codex', commandArgs: string[] = []) {
    super()
    this.#command = command
    this.#commandArgs = commandArgs
  }

  get state(): AppServerState {
    return this.#state
  }

  async start(): Promise<void> {
    if (this.#state === 'ready') return
    if (this.#startPromise) return this.#startPromise

    this.#startPromise = this.#startInternal()
    try {
      await this.#startPromise
    } finally {
      this.#startPromise = null
    }
  }

  async #startInternal(): Promise<void> {
    this.#setState('starting')
    this.#stopping = false
    const childEnvironment = { ...process.env }
    for (const key of Object.keys(childEnvironment)) {
      if (key.startsWith('CODEX_REMOTE_')) delete childEnvironment[key]
    }
    const child = spawn(this.#command, [...this.#commandArgs, 'app-server', '--stdio'], {
      env: childEnvironment,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.#child = child

    createInterface({ input: child.stdout }).on('line', (line) => this.#handleLine(line))
    createInterface({ input: child.stderr }).on('line', (line) => this.emit('log', redactLog(line)))

    child.once('error', (error) => {
      this.emit('log', `Codex App Server failed to start: ${error.message}`)
      this.#failPending(error)
      this.#setState('failed')
    })
    child.once('exit', (code, signal) => {
      const reason = new Error(`Codex App Server exited (${signal ?? code ?? 'unknown'})`)
      this.#child = null
      this.#failPending(reason)
      this.#setState(this.#stopping ? 'stopped' : 'failed')
      if (!this.#stopping) this.emit('log', reason.message)
    })

    await this.#requestRaw('initialize', {
      clientInfo: {
        name: 'codex_remote_control',
        title: 'Codex Remote Control',
        version: '0.1.0',
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        mcpServerOpenaiFormElicitation: true,
      },
    }, 20_000)
    this.notify('initialized', {})
    this.#setState('ready')
  }

  async request(method: string, params: unknown, timeoutMs = 60_000, beforeDispatch?: () => void): Promise<unknown> {
    beforeDispatch?.()
    await this.start()
    // Startup/reconnect may await I/O. Reauthorize at the final synchronous pipe write.
    beforeDispatch?.()
    return this.#requestRaw(method, params, timeoutMs)
  }

  notify(method: string, params: unknown): void {
    this.#write({ method, params })
  }

  respond(id: JsonRpcId, result: unknown): void {
    this.#write({ id, result })
  }

  respondError(id: JsonRpcId, code: number, message: string): void {
    this.#write({ id, error: { code, message } })
  }

  stop(): void {
    this.#stopping = true
    this.#child?.kill('SIGTERM')
  }

  #requestRaw(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      timer.unref()
      this.#pending.set(id, { resolve, reject, timer })
      try {
        this.#write({ method, id, params })
      } catch (error) {
        clearTimeout(timer)
        this.#pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  #write(message: AppServerMessage): void {
    if (!this.#child?.stdin.writable) throw new Error('Codex App Server is unavailable')
    this.#child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  #handleLine(line: string): void {
    // Full thread histories can exceed 5 MB even for ordinary document work.
    // Keep a bounded allowance large enough for those RPC responses.
    if (Buffer.byteLength(line) > 32_000_000) {
      this.emit('log', 'Discarded an oversized Codex App Server message')
      return
    }

    let message: AppServerMessage
    try {
      message = JSON.parse(line) as AppServerMessage
    } catch {
      this.emit('log', `Unparseable Codex App Server output: ${redactLog(line)}`)
      return
    }

    if (message.id !== undefined && message.method === undefined) {
      const pending = this.#pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.#pending.delete(message.id)
      if (message.error) {
        pending.reject(new Error(message.error.message ?? `RPC error ${message.error.code ?? 'unknown'}`))
      } else {
        pending.resolve(message.result)
      }
      return
    }

    // RPC results (especially thread/read histories) belong only to the caller.
    // Publishing them retains repeated full histories in the SSE replay ring.
    this.emit('message', message)

    if (message.method && message.id !== undefined) {
      this.emit('serverRequest', message)
      return
    }
    if (message.method) this.emit('notification', message)
  }

  #failPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.#pending.clear()
  }

  #setState(state: AppServerState): void {
    if (state === this.#state) return
    this.#state = state
    this.emit('state', state)
  }
}
