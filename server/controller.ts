import { randomUUID } from 'node:crypto'
import type { RemoteConfig } from './config.js'
import { CodexAppServer, type AppServerMessage, type JsonRpcId } from './codex-app-server.js'
import { EventHub } from './event-hub.js'

type PendingRequest = {
  key: string
  rpcId: JsonRpcId
  method: string
  params: Record<string, unknown>
  createdAt: string
}

const APPROVAL_DECISIONS = new Set(['accept', 'acceptForSession', 'decline', 'cancel'])
const APPROVAL_POLICIES = new Set(['on-request', 'never'])

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function threadFromResult(result: unknown): Record<string, unknown> {
  return asObject(asObject(result).thread)
}

export class RemoteController {
  readonly appServer: CodexAppServer
  readonly events = new EventHub()
  readonly #config: RemoteConfig
  readonly #pending = new Map<string, PendingRequest>()
  readonly #loadedThreads = new Map<string, Record<string, unknown>>()
  readonly #resumedThreads = new Set<string>()
  readonly #models = new Map<string, Record<string, unknown>>()
  onTurnCompleted?: (threadId: string, turnId: string) => void

  constructor(config: RemoteConfig, appServer = new CodexAppServer(config.codexBin)) {
    this.#config = config
    this.appServer = appServer

    appServer.on('message', (message: AppServerMessage) => this.events.publish('codex', message))
    appServer.on('notification', (message: AppServerMessage) => {
      if (message.method === 'serverRequest/resolved') this.#resolvePendingFromNotification(message.params)
      if (message.method === 'turn/completed') {
        const params = asObject(message.params)
        const turn = asObject(params.turn)
        if (typeof params.threadId === 'string' && typeof turn.id === 'string' && this.#loadedThreads.has(params.threadId)) {
          try { this.onTurnCompleted?.(params.threadId, turn.id) }
          catch { console.error('Unable to queue completion notification') }
        }
      }
    })
    appServer.on('serverRequest', (message: AppServerMessage) => this.#registerRequest(message))
    appServer.on('log', (line: string) => this.events.publish('server-log', { line }))
    appServer.on('state', (state: string) => this.events.publish('state', { state }))
  }

  async start(): Promise<void> {
    await this.appServer.start()
    this.events.publish('state', { state: this.appServer.state })
  }

  stop(): void {
    this.appServer.stop()
  }

  get workspaces(): Array<{ id: string; label: string; path: string }> {
    return this.#config.workspaceRoots.map((path, index) => ({
      id: String(index),
      label: path.split('/').filter(Boolean).at(-1) ?? path,
      path,
    }))
  }

  listPending(): Omit<PendingRequest, 'rpcId'>[] {
    return [...this.#pending.values()].map(({ rpcId: _rpcId, ...request }) => request)
  }

  async listThreads(): Promise<unknown> {
    const result = await this.appServer.request('thread/list', {
      limit: 100,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      archived: false,
      cwd: this.#config.workspaceRoots,
    })
    const rows = asObject(result).data
    if (Array.isArray(rows)) {
      const allowed = rows.map(asObject).filter((thread) => this.#isAllowedThread(thread))
      for (const thread of allowed) this.#cacheThread(thread)
      return { ...asObject(result), data: allowed }
    }
    return result
  }

  async listModels(): Promise<unknown> {
    const result = await this.appServer.request('model/list', {
      limit: 100,
      includeHidden: false,
    })
    const rows = asObject(result).data
    if (!Array.isArray(rows)) return result

    const models = rows.map(asObject).filter((entry) => {
      const model = entry.model ?? entry.id
      return typeof model === 'string' && model.length > 0 && entry.hidden !== true
    })
    this.#models.clear()
    for (const entry of models) {
      const model = String(entry.model ?? entry.id)
      this.#models.set(model, entry)
    }
    return {
      ...asObject(result),
      data: models.map((entry) => ({ ...entry, model: String(entry.model ?? entry.id) })),
    }
  }

  async readRateLimits(): Promise<unknown> {
    return this.appServer.request('account/rateLimits/read', {})
  }

  async createThread(workspaceId: unknown): Promise<unknown> {
    const cwd = this.#workspacePath(workspaceId)
    const result = await this.appServer.request('thread/start', {
      cwd,
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandbox: 'workspace-write',
      serviceName: 'codex_remote_control',
    })
    this.#markResumed(threadFromResult(result))
    return result
  }

  async readThread(threadId: string): Promise<unknown> {
    try {
      const result = await this.appServer.request('thread/read', { threadId, includeTurns: true })
      this.#assertAllowedThread(result)
      this.#cacheThread(threadFromResult(result))
      return result
    } catch (error) {
      if (!(error instanceof Error)) throw error
      const recoverable = error.message.includes('no rollout found') ||
        error.message.includes('list_turns is not supported')
      if (!recoverable) throw error

      let cached = this.#loadedThreads.get(threadId)
      if (!cached && error.message.includes('list_turns is not supported')) {
        cached = threadFromResult(await this.#readThreadMetadata(threadId))
      }
      if (!cached) throw error
      return { thread: { ...cached, turns: [], historyUnavailable: true } }
    }
  }

  async resumeThread(threadId: string): Promise<unknown> {
    const loaded = this.#loadedThreads.get(threadId)
    if (loaded && this.#resumedThreads.has(threadId)) return { thread: loaded }
    const current = loaded ?? threadFromResult(await this.#readThreadMetadata(threadId))
    const cwd = String(current.cwd ?? '')
    const result = await this.appServer.request('thread/resume', {
      threadId,
      cwd,
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandbox: 'workspace-write',
      excludeTurns: true,
    })
    this.#assertAllowedThread(result)
    const resumed = { ...threadFromResult(result), turns: [], historyUnavailable: true }
    this.#markResumed(resumed)
    return { ...asObject(result), thread: resumed }
  }

  async archiveThread(threadId: string): Promise<unknown> {
    if (!this.#loadedThreads.has(threadId)) await this.#readThreadMetadata(threadId)
    const result = await this.appServer.request('thread/archive', { threadId })
    this.#loadedThreads.delete(threadId)
    this.#resumedThreads.delete(threadId)
    return result
  }

  async startTurn(threadId: string, text: unknown, model: unknown = undefined, effort: unknown = undefined, approvalPolicy: unknown = 'on-request', imagePaths: readonly string[] = []): Promise<unknown> {
    if (typeof text !== 'string') throw new Error('Instruction text must be a string')
    if (!text.trim() && imagePaths.length === 0) throw new Error('Instruction text or an image is required')
    if (text.length > 100_000) throw new Error('Instruction text is too long')
    if (typeof approvalPolicy !== 'string' || !APPROVAL_POLICIES.has(approvalPolicy)) {
      throw new Error('Invalid approval policy')
    }
    const overrides: { model?: string; effort?: string } = {}
    if (model !== undefined && model !== null) {
      if (typeof model !== 'string' || !model.trim() || model.length > 120) throw new Error('Invalid model')
      if (this.#models.size === 0) await this.listModels()
      const selected = this.#models.get(model)
      if (!selected) {
        const available = [...this.#models.keys()]
        throw new Error(`Unknown model: ${model} (available: ${available.length ? available.slice(0, 50).join(', ') : 'none'})`)
      }
      overrides.model = model

      if (effort !== undefined && effort !== null) {
        if (typeof effort !== 'string' || !effort) throw new Error('Invalid reasoning effort')
        const supported = Array.isArray(selected.supportedReasoningEfforts)
          ? selected.supportedReasoningEfforts.map(asObject).map((entry) => entry.reasoningEffort)
          : []
        if (supported.length > 0 && !supported.includes(effort)) {
          throw new Error('Reasoning effort is not supported by this model')
        }
        overrides.effort = effort
      }
    } else if (effort !== undefined && effort !== null) {
      throw new Error('A model is required when setting reasoning effort')
    }

    const resumed = this.#resumedThreads.has(threadId)
      ? { thread: this.#loadedThreads.get(threadId) }
      : await this.resumeThread(threadId)
    const cwd = String(threadFromResult(resumed).cwd ?? '')
    return this.appServer.request('turn/start', {
      threadId,
      cwd,
      approvalPolicy,
      approvalsReviewer: 'user',
      input: [
        ...(text.trim() ? [{ type: 'text', text: text.trim(), text_elements: [] }] : []),
        ...imagePaths.map(path => ({ type: 'localImage', path })),
      ],
      ...overrides,
    })
  }

  async interruptTurn(threadId: string, turnId: unknown): Promise<unknown> {
    if (typeof turnId !== 'string' || !turnId) throw new Error('turnId is required')
    if (!this.#resumedThreads.has(threadId)) await this.resumeThread(threadId)
    return this.appServer.request('turn/interrupt', { threadId, turnId })
  }

  respondToRequest(key: string, body: unknown): void {
    const request = this.#pending.get(key)
    if (!request) throw new Error('The request is no longer pending')
    const value = asObject(body)

    switch (request.method) {
      case 'item/commandExecution/requestApproval':
      case 'item/fileChange/requestApproval': {
        const decision = value.decision
        if (typeof decision !== 'string' || !APPROVAL_DECISIONS.has(decision)) {
          throw new Error('Invalid approval decision')
        }
        this.appServer.respond(request.rpcId, { decision })
        break
      }
      case 'item/tool/requestUserInput': {
        const answers = asObject(value.answers)
        const normalized: Record<string, { answers: string[] }> = {}
        for (const [questionId, answer] of Object.entries(answers)) {
          const values = asObject(answer).answers
          if (!Array.isArray(values) || values.some((entry) => typeof entry !== 'string')) {
            throw new Error(`Invalid answer for ${questionId}`)
          }
          normalized[questionId] = { answers: values as string[] }
        }
        this.appServer.respond(request.rpcId, { answers: normalized })
        break
      }
      case 'mcpServer/elicitation/request': {
        const action = value.action
        if (!['accept', 'decline', 'cancel'].includes(String(action))) {
          throw new Error('Invalid elicitation action')
        }
        this.appServer.respond(request.rpcId, {
          action,
          content: action === 'accept' ? asObject(value.content) : null,
        })
        break
      }
      case 'item/permissions/requestApproval': {
        const params = request.params
        const requestedPermissions = asObject(params.permissions)
        const accept = value.decision === 'accept'
        this.appServer.respond(request.rpcId, {
          permissions: accept ? requestedPermissions : {},
          scope: value.scope === 'session' ? 'session' : 'turn',
        })
        break
      }
      default:
        if (value.action !== 'cancel') throw new Error('This request can only be cancelled')
        this.appServer.respondError(request.rpcId, -32_000, 'Cancelled by the remote user')
    }

    this.#pending.delete(key)
    this.events.publish('request-resolved', { key, method: request.method })
  }

  #workspacePath(workspaceId: unknown): string {
    const index = Number(workspaceId ?? 0)
    if (!Number.isInteger(index) || index < 0 || index >= this.#config.workspaceRoots.length) {
      throw new Error('Unknown workspace')
    }
    return this.#config.workspaceRoots[index]
  }

  async #readThreadMetadata(threadId: string): Promise<unknown> {
    const result = await this.appServer.request('thread/read', { threadId, includeTurns: false })
    this.#assertAllowedThread(result)
    this.#cacheThread(threadFromResult(result))
    return result
  }

  #cacheThread(thread: Record<string, unknown>): void {
    const id = thread.id
    const cwd = String(thread.cwd ?? '')
    if (typeof id === 'string' && this.#config.workspaceRoots.includes(cwd)) {
      this.#loadedThreads.set(id, { ...this.#loadedThreads.get(id), ...thread })
    }
  }

  #markResumed(thread: Record<string, unknown>): void {
    this.#cacheThread(thread)
    if (typeof thread.id === 'string' && this.#loadedThreads.has(thread.id)) {
      this.#resumedThreads.add(thread.id)
    }
  }

  #isAllowedThread(thread: Record<string, unknown>): boolean {
    return this.#config.workspaceRoots.includes(String(thread.cwd ?? ''))
  }

  #assertAllowedThread(result: unknown): void {
    const cwd = String(threadFromResult(result).cwd ?? '')
    if (!this.#config.workspaceRoots.includes(cwd)) throw new Error('Thread is outside the configured workspaces')
  }

  #registerRequest(message: AppServerMessage): void {
    if (message.id === undefined || !message.method) return
    const request: PendingRequest = {
      key: randomUUID(),
      rpcId: message.id,
      method: message.method,
      params: asObject(message.params),
      createdAt: new Date().toISOString(),
    }
    this.#pending.set(request.key, request)
    const { rpcId: _rpcId, ...publicRequest } = request
    this.events.publish('request', publicRequest)
  }

  #resolvePendingFromNotification(params: unknown): void {
    const requestId = asObject(params).requestId
    for (const [key, request] of this.#pending) {
      if (String(request.rpcId) === String(requestId)) {
        this.#pending.delete(key)
        this.events.publish('request-resolved', { key, method: request.method })
      }
    }
  }
}
