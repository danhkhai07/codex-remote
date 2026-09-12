import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CodexAppServer, type AppServerMessage } from './codex-app-server.js'

describe('CodexAppServer', () => {
  it('reads a large thread history without discarding its RPC response', async () => {
    const fixture = fileURLToPath(new URL('./fixtures/fake-codex.mjs', import.meta.url))
    const appServer = new CodexAppServer(process.execPath, [fixture])
    try {
      const result = await appServer.request('thread/read', {
        threadId: 'thr_large', includeTurns: true,
      }, 5_000) as { thread: { id: string; turns: { items: { text: string }[] }[] } }
      expect(result.thread.id).toBe('thr_large')
      expect(result.thread.turns[0].items[0].text).toHaveLength(10_000_000)
    } finally {
      appServer.stop()
    }
  })

  it('correlates RPC responses and forwards every notification and request', async () => {
    const fixture = fileURLToPath(new URL('./fixtures/fake-codex.mjs', import.meta.url))
    const appServer = new CodexAppServer(process.execPath, [fixture])
    const notifications: AppServerMessage[] = []
    const requests: AppServerMessage[] = []
    const messages: AppServerMessage[] = []
    appServer.on('notification', (message) => notifications.push(message))
    appServer.on('serverRequest', (message) => requests.push(message))
    appServer.on('message', (message) => messages.push(message))

    try {
      await appServer.start()
      await expect(appServer.request('thread/list', {})).resolves.toMatchObject({ data: [] })
      await expect(appServer.request('thread/start', { cwd: '/workspace' })).resolves.toMatchObject({
        thread: { id: 'thr_fixture' },
      })

      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(notifications.some((message) => message.method === 'warning')).toBe(true)
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({
        id: 'approval_fixture',
        method: 'item/commandExecution/requestApproval',
      })
      expect(messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ result: { data: [], nextCursor: null } }),
        expect.objectContaining({ method: 'warning' }),
        expect.objectContaining({ method: 'item/commandExecution/requestApproval' }),
      ]))

      appServer.respond('approval_fixture', { decision: 'accept' })
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(notifications.some((message) => message.method === 'serverRequest/resolved')).toBe(true)
    } finally {
      appServer.stop()
    }
  })
})
