import { describe, expect, it, vi } from 'vitest'
import type { RemoteConfig } from './config.js'
import { CodexAppServer, type JsonRpcId } from './codex-app-server.js'
import { normalizeThreadName, RemoteController } from './controller.js'

const config: RemoteConfig = {
  host: '127.0.0.1',
  port: 5173,
  publicOrigin: new URL('https://remote.example.test'),
  password: 'correct horse battery staple',
  sessionSecret: 's'.repeat(48),
  sessionTtlSeconds: 600,
  codexBin: 'unused',
  workspaceRoots: ['/workspace'],
  production: true,
}

class StubAppServer extends CodexAppServer {
  readonly calls: Array<{ method: string; params: unknown }> = []
  readonly responses: Array<{ id: JsonRpcId; result: unknown }> = []

  override async request(method: string, params: unknown): Promise<unknown> {
    this.calls.push({ method, params })
    if (method === 'skills/list') return { data: [] }
    if (method === 'thread/list') {
      return {
        data: [
          { id: 'thread-stored', cwd: '/workspace', turns: [] },
          { id: 'thread-outside', cwd: '/outside', turns: [] },
        ],
        nextCursor: null,
      }
    }
    if (method === 'model/list') {
      return {
        data: [
          {
            id: 'model-fast',
            model: 'model-fast',
            displayName: 'Model Fast',
            defaultReasoningEffort: 'low',
            supportedReasoningEfforts: [
              { reasoningEffort: 'low', description: 'Fast' },
              { reasoningEffort: 'high', description: 'Deep' },
              { reasoningEffort: 'ultra', description: 'Maximum' },
            ],
          },
          { id: 'model-hidden', model: 'model-hidden', hidden: true },
          { id: 'model-id-only', displayName: 'ID-only model' },
        ],
        nextCursor: null,
      }
    }
    if (method === 'account/rateLimits/read') {
      return {
        rateLimits: {
          limitId: 'codex',
          primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_800_000_000 },
        },
      }
    }
    if (method === 'thread/start') {
      return { thread: { id: 'thread-new', cwd: '/workspace', turns: [] } }
    }
    if (method === 'thread/read') throw new Error('no rollout found')
    if (method === 'thread/resume') {
      return { thread: { id: 'thread-stored', cwd: '/workspace', turns: [] } }
    }
    if (method === 'turn/start') return { turn: { id: 'turn-new', status: 'inProgress' } }
    return {}
  }

  override respond(id: JsonRpcId, result: unknown): void {
    this.responses.push({ id, result })
  }
}

describe('RemoteController', () => {
  it('lists workspace skills without creating a conversation and rejects unknown workspaces', async () => {
    const app = new StubAppServer()
    const controller = new RemoteController(config, app)
    await controller.listWorkspaceSkills('0', true)
    expect(app.calls).toEqual([{ method: 'skills/list', params: { cwds: ['/workspace'], forceReload: true } }])
    await expect(controller.listWorkspaceSkills('/outside')).rejects.toThrow()
    expect(app.calls).toHaveLength(1)
  })

  it('notifies once per successful final reply, never on progress or interrupted turns', async () => {
    const app = new StubAppServer()
    const controller = new RemoteController(config, app)
    await controller.listThreads()
    const complete = vi.fn()
    controller.onReplyCompleted = complete
    const item = (id: string, phase: string) => app.emit('notification', { method: 'item/completed', params: {
      threadId: 'thread-stored', turnId: id, item: { id: 'answer', type: 'agentMessage', phase, text: 'Text' },
    } })
    const end = (id: string, status: string) => app.emit('notification', { method: 'turn/completed', params: {
      threadId: 'thread-stored', turn: { id, status },
    } })
    item('progress', 'commentary'); end('progress', 'completed')
    item('stopped', 'final_answer'); end('stopped', 'interrupted')
    item('done', 'final_answer')
    expect(complete).not.toHaveBeenCalled()
    end('done', 'completed')
    expect(complete).toHaveBeenCalledExactlyOnceWith('thread-stored', ['reply:done'])
  })

  it('returns only distinct assistant message IDs, including history beyond the display cap', async () => {
    const appServer = new StubAppServer()
    const source = { thread: { id: 'messages', cwd: '/workspace', turns: [{ id: 't1', status: 'completed', items: [
      { id: 'user', type: 'userMessage', text: 'Hi' },
      { id: 'tool', type: 'commandExecution', text: 'x'.repeat(6_000_000) },
      { id: 'reply', type: 'agentMessage', text: 'Hello' },
      { id: 'reply', type: 'agentMessage', text: 'Hello' },
      { id: 'blank', type: 'agentMessage', text: ' ' },
    ] }, { id: 't2', status: 'completed', items: [{ id: 'reply', type: 'agentMessage', text: 'Another reply' }] }] } }
    vi.spyOn(appServer, 'request').mockResolvedValue(source)
    const controller = new RemoteController(config, appServer)
    expect(await controller.readMessageIds('messages')).toEqual({ ids: ['reply:t1', 'reply:t2'] })
    source.thread.cwd = '/outside'
    await expect(controller.readMessageIds('messages')).rejects.toThrow()
  })

  it('caps thread/read responses at 5 MB without changing the original history', async () => {
    const appServer = new StubAppServer()
    const source = { thread: { id: 'large', cwd: '/workspace', turns: [{ id: 'done', status: 'completed', items: [{ id: 'answer', type: 'agentMessage', text: 'x'.repeat(6_000_000) }] }] } }
    vi.spyOn(appServer, 'request').mockResolvedValue(source)
    const controller = new RemoteController(config, appServer)
    const result = await controller.readThread('large')
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(5_000_000)
    expect(result).toMatchObject({ thread: { historyTruncation: 'head', latestTurn: { id: 'done', status: 'completed' } } })
    expect(source.thread.turns[0].items[0].text).toHaveLength(6_000_000)
  })
  it('validates conversation names before issuing any RPC', () => {
    expect(normalizeThreadName('  Báo giá phụ tùng 🚗  ')).toBe('Báo giá phụ tùng 🚗')
    for (const value of [undefined, null, 42, '', '   ', 'a'.repeat(201), 'two\nlines', 'bad\u0000name']) {
      expect(() => normalizeThreadName(value)).toThrow()
    }
    expect(normalizeThreadName('a'.repeat(200))).toHaveLength(200)
  })

  it('saves names through Codex without resuming or interrupting a running conversation', async () => {
    const appServer = new StubAppServer()
    const controller = new RemoteController(config, appServer)
    await controller.listThreads()
    appServer.calls.length = 0
    const publish = vi.spyOn(controller.events, 'publish')
    await expect(controller.renameThread('thread-stored', '  Hợp đồng mới  ')).resolves.toEqual({ name: 'Hợp đồng mới' })
    expect(appServer.calls).toEqual([{ method: 'thread/name/set', params: { threadId: 'thread-stored', name: 'Hợp đồng mới' } }])
    expect(publish).toHaveBeenCalledWith('codex', { method: 'thread/name/updated', params: { threadId: 'thread-stored', threadName: 'Hợp đồng mới' } })
    await expect(controller.readThread('thread-stored')).resolves.toMatchObject({ thread: { name: 'Hợp đồng mới' } })
  })

  it('does not rename an inaccessible thread or publish a failed rename', async () => {
    const appServer = new StubAppServer()
    const controller = new RemoteController(config, appServer)
    const request = vi.spyOn(appServer, 'request').mockResolvedValue({ thread: { id: 'outside', cwd: '/outside' } })
    await expect(controller.renameThread('outside', 'New name')).rejects.toThrow()
    expect(request).not.toHaveBeenCalledWith('thread/name/set', expect.anything(), expect.anything())
    request.mockRestore()
    await controller.listThreads()
    const publish = vi.spyOn(controller.events, 'publish')
    vi.spyOn(appServer, 'request').mockRejectedValue(new Error('Rename failed'))
    await expect(controller.renameThread('thread-stored', 'New name')).rejects.toThrow('Rename failed')
    expect(publish).not.toHaveBeenCalled()
  })

  it('deduplicates Stop and resolves on the exact completion even if the RPC acknowledgement is lost', async () => {
    const appServer = new StubAppServer()
    const controller = new RemoteController(config, appServer)
    await controller.createThread('0')
    const request = vi.spyOn(appServer, 'request').mockImplementation(() => new Promise(() => {}))
    const baseline = appServer.listenerCount('notification')
    const first = controller.interruptTurn('thread-new', 'turn-target')
    const duplicate = controller.interruptTurn('thread-new', 'turn-target')
    expect(request).toHaveBeenCalledExactlyOnceWith('turn/interrupt', { threadId: 'thread-new', turnId: 'turn-target' }, 10_000)
    let settled = false
    void first.then(() => { settled = true })
    appServer.emit('notification', { method: 'turn/completed', params: { threadId: 'thread-new', turn: { id: 'other-turn' } } })
    await Promise.resolve()
    expect(settled).toBe(false)
    appServer.emit('notification', { method: 'turn/completed', params: { threadId: 'thread-new', turn: { id: 'turn-target' } } })
    await expect(first).resolves.toEqual({ stopped: true })
    await expect(duplicate).resolves.toEqual({ stopped: true })
    expect(appServer.listenerCount('notification')).toBe(baseline)
  })

  it('cleans up a failed Stop so retry is possible without restarting other conversations', async () => {
    const appServer = new StubAppServer()
    const controller = new RemoteController(config, appServer)
    await controller.createThread('0')
    const baseline = appServer.listenerCount('notification')
    const request = vi.spyOn(appServer, 'request').mockRejectedValueOnce(new Error('Timed out')).mockResolvedValueOnce({})
    await expect(controller.interruptTurn('thread-new', 'target')).rejects.toThrow('Timed out')
    expect(appServer.listenerCount('notification')).toBe(baseline)
    await expect(controller.interruptTurn('thread-new', 'target')).resolves.toEqual({})
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('dispatches completion without browser clients only for allowed loaded threads', async () => {
    const appServer = new StubAppServer()
    const controller = new RemoteController(config, appServer)
    controller.onTurnCompleted = vi.fn()
    await controller.listThreads()
    appServer.emit('notification', { method: 'turn/completed', params: { threadId: 'thread-outside', turn: { id: 'outside-turn' } } })
    appServer.emit('notification', { method: 'turn/completed', params: { threadId: 'thread-stored', turn: {} } })
    expect(controller.onTurnCompleted).not.toHaveBeenCalled()
    appServer.emit('notification', { method: 'item/completed', params: { threadId: 'thread-stored', turnId: 'finished-turn', item: { id: 'commentary', type: 'agentMessage', text: 'Checking the result.' } } })
    appServer.emit('notification', { method: 'item/agentMessage/delta', params: { threadId: 'thread-stored', turnId: 'finished-turn', itemId: 'final', delta: 'Finished successfully.\nMore detail.' } })
    appServer.emit('notification', { method: 'turn/completed', params: { threadId: 'thread-stored', turn: { id: 'finished-turn' } } })
    expect(controller.onTurnCompleted).toHaveBeenCalledExactlyOnceWith('thread-stored', 'finished-turn', 'Finished successfully.\nMore detail.')
  })
  it('keeps a new thread usable while Codex persists its rollout', async () => {
    const appServer = new StubAppServer()
    const controller = new RemoteController(config, appServer)

    await controller.createThread('0')
    await expect(controller.readThread('thread-new')).resolves.toMatchObject({
      thread: { id: 'thread-new', historyUnavailable: true },
    })
    await expect(controller.resumeThread('thread-new')).resolves.toMatchObject({
      thread: { id: 'thread-new', cwd: '/workspace' },
    })
    await expect(controller.startTurn('thread-new', '  report status  ')).resolves.toMatchObject({
      turn: { id: 'turn-new' },
    })

    expect(appServer.calls.map(({ method }) => method)).toEqual([
      'thread/start',
      'thread/read',
      'turn/start',
    ])
    expect(appServer.calls.at(-1)?.params).toMatchObject({
      threadId: 'thread-new',
      cwd: '/workspace',
      input: [{ type: 'text', text: '  report status  ' }],
    })
  })

  it('returns an explicit decision for a Codex approval request', () => {
    const appServer = new StubAppServer()
    const controller = new RemoteController(config, appServer)
    appServer.emit('serverRequest', {
      id: 'approval-1',
      method: 'item/commandExecution/requestApproval',
      params: { command: 'npm test' },
    })

    const [request] = controller.listPending()
    controller.respondToRequest(request.key, { decision: 'acceptForSession' })

    expect(appServer.responses).toEqual([
      { id: 'approval-1', result: { decision: 'acceptForSession' } },
    ])
    expect(controller.listPending()).toEqual([])
  })

  it('discovers picker-visible models and applies a validated turn override', async () => {
    const appServer = new StubAppServer()
    const controller = new RemoteController(config, appServer)

    await controller.createThread('0')
    await expect(controller.listModels()).resolves.toMatchObject({
      data: [{ model: 'model-fast' }, { model: 'model-id-only' }],
    })
    await controller.startTurn('thread-new', 'review this', 'model-fast', 'high')

    expect(appServer.calls.at(-1)).toMatchObject({
      method: 'turn/start',
      params: {
        model: 'model-fast',
        effort: 'high',
        input: [{ type: 'text', text: 'review this' }],
      },
    })
    appServer.emit('notification', { method: 'turn/completed', params: { threadId: 'thread-new', turn: { id: 'turn-new', status: 'completed' } } })
    await expect(controller.startTurn('thread-new', 'review this', 'model-hidden', 'low'))
      .rejects.toThrow('Unknown model')
    await expect(controller.startTurn('thread-new', 'review deeply', 'model-fast', 'ultra'))
      .resolves.toMatchObject({ turn: { id: 'turn-new' } })
  })

  it('always disables approvals and grants host access only to explicit YOLO turns', async () => {
    const appServer = new StubAppServer()
    const controller = new RemoteController(config, appServer)

    await controller.createThread('0')
    await controller.startTurn('thread-new', 'continue autonomously', undefined, undefined, true)
    expect(appServer.calls.at(-1)).toMatchObject({
      method: 'turn/start',
      params: {
        approvalPolicy: 'never',
        cwd: '/workspace',
        sandboxPolicy: { type: 'dangerFullAccess' },
      },
    })
    appServer.emit('notification', { method: 'turn/completed', params: { threadId: 'thread-new', turn: { id: 'turn-new', status: 'completed' } } })
    await expect(controller.startTurn('thread-new', 'unsafe value', undefined, undefined, 'always'))
      .rejects.toThrow('Invalid full access setting')
  })

  it('adds only trusted local image paths to a turn and supports image-only prompts', async () => {
    const appServer = new StubAppServer()
    const controller = new RemoteController(config, appServer)

    await controller.createThread('0')
    await controller.startTurn('thread-new', '', undefined, undefined, false, ['/tmp/remote-image.png'])
    expect(appServer.calls.at(-1)).toMatchObject({
      method: 'turn/start',
      params: { input: [{ type: 'localImage', path: '/tmp/remote-image.png' }] },
    })
    appServer.emit('notification', { method: 'turn/completed', params: { threadId: 'thread-new', turn: { id: 'turn-new', status: 'completed' } } })
    await expect(controller.startTurn('thread-new', '')).rejects.toThrow('text or an attachment')
  })

  it('reads account rate limits from Codex App Server', async () => {
    const appServer = new StubAppServer()
    const controller = new RemoteController(config, appServer)

    await expect(controller.readRateLimits()).resolves.toMatchObject({
      rateLimits: { primary: { usedPercent: 25 } },
    })
    expect(appServer.calls.at(-1)).toEqual({ method: 'account/rateLimits/read', params: {} })
  })

  it('filters disallowed threads and resumes listed threads before using them', async () => {
    const appServer = new StubAppServer()
    const controller = new RemoteController(config, appServer)

    await expect(controller.listThreads()).resolves.toMatchObject({
      data: [{ id: 'thread-stored', cwd: '/workspace' }],
    })
    await expect(controller.resumeThread('thread-stored')).resolves.toMatchObject({
      thread: {
        id: 'thread-stored',
        cwd: '/workspace',
        historyUnavailable: true,
      },
    })
    await controller.startTurn('thread-stored', 'continue')

    expect(appServer.calls.map(({ method }) => method)).toEqual([
      'thread/list',
      'thread/resume',
      'turn/start',
    ])
  })
})

it('preserves raw instruction text and passes generic uploads as file metadata, not images', async () => {
  const appServer = new StubAppServer()
  const controller = new RemoteController(config, appServer)
  await controller.createThread('0')
  const raw = '  <script>alert("x")</script>\n**literal**\n  '
  const file = { path: '/tmp/upload-report.pdf', name: 'report.pdf', size: 10, contentType: 'application/pdf', kind: 'file' as const }
  await controller.startTurn('thread-new', raw, undefined, undefined, false, [], [file])
  const input = (appServer.calls.at(-1)!.params as { input: Array<{ type: string; text: string }> }).input
  expect(input[0]).toEqual({ type: 'text', text: raw, text_elements: [] })
  expect(input[1].type).toBe('text')
  expect(input[1].text).toContain(JSON.stringify({ path: file.path, name: file.name, contentType: file.contentType, size: file.size }))
  expect(input.some(item => item.type === 'localImage')).toBe(false)
  appServer.emit('notification', { method: 'turn/completed', params: { threadId: 'thread-new', turn: { id: 'turn-new', status: 'completed' } } })
  await expect(controller.startTurn('thread-new', '', undefined, undefined, false, [], [file])).resolves.toBeDefined()
})
