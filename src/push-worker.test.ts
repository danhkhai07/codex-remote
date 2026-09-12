import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'

it('shows a response preview only without a visible page and opens the app on tap', async () => {
  const handlers = new Map<string, (event: unknown) => void>()
  const showNotification = vi.fn().mockResolvedValue(undefined)
  const openWindow = vi.fn().mockResolvedValue(undefined)
  const matchAll = vi.fn().mockResolvedValue([])
  runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    self: {
      addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
      registration: { showNotification },
      clients: { matchAll, openWindow },
      location: { origin: 'https://remote.test' },
    }, URL,
  })
  let work: Promise<unknown> | undefined
  const waitUntil = (promise: Promise<unknown>) => { work = promise }
  handlers.get('push')!({ data: { json: () => ({ tag: 'turn-tag', body: 'Finished successfully.' }) }, waitUntil })
  await work
  expect(showNotification).toHaveBeenCalledWith('Codex finished', expect.objectContaining({ tag: 'codex-turn-turn-tag', body: 'Finished successfully.' }))
  matchAll.mockResolvedValue([{ visibilityState: 'visible', url: 'https://remote.test/' }])
  handlers.get('push')!({ data: { json: () => ({ tag: 'second-turn', body: 'Do not show this.' }) }, waitUntil })
  await work
  expect(showNotification).toHaveBeenCalledTimes(1)
  matchAll.mockResolvedValue([])
  handlers.get('notificationclick')!({ notification: { close: vi.fn(), data: { url: 'https://evil.test' } }, waitUntil })
  await work
  expect(openWindow).toHaveBeenCalledWith('/')
  const focus = vi.fn().mockResolvedValue(undefined)
  const navigate = vi.fn()
  matchAll.mockResolvedValue([{ url: 'https://remote.test/', focus, navigate }])
  handlers.get('notificationclick')!({ notification: { close: vi.fn() }, waitUntil })
  await work
  expect(focus).toHaveBeenCalled()
  expect(navigate).not.toHaveBeenCalled()
})
