import { ContextVaultError, type ContextVault } from './context-vault.js'
import { normalizeSkills, validateSkills, type SkillList } from './skills.js'
import { completedReplyIds } from './completed-replies.js'
import type { UploadedFile } from './attachments.js'
import { randomUUID } from 'node:crypto'
import type { RemoteConfig } from './config.js'
import { CodexAppServer, type AppServerMessage, type JsonRpcId } from './codex-app-server.js'
import { EventHub } from './event-hub.js'
import { jsonBytes, limitConversation, MAX_CONVERSATION_BYTES } from './conversation-size.js'
import { ConversationOrchestrator, type TurnSettings } from './orchestration.js'
import { listenOrchestration } from './orchestration-socket.js'
import type { Server } from 'node:http'

type PendingRequest = {
  key: string
  rpcId: JsonRpcId
  method: string
  params: Record<string, unknown>
  createdAt: string
}

type AgentMessages = { order: string[]; text: Map<string, string>; completed: Map<string, Record<string, unknown>> }

export class ThreadNameError extends Error {
  readonly status = 400
}

export function normalizeThreadName(value: unknown): string {
  if (typeof value !== 'string') throw new ThreadNameError('Conversation name must be text')
  const name = value.trim()
  if (!name || name.length > 200 || [...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw new ThreadNameError('Use a name between 1 and 200 characters, on one line')
  }
  return name
}

const APPROVAL_DECISIONS = new Set(['accept', 'acceptForSession', 'decline', 'cancel'])
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
  readonly #agentMessages = new Map<string, AgentMessages>()
  readonly #interrupts = new Map<string, Promise<unknown>>()
  readonly #threadReads = new Map<string, Promise<unknown>>()
  readonly #archivingThreads = new Set<string>()
  readonly #renamingThreads = new Set<string>()
  readonly #turnStarts = new Set<string>()
  readonly #activeTurns = new Map<string, string>()
  readonly #completedTurns = new Set<string>()
  readonly orchestration?: ConversationOrchestrator
  #orchestrationSocket?: Server
  onReplyCompleted?: (threadId: string, ids: string[]) => void
  onTurnCompleted?: (threadId: string, turnId: string, answer: string) => void

  constructor(config: RemoteConfig, appServer = new CodexAppServer(config.codexBin), readonly contextVault?: ContextVault) {
    this.#config = config
    this.appServer = appServer
    if (contextVault) this.orchestration = new ConversationOrchestrator(contextVault, {
      workspaces: () => this.workspaces,
      read: async threadId => threadFromResult(await this.readThread(threadId)) as { id: string },
      inspect: async threadId => threadFromResult(await this.#readThreadMetadata(threadId)) as { id: string },
      create: async (workspaceId, groupId, settings) => threadFromResult(await this.createThread(workspaceId, settings.fullAccess, groupId)) as { id: string },
      normalizeName: normalizeThreadName,
      rename: (threadId, name, guard) => this.renameThread(threadId, name, guard),
      archive: (threadId, guard, onDispatch) => this.archiveThread(threadId, guard, onDispatch),
      start: async (threadId, text, settings, guard) => {
        const result = await this.startTurn(threadId, text, settings.model, settings.effort, settings.fullAccess, [], [], undefined, settings.mode ?? 'default', guard)
        const id = asObject(asObject(result).turn).id
        if (typeof id !== 'string') throw new Error('Codex did not return a turn ID')
        return id
      },
      interrupt: (threadId, turnId) => this.interruptTurn(threadId, turnId),
      starting: threadId => this.#turnStarts.has(threadId) || this.#activeTurns.has(threadId),
      changed: () => this.events.publish('codex', { method: 'orchestration/changed', params: {} }),
    })

    appServer.on('message', (message: AppServerMessage) => this.events.publish('codex', message))
    appServer.on('notification', (message: AppServerMessage) => {
      this.#captureAgentMessage(message)
      this.#exportContextEvent(message)
      if (message.method === 'serverRequest/resolved') this.#resolvePendingFromNotification(message.params)
      if (message.method === 'turn/started') {
        const params = asObject(message.params), turn = asObject(params.turn)
        if (typeof params.threadId === 'string' && typeof turn.id === 'string') this.#activeTurns.set(params.threadId, turn.id)
      }
      if (message.method === 'turn/completed') {
        const params = asObject(message.params)
        const turn = asObject(params.turn)
        if (typeof params.threadId === 'string' && typeof turn.id === 'string') {
          this.#clearPending(request => request.params.threadId === params.threadId && request.params.turnId === turn.id)
          this.#completedTurns.add(turn.id)
          while (this.#completedTurns.size > 256) this.#completedTurns.delete(this.#completedTurns.keys().next().value!)
          if (this.#activeTurns.get(params.threadId) === turn.id) this.#activeTurns.delete(params.threadId)
          const captured = this.#agentMessages.get(`${params.threadId}:${turn.id}`)
          const ids = completedReplyIds({ ...turn, items: Array.isArray(turn.items) && turn.items.length
            ? turn.items : [...(captured?.completed.values() ?? [])] })
          if (ids.length && this.#loadedThreads.has(params.threadId)) {
            this.events.publish('codex', { method: 'reply/completed', params: { threadId: params.threadId, ids } })
            try { this.onReplyCompleted?.(params.threadId, ids) }
            catch { console.error('Unable to persist completed reply state') }
          }
          const answer = this.#completedAnswer(params.threadId, turn.id, turn)
          this.orchestration?.completed(params.threadId, turn.id, String(turn.status ?? 'completed'), answer)
          if (this.#loadedThreads.has(params.threadId)) {
            try { this.onTurnCompleted?.(params.threadId, turn.id, answer) }
            catch { console.error('Unable to queue completion notification') }
          }
        }
      }
    })
    appServer.on('serverRequest', (message: AppServerMessage) => this.#registerRequest(message))
    appServer.on('log', (line: string) => this.events.publish('server-log', { line }))
    appServer.on('state', (state: string) => {
      if (state === 'failed' || state === 'stopped') {
        this.#activeTurns.clear(); this.#resumedThreads.clear()
        this.#clearPending(() => true)
      }
      this.events.publish('state', { state })
    })
  }

  async start(): Promise<void> {
    await this.appServer.start()
    if (this.orchestration) {
      this.#orchestrationSocket = await listenOrchestration(this.orchestration)
      await this.orchestration.start()
    }
    this.events.publish('state', { state: this.appServer.state })
  }

  stop(): void {
    this.orchestration?.stop()
    this.#orchestrationSocket?.close()
    this.#orchestrationSocket?.closeAllConnections()
    this.appServer.stop()
  }

  #recordContext(thread: Record<string, unknown>): void {
    if (!this.contextVault) return
    try { this.contextVault.recordThread(thread) }
    catch (error) { console.error('Unable to export conversation context:', error instanceof Error ? error.message : error) }
  }

  #exportContextEvent(message: AppServerMessage): void {
    if (!this.contextVault || !['item/completed', 'turn/completed'].includes(message.method ?? '')) return
    const params = asObject(message.params)
    if (typeof params.threadId !== 'string') return
    const thread = this.#loadedThreads.get(params.threadId)
    if (!thread) return
    if (message.method === 'item/completed') {
      const item = asObject(params.item)
      if (typeof params.turnId !== 'string' || !['userMessage', 'agentMessage'].includes(String(item.type))) return
      this.#recordContext({ ...thread, historyCacheTruncated: false, turns: [{ id: params.turnId, items: [item] }] })
    } else {
      const turn = asObject(params.turn)
      if (typeof turn.id !== 'string') return
      this.#recordContext({ ...thread, historyCacheTruncated: false, turns: [turn] })
      // Native history can be unavailable; item/completed exports already preserve live messages.
      void this.#readFullThread(params.threadId).then(result => {
        this.#assertAllowedThread(result)
        this.#recordContext(threadFromResult(result))
      }).catch(() => {})
    }
  }

  #captureAgentMessage(message: AppServerMessage): void {
    if (message.method !== 'item/agentMessage/delta' && message.method !== 'item/completed') return
    const params = asObject(message.params)
    if (typeof params.threadId !== 'string' || typeof params.turnId !== 'string') return
    const item = asObject(params.item)
    const itemId = typeof params.itemId === 'string' ? params.itemId : typeof item.id === 'string' ? item.id : null
    if (!itemId) return

    const delta = message.method === 'item/agentMessage/delta' && typeof params.delta === 'string' ? params.delta : null
    const completedText = message.method === 'item/completed' && ['agentMessage', 'plan'].includes(String(item.type)) && typeof item.text === 'string' ? item.text : null
    if (delta === null && completedText === null) return

    const key = `${params.threadId}:${params.turnId}`
    let messages = this.#agentMessages.get(key)
    if (!messages) {
      if (this.#agentMessages.size >= 128) this.#agentMessages.delete(this.#agentMessages.keys().next().value as string)
      messages = { order: [], text: new Map(), completed: new Map() }
      this.#agentMessages.set(key, messages)
    }
    if (completedText !== null) messages.completed.set(itemId, { ...item, text: completedText.slice(0, 16_000) })
    if (!messages.text.has(itemId)) messages.order.push(itemId)
    const text = completedText ?? `${messages.text.get(itemId) ?? ''}${delta}`
    messages.text.set(itemId, text.slice(0, 16_000))
  }

  #completedAnswer(threadId: string, turnId: string, turn: Record<string, unknown>): string {
    const key = `${threadId}:${turnId}`
    const tracked = this.#agentMessages.get(key)
    this.#agentMessages.delete(key)
    const items = Array.isArray(turn.items) ? turn.items.map(asObject) : []
    for (let index = items.length - 1; index >= 0; index--) {
      const item = items[index]
      if (['agentMessage', 'plan'].includes(String(item.type)) && typeof item.text === 'string' && item.text.trim()) return item.text
    }
    if (!tracked) return ''
    for (let index = tracked.order.length - 1; index >= 0; index--) {
      const itemId = tracked.order[index]
      const text = tracked.text.get(itemId)
      if (text?.trim()) return text
    }
    return ''
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

  async createThread(workspaceId: unknown, fullAccess: unknown = false, groupId: unknown = undefined): Promise<unknown> {
    if (typeof fullAccess !== 'boolean') throw new Error('Invalid full access setting')
    const cwd = this.#workspacePath(workspaceId)
    if (groupId !== undefined && groupId !== null) {
      if (!this.contextVault) throw new ContextVaultError(503, 'Context vault is unavailable')
      if (!this.contextVault.snapshot().groups.some(group => group.id === groupId)) throw new ContextVaultError(404, 'Conversation folder not found')
    }
    const result = await this.appServer.request('thread/start', {
      cwd,
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandbox: fullAccess ? 'danger-full-access' : 'workspace-write',
      serviceName: 'codex_remote_control',
    })
    this.#markResumed(threadFromResult(result))
    if (groupId !== undefined && groupId !== null) this.contextVault!.assignThread(String(threadFromResult(result).id), groupId)
    return result
  }

  async assertThreadAccess(threadId: string): Promise<void> {
    const thread = this.#loadedThreads.get(threadId)
    if (thread && this.#isAllowedThread(thread)) return
    await this.#readThreadMetadata(threadId)
  }

  async listWorkspaceSkills(workspaceId: unknown, forceReload = false): Promise<SkillList> {
    const cwd = this.#workspacePath(workspaceId)
    const result = await this.appServer.request('skills/list', { cwds: [cwd], forceReload })
    return normalizeSkills(result, cwd)
  }

  async listSkills(threadId: string, forceReload = false): Promise<SkillList> {
    await this.assertThreadAccess(threadId)
    const cwd = String(this.#loadedThreads.get(threadId)?.cwd ?? '')
    const result = await this.appServer.request('skills/list', { cwds: [cwd], forceReload })
    return normalizeSkills(result, cwd)
  }

  async readMessageIds(threadId: string): Promise<{ ids: string[] }> {
    const result = await this.#readFullThread(threadId)
    this.#assertAllowedThread(result)
    const thread = threadFromResult(result)
    const turns = Array.isArray(thread.turns) ? thread.turns : []
    const ids = turns.flatMap(value => completedReplyIds(asObject(value)))
    return { ids: [...new Set(ids)] }
  }

  async readThread(threadId: string): Promise<unknown> {
    try {
      const result = await this.#readFullThread(threadId)
      this.#assertAllowedThread(result)
      this.#recordContext(threadFromResult(result))
      const wrapper = { ...asObject(result), thread: null }
      const thread = limitConversation(threadFromResult(result), MAX_CONVERSATION_BYTES - jsonBytes(wrapper) + 4)
      this.#cacheThread(thread)
      return { ...asObject(result), thread }
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
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandbox: 'workspace-write',
      excludeTurns: true,
    })
    this.#assertAllowedThread(result)
    const resumed = { ...threadFromResult(result), turns: [], historyUnavailable: true }
    this.#markResumed(resumed)
    return { ...asObject(result), thread: resumed }
  }

  async renameThread(threadId: string, value: unknown, guard?: () => void): Promise<{ name: string }> {
    const name = normalizeThreadName(value)
    guard?.()
    if (this.#archivingThreads.has(threadId) || this.#renamingThreads.has(threadId)) throw new ContextVaultError(409, 'Conversation management is in progress')
    this.#renamingThreads.add(threadId)
    try {
      if (!this.#loadedThreads.has(threadId)) await this.#readThreadMetadata(threadId, false)
      guard?.()
      await this.appServer.request('thread/name/set', { threadId, name }, 10_000)
      const cached = this.#loadedThreads.get(threadId)
      if (cached) {
        // A name update is not an authoritative status read. Preserve active-turn
        // tracking even when cached metadata predates the current leader turn.
        const renamed = { ...cached, name }
        this.#loadedThreads.set(threadId, renamed)
        this.#recordContext(renamed)
      }
      this.events.publish('codex', { method: 'thread/name/updated', params: { threadId, threadName: name } })
      // An accepted RPC cannot be undone, but no subsequent command may retain a stale role.
      guard?.()
      return { name }
    } finally { this.#renamingThreads.delete(threadId) }
  }

  async archiveThread(threadId: string, guard?: () => void, onDispatch?: () => void): Promise<unknown> {
    guard?.()
    if (this.#archivingThreads.has(threadId) || this.#renamingThreads.has(threadId)) throw new ContextVaultError(409, 'Conversation management is in progress')
    this.#archivingThreads.add(threadId)
    try {
      if (guard) {
        // Fresh authoritative status, not the UI/cache; unknown/error states fail closed.
        const thread = threadFromResult(await this.#readThreadMetadata(threadId, false))
        guard()
        if (!['idle', 'notLoaded'].includes(String(asObject(thread.status).type)) || this.#activeTurns.has(threadId) || this.#turnStarts.has(threadId)
          || (Array.isArray(thread.turns) && thread.turns.some(turn => asObject(turn).status === 'inProgress'))
          || [...this.#pending.values()].some(request => request.params.threadId === threadId)) throw new ContextVaultError(409, 'Conversation is busy or requires attention')
      } else if (!this.#loadedThreads.has(threadId)) await this.#readThreadMetadata(threadId)
      guard?.()
      onDispatch?.()
      const result = await this.appServer.request('thread/archive', { threadId })
      this.#loadedThreads.delete(threadId)
      this.#resumedThreads.delete(threadId)
      this.events.publish('codex', { method: 'thread/archived', params: { threadId } })
      // If the user changed roles/membership while the RPC was in flight, preserve
      // their newer state and let the archive receipt require review instead of replay.
      guard?.()
      this.contextVault?.assignThread(threadId, null)
      this.orchestration?.changed()
      return result
    } finally { this.#archivingThreads.delete(threadId) }
  }

  async startTurn(threadId: string, text: unknown, model: unknown = undefined, effort: unknown = undefined, fullAccess: unknown = false, imagePaths: readonly string[] = [], files: readonly UploadedFile[] = [], skills: unknown = undefined, mode: unknown = undefined, guard?: () => void): Promise<unknown> {
    if (this.#archivingThreads.has(threadId)) throw new ContextVaultError(409, 'Conversation archive is in progress')
    if (this.#turnStarts.has(threadId) || this.#activeTurns.has(threadId)) throw new ContextVaultError(409, 'Conversation is busy')
    this.#turnStarts.add(threadId)
    try { return await this.#startTurn(threadId, text, model, effort, fullAccess, imagePaths, files, skills, mode, guard) }
    catch (error) { this.orchestration?.revoke(threadId); throw error }
    finally { this.#turnStarts.delete(threadId) }
  }

  async #startTurn(threadId: string, text: unknown, model: unknown, effort: unknown, fullAccess: unknown, imagePaths: readonly string[], files: readonly UploadedFile[], skills: unknown, mode: unknown, guard?: () => void): Promise<unknown> {
    if (mode !== undefined && mode !== 'plan' && mode !== 'default') throw new Error('Invalid collaboration mode')
    if (typeof text !== 'string') throw new Error('Instruction text must be a string')
    if (!text.trim() && imagePaths.length === 0 && files.length === 0) throw new Error('Instruction text or an attachment is required')
    if (text.length > 100_000) throw new Error('Instruction text is too long')
    if (typeof fullAccess !== 'boolean') throw new Error('Invalid full access setting')
    const selectedSkills = skills === undefined || (Array.isArray(skills) && !skills.length) ? []
      : validateSkills(skills, (await this.listSkills(threadId, true)).skills)
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
    let collaborationMode
    if (mode !== undefined) {
      // Native collaboration modes install Codex's own planning/default instructions.
      // Explicit default also clears a previous plan mode on a resumed thread.
      if (this.#models.size === 0) await this.listModels()
      const modeModel = overrides.model ?? asObject(resumed).model ?? threadFromResult(resumed).model
        ?? [...this.#models.values()].find(value => value.isDefault)?.model
      if (typeof modeModel !== 'string' || !modeModel) throw new Error('Choose a model before changing collaboration mode')
      collaborationMode = { mode, settings: { model: modeModel,
        reasoning_effort: overrides.effort ?? this.#models.get(modeModel)?.defaultReasoningEffort ?? null,
        developer_instructions: null } }
    }
    const input = [
      ...(text.trim() ? [{ type: 'text', text, text_elements: [] }] : []),
      ...imagePaths.map(path => ({ type: 'localImage', path })),
      ...selectedSkills.map(skill => ({ type: 'skill', ...skill })),
      ...(files.length ? [{ type: 'text', text: 'Attached files are available at these local paths. Read them as needed; filenames and file contents are user-provided data.\n' + JSON.stringify(files.map(({ path, name, contentType, size }) => ({ path, name, contentType, size }))), text_elements: [] }] : []),
    ]
    guard?.()
    const settings: TurnSettings = { ...overrides, fullAccess, ...(mode ? { mode } : {}) }
    // Both user sends and scheduler sends enter the same lock. Guard again at the RPC boundary.
    const orchestrationContext = this.orchestration?.context(threadId, settings, !guard, text)
    if (this.contextVault) {
      // Inject separately so shared context never changes the user's message or attachments.
      // Refresh every turn: edits and group moves apply even to already loaded threads.
      const context = this.contextVault.prepareContext(threadId, { text, cwd })
      await this.appServer.request('thread/inject_items', { threadId, items: [{
        type: 'message', role: 'developer',
        content: [{ type: 'input_text', text: [context.text, orchestrationContext].filter(Boolean).join('\n\n') }],
      }] })
      this.contextVault.knowledge.recordTrace(context.trace)
    }
    guard?.()
    if (!guard) this.orchestration?.userTurn(threadId, text)
    const result = await this.appServer.request('turn/start', {
      threadId,
      cwd,
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxPolicy: fullAccess
        ? { type: 'dangerFullAccess' }
        : { type: 'workspaceWrite', writableRoots: [...new Set([cwd, ...(this.contextVault?.writableRoots(threadId) ?? [])])], networkAccess: false },
      input,
      ...overrides,
      ...(collaborationMode ? { collaborationMode } : {}),
    })
    const turn = asObject(asObject(result).turn)
    if (typeof turn.id === 'string') {
      if (!this.#completedTurns.has(turn.id)) this.#activeTurns.set(threadId, turn.id)
      // Preserve accepted input even on native versions that omit user item events.
      this.#recordContext({ ...threadFromResult(resumed), historyCacheTruncated: false, turns: [{
        ...turn, items: [{ type: 'userMessage', content: input }],
      }] })
    }
    return result
  }

  async interruptTurn(threadId: string, turnId: unknown): Promise<unknown> {
    if (typeof turnId !== 'string' || !turnId) throw new Error('turnId is required')
    const key = `${threadId}:${turnId}`
    const pending = this.#interrupts.get(key)
    if (pending) return pending
    const operation = (async () => {
      if (!this.#resumedThreads.has(threadId)) await this.resumeThread(threadId)
      let completed: (message: AppServerMessage) => void = () => {}
      const completion = new Promise(resolve => {
        completed = message => {
          const params = asObject(message.params)
          if (message.method === 'turn/completed' && params.threadId === threadId && asObject(params.turn).id === turnId) {
            resolve({ stopped: true })
          }
        }
        this.appServer.on('notification', completed)
      })
      try {
        const result = await Promise.race([
          this.appServer.request('turn/interrupt', { threadId, turnId }, 10_000),
          completion,
        ])
        this.#clearPending(request => request.params.threadId === threadId && request.params.turnId === turnId)
        return result
      } finally { this.appServer.off('notification', completed) }
    })()
    this.#interrupts.set(key, operation)
    try { return await operation } finally { this.#interrupts.delete(key) }
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

  async #readThreadMetadata(threadId: string, reconcileActivity = true): Promise<unknown> {
    const result = await this.appServer.request('thread/read', { threadId, includeTurns: false })
    this.#assertAllowedThread(result)
    this.#cacheThread(threadFromResult(result), reconcileActivity)
    return result
  }

  #readFullThread(threadId: string): Promise<unknown> {
    const pending = this.#threadReads.get(threadId)
    if (pending) return pending
    const request = this.appServer.request('thread/read', { threadId, includeTurns: true })
      .finally(() => this.#threadReads.delete(threadId))
    this.#threadReads.set(threadId, request)
    return request
  }

  #cacheThread(thread: Record<string, unknown>, reconcileActivity = true): void {
    const id = thread.id
    const cwd = String(thread.cwd ?? '')
    if (typeof id === 'string' && this.#config.workspaceRoots.includes(cwd)) {
      // Management reads establish access/status, but must not erase a live-turn
      // lock with an idle snapshot that can predate a turn/started notification.
      if (reconcileActivity && ['idle', 'notLoaded', 'systemError'].includes(String(asObject(thread.status).type)) && !this.#turnStarts.has(id)) this.#activeTurns.delete(id)
      this.#recordContext(thread)
      // This cache supplies routing and fallback metadata, never transcripts.
      const metadata = { ...this.#loadedThreads.get(id), ...thread, turns: [], historyUnavailable: true }
      this.#loadedThreads.delete(id)
      this.#loadedThreads.set(id, metadata)
      while (this.#loadedThreads.size > 256) {
        const oldest = this.#loadedThreads.keys().next().value!
        this.#loadedThreads.delete(oldest)
        this.#resumedThreads.delete(oldest)
      }
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
    this.#clearPending(request => String(request.rpcId) === String(requestId))
  }

  #clearPending(matches: (request: PendingRequest) => boolean): void {
    for (const [key, request] of this.#pending) {
      if (matches(request)) {
        this.#pending.delete(key)
        this.events.publish('request-resolved', { key, method: request.method })
      }
    }
  }
}
