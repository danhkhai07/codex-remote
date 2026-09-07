import { afterEach, expect, it, vi } from 'vitest'
import { api } from './api'
import { applicationServerKey, disablePush, enablePush, restorePush } from './push'

vi.mock('./api', () => ({ api: { pushKey: vi.fn(), subscribePush: vi.fn(), unsubscribePush: vi.fn() } }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks() })

function browser() {
  const key = Buffer.alloc(65, 4).toString('base64url')
  const payload = { endpoint: 'https://fcm.googleapis.com/test', keys: { auth: 'test', p256dh: 'test' } }
  const subscription = { options: { applicationServerKey: applicationServerKey(key).buffer }, toJSON: () => payload, unsubscribe: vi.fn().mockResolvedValue(true) }
  const pushManager = { getSubscription: vi.fn().mockResolvedValue(null), subscribe: vi.fn().mockResolvedValue(subscription) }
  const worker = { active: { postMessage: (_message: unknown, ports: MessagePort[]) => ports[0].postMessage({ push: true }) }, pushManager }
  const notification = { permission: 'default', requestPermission: vi.fn().mockResolvedValue('granted') }
  vi.stubGlobal('Notification', notification)
  vi.stubGlobal('window', { isSecureContext: true, Notification: notification, PushManager: {} })
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration: vi.fn().mockResolvedValue(worker) } })
  vi.mocked(api.pushKey).mockResolvedValue({ publicKey: key })
  vi.mocked(api.subscribePush).mockResolvedValue({ ok: true })
  return { key, payload, subscription, pushManager, notification }
}

it('requests permission in the tap, then registers the subscription with the authenticated server', async () => {
  const { notification, payload, pushManager } = browser()
  const enable = enablePush('csrf')
  expect(notification.requestPermission).toHaveBeenCalledTimes(1)
  expect(api.pushKey).not.toHaveBeenCalled()
  await enable
  expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }))
  expect(api.subscribePush).toHaveBeenCalledWith(payload, 'csrf')
})
it('surfaces permission and registration failures rather than reporting notifications enabled', async () => {
  const { notification } = browser()
  notification.requestPermission.mockResolvedValue('denied')
  await expect(enablePush('csrf')).rejects.toThrow('Allow notifications')
  expect(api.subscribePush).not.toHaveBeenCalled()
  notification.permission = 'granted'
  vi.mocked(api.subscribePush).mockRejectedValue(new Error('server unavailable'))
  await expect(enablePush('csrf')).rejects.toThrow('server unavailable')
})
it('restores an existing subscription to the new session without prompting', async () => {
  const { subscription, pushManager, notification, payload } = browser()
  notification.permission = 'granted'
  expect(await restorePush('new-csrf')).toBe(false)
  pushManager.getSubscription.mockResolvedValue(subscription)
  expect(await restorePush('new-csrf')).toBe(true)
  expect(notification.requestPermission).not.toHaveBeenCalled()
  expect(pushManager.subscribe).not.toHaveBeenCalled()
  expect(api.subscribePush).toHaveBeenCalledWith(payload, 'new-csrf')
})
it('replaces a subscription when server keys rotate and disables server delivery', async () => {
  const { subscription, pushManager, notification } = browser()
  notification.permission = 'granted'
  subscription.options.applicationServerKey = new Uint8Array([1, 2]).buffer
  pushManager.getSubscription.mockResolvedValue(subscription)
  expect(await restorePush('csrf')).toBe(false)
  await enablePush('csrf')
  expect(subscription.unsubscribe).toHaveBeenCalledTimes(1)
  expect(pushManager.subscribe).toHaveBeenCalledTimes(1)
  await disablePush('csrf')
  expect(api.unsubscribePush).toHaveBeenCalledWith('csrf')
})
