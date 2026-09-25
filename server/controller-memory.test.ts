import { describe, expect, it, vi } from 'vitest'
import { CodexAppServer } from './codex-app-server.js'
import { RemoteController } from './controller.js'
import type { RemoteConfig } from './config.js'

const config: RemoteConfig = {
  host: '127.0.0.1', port: 5173, publicOrigin: new URL('https://remote.example.test'),
  password: 'test-password-long-enough', sessionSecret: 's'.repeat(48), sessionTtlSeconds: 600,
  codexBin: 'unused', workspaceRoots: ['/workspace'], production: true,
}

describe('controller history memory', () => {
  it('shares overlapping full reads and releases the promise after completion or failure', async () => {
    const app = new CodexAppServer('unused')
    const controller = new RemoteController(config, app)
    let resolve!: (value: unknown) => void
    const request = vi.spyOn(app, 'request').mockImplementation(() => new Promise(done => { resolve = done }))
    const history = controller.readThread('thread')
    const overlapping = controller.readThread('thread')
    expect(request).toHaveBeenCalledTimes(1)
    resolve({ thread: { id: 'thread', cwd: '/workspace', turns: [{ id: 'turn', status: 'completed', items: [{ id: 'reply', type: 'agentMessage', text: 'hello' }] }] } })
    await expect(history).resolves.toMatchObject({ thread: { turns: [{ id: 'turn' }] } })
    await expect(overlapping).resolves.toMatchObject({ thread: { turns: [{ id: 'turn' }] } })
    request.mockRejectedValueOnce(new Error('temporary failure'))
    await expect(controller.readThread('thread')).rejects.toThrow('temporary failure')
    request.mockResolvedValue({ thread: { id: 'thread', cwd: '/workspace', turns: [] } })
    await expect(controller.readThread('thread')).resolves.toMatchObject({ thread: { turns: [] } })
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('keeps only metadata for resumed threads after reading their full history', async () => {
    const app = new CodexAppServer('unused')
    const source = { thread: { id: 'thread', cwd: '/workspace', turns: [{ id: 'turn', status: 'completed', items: [{ type: 'agentMessage', text: 'x'.repeat(1_000_000) }] }] } }
    vi.spyOn(app, 'request').mockResolvedValue(source)
    const controller = new RemoteController(config, app)
    await controller.resumeThread('thread')
    await controller.readThread('thread')
    expect(await controller.resumeThread('thread')).toMatchObject({ thread: { turns: [], historyUnavailable: true } })
    expect(source.thread.turns[0].items[0].text.length).toBe(1_000_000)
  })

  it('reloads routing metadata when a thread is evicted from the bounded cache', async () => {
    const app = new CodexAppServer('unused')
    const request = vi.spyOn(app, 'request').mockImplementation(async (_method, params) => ({ thread: {
      id: (params as { threadId: string }).threadId, cwd: '/workspace', turns: [],
    } }))
    const controller = new RemoteController(config, app)
    for (let i = 0; i < 257; i++) await controller.readThread(`thread-${i}`)
    request.mockClear()
    await controller.resumeThread('thread-0')
    expect(request).toHaveBeenCalledWith('thread/read', { threadId: 'thread-0', includeTurns: false }, undefined, undefined)
  })
})
