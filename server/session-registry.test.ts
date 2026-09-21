import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createSession, verifySession } from './auth.js'
import { SessionRegistry } from './session-registry.js'
const paths: string[] = []
afterEach(() => { vi.useRealTimers(); for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }) })
it('persists revocation without bearer material and rejects corrupt state', () => {
  const root = mkdtempSync(join(tmpdir(), 'sessions-')); paths.push(root)
  const file = join(root, 'sessions.json'), session = createSession('test-secret', 600)
  const store = new SessionRegistry('test-secret', file)
  expect(store.valid(session.payload)).toBe(true)
  store.revoke(session.payload)
  expect(new SessionRegistry('test-secret', file).valid(session.payload)).toBe(false)
  const stored = readFileSync(file, 'utf8')
  for (const secret of [session.token, session.payload.nonce, session.payload.csrf, 'test-secret']) expect(stored).not.toContain(secret)
  expect(verifySession(session.token, 'new-key')).toBeNull()
  expect(verifySession(session.token, 'test-secret', 'changed-password')).toBeNull()
  expect(new SessionRegistry('test-secret', file, 'changed-password').valid(session.payload)).toBe(false)
  const fresh = createSession('new-key', 600)
  expect(new SessionRegistry('new-key', file).valid(fresh.payload)).toBe(true)
  writeFileSync(file, '{}')
  expect(() => new SessionRegistry('new-key', file)).toThrow(/Invalid session/)
})
it('closes every bound stream on revocation, and expires without another request', () => {
  vi.useFakeTimers()
  const store = new SessionRegistry('test'), session = createSession('test', 600).payload
  const first = vi.fn(), second = vi.fn()
  store.watch(session, first); store.watch(session, second); store.revoke(session)
  expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce()
  const expires = createSession('test', 1).payload, close = vi.fn()
  store.watch(expires, close)
  vi.advanceTimersByTime(1001)
  expect(close).toHaveBeenCalledOnce(); expect(store.valid(expires)).toBe(false)
})
