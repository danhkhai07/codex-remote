import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { notificationBody, PushService, validateSubscription } from './push.js'

const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test-device',
  keys: { p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') },
}
const owner = () => ({ nonce: 'session-one', expiresAt: Math.floor(Date.now() / 1000) + 3600 })
const response = { statusCode: 201, headers: {}, body: '' }
const directories: string[] = []
const services: PushService[] = []
function setup(send = vi.fn().mockResolvedValue(response), path?: string, secret = 'secret') {
  if (!path) {
    const directory = mkdtempSync(join(tmpdir(), 'remote-push-test-'))
    directories.push(directory)
    path = join(directory, 'push.json')
  }
  const service = new PushService(path, secret, 'https://remote.example.test', send)
  services.push(service)
  return { service, send, path }
}
afterEach(() => {
  for (const service of services.splice(0)) service.stop()
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Web Push delivery without an SSE client', () => {
  it('delivers a response preview once and preserves keys/subscriptions across restart', async () => {
    const first = setup()
    const session = owner()
    first.service.subscribe(subscription, session)
    first.service.stop()
    const next = setup(undefined, first.path)
    expect(next.service.publicKey).toBe(first.service.publicKey)
    expect(next.service.enabled(subscription.endpoint, session)).toBe(true)
    expect(statSync(first.path).mode & 0o777).toBe(0o600)
    next.service.completed('private-thread', 'private-turn', '**Finished successfully.**\nMore detail.')
    await vi.waitFor(() => expect(next.send).toHaveBeenCalledTimes(1))
    expect(JSON.parse(next.send.mock.calls[0][1])).toEqual({ tag: expect.any(String), body: 'Finished successfully.' })
    expect(next.send.mock.calls[0][1]).not.toContain('private')
    expect(next.send.mock.calls[0][2]).toMatchObject({ TTL: expect.any(Number), urgency: 'high', timeout: 10000 })
    next.service.completed('private-thread', 'private-turn')
    expect(next.send).toHaveBeenCalledTimes(1)
    next.service.stop()
    const restarted = setup(undefined, first.path)
    restarted.service.completed('private-thread', 'private-turn')
    expect(restarted.send).not.toHaveBeenCalled()
  })

  it('builds a short plain-text body from the first non-empty answer line', () => {
    expect(notificationBody('\n## Completed **cleanly**\nInternal detail')).toBe('Completed cleanly')
    expect(notificationBody('')).toBe('Your Codex turn is complete.')
    expect(notificationBody('x'.repeat(220))).toHaveLength(180)
    expect(notificationBody('x'.repeat(220))).toMatch(/…$/)
  })

  it('suppresses delivery while that subscribed device reports a visible app', async () => {
    const { service, send } = setup()
    const session = owner()
    service.subscribe(subscription, session)
    expect(service.visibility(subscription.endpoint, true, session)).toBe(true)
    service.completed('thread', 'visible-turn', 'Visible response')
    await service.flush()
    expect(send).not.toHaveBeenCalled()
    expect(service.visibility(subscription.endpoint, false, session)).toBe(true)
    service.completed('thread', 'hidden-turn', 'Hidden response')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(JSON.parse(send.mock.calls[0][1])).toMatchObject({ body: 'Hidden response' })
  })

  it('retries transient failure from persisted state after a restart', async () => {
    vi.useFakeTimers()
    const first = setup(vi.fn().mockRejectedValue({ statusCode: 503 }))
    first.service.subscribe(subscription, owner())
    first.service.completed('thread', 'turn')
    await vi.advanceTimersByTimeAsync(0)
    expect(first.send).toHaveBeenCalledTimes(1)
    first.service.stop()
    const next = setup(undefined, first.path)
    next.service.start()
    await vi.advanceTimersByTimeAsync(2100)
    expect(next.send).toHaveBeenCalledTimes(1)
  })

  it('removes expired devices and logout deliveries, respecting session ownership', async () => {
    const { service, send } = setup()
    const session = owner()
    service.subscribe(subscription, session)
    service.unsubscribe({ ...session, nonce: 'other-session' })
    expect(service.enabled(subscription.endpoint, session)).toBe(true)
    service.unsubscribe(session)
    service.completed('thread', 'logged-out')
    await service.flush()
    expect(send).not.toHaveBeenCalled()
    service.subscribe(subscription, { ...session, expiresAt: 1 })
    service.completed('thread', 'expired')
    await service.flush()
    expect(send).not.toHaveBeenCalled()
  })

  it('discards rejected subscriptions and invalidates state when the session secret rotates', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const first = setup(vi.fn().mockRejectedValue({ statusCode: 410 }))
    const session = owner()
    first.service.subscribe(subscription, session)
    first.service.completed('thread', 'turn')
    await vi.waitFor(() => expect(first.service.enabled(subscription.endpoint, session)).toBe(false))
    first.service.subscribe(subscription, session)
    first.service.stop()
    const next = setup(undefined, first.path, 'new-secret')
    expect(next.service.publicKey).not.toBe(first.service.publicKey)
    expect(next.service.enabled(subscription.endpoint, session)).toBe(false)
  })

  it.each(['http://fcm.googleapis.com/test', 'https://127.0.0.1/test', 'https://fcm.googleapis.com.evil.test/test', 'https://user:pass@fcm.googleapis.com/test', 'https://fcm.googleapis.com:8443/test'])('rejects unsafe delivery endpoint %s', endpoint => {
    expect(() => validateSubscription({ ...subscription, endpoint })).toThrow()
  })
  it('validates encryption keys and accepts the supported mobile push providers', () => {
    expect(() => validateSubscription({ ...subscription, keys: { auth: 'bad', p256dh: 'bad' } })).toThrow()
    for (const host of ['web.push.apple.com', 'updates.push.services.mozilla.com', 'updates-autopush.push.services.mozilla.com']) {
      expect(validateSubscription({ ...subscription, endpoint: `https://${host}/test` }).endpoint).toContain(host)
    }
  })
})
