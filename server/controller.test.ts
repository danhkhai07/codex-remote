import { describe, expect, it, vi } from 'vitest'
import type { RemoteConfig } from './config.js'
import { CodexAppServer, type JsonRpcId } from './codex-app-server.js'
import { RemoteController } from './controller.js'

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
  it('dispatches completion without browser clients only for allowed loaded threads', async () => {
    const appServer = new StubAppServer()
    const controller = new RemoteController(config, appServer)
    controller.onTurnCompleted = vi.fn()
    await controller.listThreads()
    appServer.emit('notification', { method: 'turn/completed', params: { threadId: 'thread-outside', turn: { id: 'outside-turn' } } })
    appServer.emit('notification', { method: 'turn/completed', params: { threadId: 'thread-stored', turn: {} } })
    expect(controller.onTurnCompleted).not.toHaveBeenCalled()
    appServer.emit('notification', { method: 'turn/completed', params: { threadId: 'thread-stored', turn: { id: 'finished-turn' } } })
    expect(controller.onTurnCompleted).toHaveBeenCalledExactlyOnceWith('thread-stored', 'finished-turn')
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
      input: [{ type: 'text', text: 'report status' }],
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
    await expect(controller.startTurn('thread-new', 'review this', 'model-hidden', 'low'))
      .rejects.toThrow('Unknown model')
    await expect(controller.startTurn('thread-new', 'review deeply', 'model-fast', 'ultra'))
      .resolves.toMatchObject({ turn: { id: 'turn-new' } })
  })

  it('allows explicit YOLO turns but rejects unknown approval policies', async () => {
    const appServer = new StubAppServer()
    const controller = new RemoteController(config, appServer)

    await controller.createThread('0')
    await controller.startTurn('thread-new', 'continue autonomously', undefined, undefined, 'never')
    expect(appServer.calls.at(-1)).toMatchObject({
      method: 'turn/start',
      params: { approvalPolicy: 'never', cwd: '/workspace' },
    })
    await expect(controller.startTurn('thread-new', 'unsafe value', undefined, undefined, 'always'))
      .rejects.toThrow('Invalid approval policy')
  })

  it('adds only trusted local image paths to a turn and supports image-only prompts', async () => {
    const appServer = new StubAppServer()
    const controller = new RemoteController(config, appServer)

    await controller.createThread('0')
    await controller.startTurn('thread-new', '', undefined, undefined, 'on-request', ['/tmp/remote-image.png'])
    expect(appServer.calls.at(-1)).toMatchObject({
      method: 'turn/start',
      params: { input: [{ type: 'localImage', path: '/tmp/remote-image.png' }] },
    })
    await expect(controller.startTurn('thread-new', '')).rejects.toThrow('text or an image')
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
