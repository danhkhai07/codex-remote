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

it('uses only convo name as title and authorized answer as body for every role', async () => {
  const f = fixture()
  for (const isLeader of [true, false]) {
    await f.push({ tag: 'turn', body: 'Đã sửa xong.', notification: { threadId: 'thread', threadName: 'Sửa CR', groupName: 'Project', isLeader } })
    expect(f.showNotification).toHaveBeenLastCalledWith('Sửa CR', expect.objectContaining({ body: 'Đã sửa xong.', data: { threadId: 'thread' } }))
  }
  await f.push({ notification: { threadId: 'solo', outcome: 'failed' } })
  expect(f.showNotification).toHaveBeenLastCalledWith('Cuộc hội thoại', expect.objectContaining({ body: 'Lượt chat bị lỗi.' }))
  await f.push({ body: '😀'.repeat(5000), notification: { threadId: 't', threadName: '\u202e' + '😀'.repeat(500) } })
  expect([...f.showNotification.mock.lastCall![0]]).toHaveLength(80)
  expect([...f.showNotification.mock.lastCall![1].body]).toHaveLength(2202)
  expect(f.showNotification.mock.lastCall![1].body.endsWith('…')).toBe(true)
})

it.each([null, {}, { body: 'PRIVATE' }, { notification: { threadId: '//evil.test' } }, { notification: { threadId: 'x'.repeat(129) } }])('falls back safely for malformed/old push: %j', async payload => {
  const f = fixture(); await f.push(payload)
  expect(f.showNotification).toHaveBeenCalledWith('Cuộc hội thoại', expect.objectContaining({ body: 'Lượt trả lời đã kết thúc.', data: { threadId: null } }))
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
