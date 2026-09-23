import { afterEach, expect, it, vi } from 'vitest'
import { consumeNotificationTarget, installNotificationNavigation, pendingNotificationTarget, subscribeNotificationTarget, threadFromNotificationHash } from './notificationNavigation'

const cleanup: Array<() => void> = []
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.unstubAllGlobals() })
function fixture(hash = '') {
  const events = new Map<string, (event: unknown) => void>(), messages = new Map<string, (event: unknown) => void>()
  const location = { origin: 'https://remote.test', pathname: '/', search: '', hash }
  const replaceState = vi.fn((_state, _unused, path: string) => { location.hash = new URL(path, location.origin).hash })
  vi.stubGlobal('window', { location, history: { state: {}, replaceState }, addEventListener: (name: string, handler: never) => events.set(name, handler), removeEventListener: vi.fn() })
  vi.stubGlobal('navigator', { serviceWorker: { addEventListener: (name: string, handler: never) => messages.set(name, handler), removeEventListener: vi.fn() } })
  cleanup.push(installNotificationNavigation())
  const send = (threadId: unknown, source = 'https://remote.test/sw.js?v=new') => {
    const ack = vi.fn()
    messages.get('message')!({ source: { scriptURL: source }, data: { type: 'CODEX_OPEN_THREAD', threadId }, ports: [{ postMessage: ack }] })
    return ack
  }
  return { location, replaceState, send }
}

it('holds the cold target until the authenticated app consumes it, without API calls', () => {
  const f = fixture('#thread=thread-b')
  const update = vi.fn(); cleanup.push(subscribeNotificationTarget(update))
  expect(pendingNotificationTarget()?.threadId).toBe('thread-b')
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'thread-b' }))
  consumeNotificationTarget(pendingNotificationTarget()!)
  expect(pendingNotificationTarget()).toBeNull(); expect(f.location.hash).toBe('')
})

it('accepts SW requests outside the locked UI, retaining only the latest target and no key', () => {
  const f = fixture()
  expect(f.send('first')).toHaveBeenCalledWith({ accepted: true })
  const earlier = pendingNotificationTarget()!
  expect(f.send('second')).toHaveBeenCalledWith({ accepted: true })
  consumeNotificationTarget(earlier)
  expect(pendingNotificationTarget()?.threadId).toBe('second')
  expect(f.location.hash).toBe('#thread=second')
  consumeNotificationTarget(pendingNotificationTarget()!)
  expect(f.location.hash).toBe('')
})

it('ignores arbitrary page/cross-origin workers, invalid IDs and non-chat app pages', () => {
  const f = fixture()
  for (const source of ['https://evil.test/sw.js', 'https://remote.test/preview/123/sw.js', '']) expect(f.send('target', source)).not.toHaveBeenCalled()
  for (const id of ['//evil.test', '../../api/logout', 'a?b', 'a#b', 'x'.repeat(129), null]) expect(f.send(id)).not.toHaveBeenCalled()
  f.location.pathname = '/working-hours'
  expect(f.send('target')).not.toHaveBeenCalled()
  f.location.pathname = '/'
  Object.assign(window, { self: {}, top: {} })
  expect(f.send('target')).not.toHaveBeenCalled()
  expect(pendingNotificationTarget()).toBeNull()
  for (const hash of ['#thread=https://evil.test', '#thread=a&x=y', '#thread=%2f%2fevil.test', '#x=hello', '#thread=']) expect(threadFromNotificationHash(hash)).toBeNull()
})
