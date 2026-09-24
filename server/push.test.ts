import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { notificationBody, notificationContext, PushService, validateSubscription } from './push.js'

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
  it('delivers approved completion metadata once and preserves keys/subscriptions across restart', async () => {
    const first = setup()
    const session = owner()
    first.service.subscribe(subscription, session)
    first.service.stop()
    const next = setup(undefined, first.path)
    expect(next.service.publicKey).toBe(first.service.publicKey)
    expect(next.service.enabled(subscription.endpoint, session)).toBe(true)
    expect(statSync(first.path).mode & 0o777).toBe(0o600)
    next.service.completed('private-thread', 'private-turn', { threadName: 'Sửa CR 1', groupName: 'Codex Remote', isLeader: true })
    await vi.waitFor(() => expect(next.send).toHaveBeenCalledTimes(1))
    expect(JSON.parse(next.send.mock.calls[0][1])).toEqual({ tag: expect.any(String), body: 'Lượt trả lời đã kết thúc.', notification: { threadId: 'private-thread', threadName: 'Sửa CR 1', groupName: 'Codex Remote', isLeader: true, outcome: 'completed' } })
    expect(next.send.mock.calls[0][1]).not.toContain('private-turn')
    expect(next.send.mock.calls[0][2]).toMatchObject({ TTL: expect.any(Number), urgency: 'high', timeout: 10000 })
    next.service.completed('private-thread', 'private-turn')
    expect(next.send).toHaveBeenCalledTimes(1)
    next.service.stop()
    const restarted = setup(undefined, first.path)
    restarted.service.completed('private-thread', 'private-turn')
    expect(restarted.send).not.toHaveBeenCalled()
  })

  it('renders a bounded plain-text answer, including JSON escapes and Unicode', async () => {
    expect(notificationBody('\n## Completed **cleanly**\n[Result](https://example.test) `ok`')).toBe('Completed cleanly Result ok')
    expect(notificationBody('')).toBe('Lượt trả lời đã kết thúc.')
    expect(notificationBody({ text: 'NOT AN ANSWER' })).toBe('Lượt trả lời đã kết thúc.')
    expect(notificationBody('AUTHORIZED ANSWER')).toBe('AUTHORIZED ANSWER')
    const { service, send } = setup()
    service.subscribe(subscription, owner())
    service.completed('t'.repeat(128), 'turn', { threadName: '😀'.repeat(80), groupName: '😀'.repeat(60) }, ('😀"\\').repeat(10000))
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
    const payload = send.mock.calls[0][1]
    expect(Buffer.byteLength(payload)).toBeLessThan(3500)
    const body = JSON.parse(payload).body
    expect(body.endsWith('…')).toBe(true)
    expect(body).not.toContain('\ufffd')
  })

  it('suppresses delivery while that subscribed device reports a visible app', async () => {
    const { service, send } = setup()
    const session = owner()
    service.subscribe(subscription, session)
    expect(service.visibility(subscription.endpoint, true, session)).toBe(true)
    service.completed('thread', 'visible-turn', { threadName: 'Visible' })
    await service.flush()
    expect(send).not.toHaveBeenCalled()
    expect(service.visibility(subscription.endpoint, false, session)).toBe(true)
    service.completed('thread', 'hidden-turn', { threadName: 'Hidden' })
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(JSON.parse(send.mock.calls[0][1])).toMatchObject({ body: 'Lượt trả lời đã kết thúc.' })
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

describe('bounded contextual completion metadata', () => {
  it('allows only bounded names and identifiers, with validated identifiers', () => {
    const context = notificationContext('thread-1', { threadName: '😀'.repeat(200), groupName: ' Group\n\u202eName ', isLeader: true })!
    expect([...context.threadName]).toHaveLength(80)
    expect(context.groupName).toBe('Group Name')
    expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThan(1500)
    expect(notificationContext('//evil.test')).toBeUndefined()
    expect(notificationContext('x'.repeat(129))).toBeUndefined()
    expect(notificationContext('t', { isLeader: true })).toMatchObject({ groupName: '', isLeader: false })
  })

  it('persists a snapshot across retry/restart and coalesces all fields together', async () => {
    vi.useFakeTimers()
    const first = setup(vi.fn().mockRejectedValue({ statusCode: 503 }))
    first.service.subscribe(subscription, owner())
    const context = { threadName: 'Leader old name', groupName: 'Group A', isLeader: true }
    first.service.completed('leader', 'turn-1', context, '**Answer A** with literal _under_score_')
    context.threadName = 'Later rename'; context.isLeader = false
    await vi.advanceTimersByTimeAsync(0)
    first.service.stop()
    const next = setup(undefined, first.path)
    next.service.start()
    await vi.advanceTimersByTimeAsync(2100)
    expect(JSON.parse(next.send.mock.calls[0][1]).notification).toMatchObject({ threadId: 'leader', threadName: 'Leader old name', groupName: 'Group A', isLeader: true })
    expect(JSON.parse(next.send.mock.calls[0][1]).body).toBe('Answer A with literal _under_score_')
    next.service.stop()
    next.service.completed('worker', 'turn-2', { threadName: 'Worker B', groupName: 'Group B', isLeader: false })
    next.service.completed('solo', 'turn-3', { threadName: 'Solo', outcome: 'failed' }, 'Answer C')
    const last = setup(undefined, first.path)
    last.service.start(); await vi.advanceTimersByTimeAsync(0)
    expect(last.send).toHaveBeenCalledTimes(1)
    expect(JSON.parse(last.send.mock.calls[0][1]).body).toBe('Answer C')
    expect(JSON.parse(last.send.mock.calls[0][1]).notification).toEqual({ threadId: 'solo', threadName: 'Solo', groupName: '', isLeader: false, outcome: 'failed' })
  })

  it('does not resurrect metadata after ownership changes, expiry, or foreground suppression', async () => {
    vi.useFakeTimers()
    const { service, send } = setup(vi.fn().mockRejectedValue({ statusCode: 503 }))
    const original = owner()
    service.subscribe(subscription, original)
    service.completed('secret-old-target', 'turn', { groupName: 'Old group', isLeader: true })
    await vi.advanceTimersByTimeAsync(0)
    service.subscribe(subscription, { ...original, nonce: 'new-session' })
    await vi.advanceTimersByTimeAsync(3000)
    expect(send).toHaveBeenCalledTimes(1)
    service.completed('new-target', 'next', { groupName: 'New group' })
    await vi.advanceTimersByTimeAsync(0)
    service.visibility(subscription.endpoint, true, { ...original, nonce: 'new-session' })
    await vi.advanceTimersByTimeAsync(3000)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('keeps the next completion intact when an older delivery is already in flight', async () => {
    vi.useFakeTimers()
    let finish!: (value: typeof response) => void
    const send = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue(response)
    const { service } = setup(send)
    service.subscribe(subscription, owner())
    service.completed('leader-a', 'turn-a', { threadName: 'Leader A', groupName: 'A', isLeader: true }, 'Answer A')
    await vi.advanceTimersByTimeAsync(0)
    service.completed('worker-b', 'turn-b', { threadName: 'Worker B', groupName: 'B', isLeader: false }, 'Answer B')
    finish(response)
    await vi.advanceTimersByTimeAsync(150)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls.map(call => JSON.parse(call[1]).body)).toEqual(['Answer A', 'Answer B'])
    expect(send.mock.calls.map(call => JSON.parse(call[1]).notification)).toEqual([
      { threadId: 'leader-a', threadName: 'Leader A', groupName: 'A', isLeader: true, outcome: 'completed' },
      { threadId: 'worker-b', threadName: 'Worker B', groupName: 'B', isLeader: false, outcome: 'completed' },
    ])
  })
})
