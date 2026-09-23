import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'

function fixture() {
  const handlers = new Map<string, (event: unknown) => void>()
  const showNotification = vi.fn().mockResolvedValue(undefined), openWindow = vi.fn().mockResolvedValue(undefined)
  const matchAll = vi.fn().mockResolvedValue([])
  class Channel {
    port1 = { onmessage: null as null | ((event: unknown) => void), close() {} }
    port2 = { postMessage: (data: unknown) => this.port1.onmessage?.({ data }), close() {} }
  }
  runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    self: { addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
      registration: { showNotification }, clients: { matchAll, openWindow }, location: { origin: 'https://remote.test' } },
    URL, MessageChannel: Channel, setTimeout, clearTimeout,
  })
  const dispatch = async (type: string, event: object) => {
    let work: Promise<unknown> | undefined
    handlers.get(type)!({ ...event, waitUntil: (promise: Promise<unknown>) => { work = promise } })
    await work
  }
  return { showNotification, openWindow, matchAll,
    push: (value: unknown) => dispatch('push', { data: { json: () => value } }),
    click: (data: unknown) => dispatch('notificationclick', { notification: { close: vi.fn(), data } }) }
}

it('shows bounded approved metadata for leader, worker, solo and failed turns, never arbitrary body', async () => {
  const f = fixture()
  await f.push({ tag: 'turn', body: 'PRIVATE ANSWER', notification: { threadId: 'leader', threadName: 'Sửa CR', groupName: 'Codex Remote', isLeader: true } })
  expect(f.showNotification).toHaveBeenLastCalledWith('Codex Remote · Leader', expect.objectContaining({ body: 'Sửa CR đã trả lời.', data: { threadId: 'leader' } }))
  await f.push({ notification: { threadId: 'worker', threadName: 'Worker', groupName: 'Project', isLeader: false } })
  expect(f.showNotification).toHaveBeenLastCalledWith('Project', expect.objectContaining({ body: 'Worker đã trả lời.' }))
  await f.push({ notification: { threadId: 'solo', isLeader: true, outcome: 'failed' } })
  expect(f.showNotification).toHaveBeenLastCalledWith('Codex · Chưa phân nhóm', expect.objectContaining({ body: 'Cuộc hội thoại: lượt chat bị lỗi.' }))
  await f.push({ notification: { threadId: 't', threadName: '😀'.repeat(500), groupName: '\u202e\nGroup', isLeader: 'true' } })
  expect(f.showNotification.mock.lastCall![0]).toBe('Group')
  expect([...f.showNotification.mock.lastCall![1].body]).toHaveLength(80 + ' đã trả lời.'.length)
  expect(JSON.stringify(f.showNotification.mock.calls)).not.toContain('PRIVATE ANSWER')
})

it.each([null, {}, { body: 'PRIVATE' }, { notification: { threadId: '//evil.test' } }, { notification: { threadId: 'x'.repeat(129) } }])('falls back safely for malformed/old push: %j', async payload => {
  const f = fixture(); await f.push(payload)
  expect(f.showNotification).toHaveBeenCalledWith('Codex finished', expect.objectContaining({ body: 'Your Codex turn is complete.', data: { threadId: null } }))
})

it('suppresses foreground notifications only for same-origin visible clients', async () => {
  const f = fixture()
  f.matchAll.mockResolvedValue([{ visibilityState: 'visible', url: 'https://remote.test/' }])
  await f.push({}); expect(f.showNotification).not.toHaveBeenCalled()
  f.matchAll.mockResolvedValue([{ focused: true, url: 'https://remote.test/' }])
  await f.push({}); expect(f.showNotification).not.toHaveBeenCalled()
  f.matchAll.mockResolvedValue([{ focused: true, url: 'https://evil.test/' }])
  await f.push({}); expect(f.showNotification).toHaveBeenCalledOnce()
})

it('routes an existing app by acknowledged message without navigating/reloading it', async () => {
  const f = fixture(), focus = vi.fn(), navigate = vi.fn()
  const postMessage = vi.fn((_data, ports) => ports[0].postMessage({ accepted: true }))
  f.matchAll.mockResolvedValue([{ url: 'https://remote.test/', focus, navigate, postMessage }])
  await f.click({ threadId: 'correct-thread', url: 'https://evil.test/' })
  expect(postMessage).toHaveBeenCalledWith({ type: 'CODEX_OPEN_THREAD', threadId: 'correct-thread' }, expect.anything())
  expect(focus).toHaveBeenCalledOnce(); expect(navigate).not.toHaveBeenCalled(); expect(f.openWindow).not.toHaveBeenCalled()
})

it('opens a safe app target when no compatible app exists, leaving other tools untouched', async () => {
  const f = fixture(), focus = vi.fn(), navigate = vi.fn()
  f.matchAll.mockResolvedValue([{ url: 'https://remote.test/working-hours', focus, navigate }, { url: 'https://remote.test/', frameType: 'nested', focus, navigate }, { url: 'https://evil.test/', focus }])
  await f.click({ threadId: 'correct-thread' })
  expect(f.openWindow).toHaveBeenLastCalledWith('/#thread=correct-thread')
  expect(focus).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled()
  await f.click({ threadId: '../../api/logout', url: '//evil.test/' })
  expect(f.openWindow).toHaveBeenLastCalledWith('/')
  f.matchAll.mockResolvedValue([{ url: 'https://remote.test/', focus, postMessage: (_data: unknown, ports: MessagePort[]) => ports[0].postMessage({ accepted: false }) }])
  await f.click({ threadId: 'older-client' })
  expect(f.openWindow).toHaveBeenLastCalledWith('/#thread=older-client')
})
