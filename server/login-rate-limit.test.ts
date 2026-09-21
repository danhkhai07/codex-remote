import { describe, expect, it } from 'vitest'
import { LoginRateLimiter } from './login-rate-limit.js'

function fail(limiter: LoginRateLimiter, key: string, now: number) {
  const attempt = limiter.beginAttempt(key, now)
  expect(attempt.allowed).toBe(true)
  if (attempt.allowed) attempt.finish(false, now)
}

describe('LoginRateLimiter', () => {
  it('blocks eight failures for a fixed duration without extending a hot blocked key', () => {
    const limiter = new LoginRateLimiter()
    for (let attempt = 0; attempt < 8; attempt++) fail(limiter, 'client', 1_000 + attempt)
    expect(limiter.beginAttempt('client', 1_008)).toMatchObject({ allowed: false, reason: 'blocked', retryAfterSeconds: 900 })
    for (let i = 0; i < 10_000; i++) expect(limiter.beginAttempt('client', 900_000).allowed).toBe(false)
    expect(limiter.beginAttempt('client', 901_008).allowed).toBe(true)
  })

  it('bounds distinct identities, refuses admission without evicting blocked users, then recovers', () => {
    const limiter = new LoginRateLimiter(2, 1000, 4)
    fail(limiter, 'hot', 1000); fail(limiter, 'hot', 1001)
    for (let i = 0; i < 3; i++) fail(limiter, `cold${i}`, 1002)
    for (let i = 0; i < 20_000; i++) {
      expect(limiter.beginAttempt(`new${i}`, 1003)).toEqual({ allowed: false, reason: 'capacity', retryAfterSeconds: 1 })
    }
    expect(limiter.trackedIdentities).toBe(4)
    expect(limiter.beginAttempt('hot', 1100)).toMatchObject({ allowed: false, reason: 'blocked' })
    // Existing, non-blocked identity can still sign in when capacity is full.
    const known = limiter.beginAttempt('cold0', 1100)
    expect(known.allowed).toBe(true)
    if (known.allowed) known.finish(true, 1100)
    expect(limiter.trackedIdentities).toBe(3)
    fail(limiter, 'newly-admitted', 1100)
    expect(limiter.beginAttempt('hot', 1200).allowed).toBe(false)
    expect(limiter.beginAttempt('hot', 2002).allowed).toBe(true)
  })

  it('reclaims expired cold identities globally under requests from just one hot key', () => {
    const limiter = new LoginRateLimiter(2, 1000, 256)
    for (let i = 0; i < 200; i++) fail(limiter, `cold${i}`, 1000)
    fail(limiter, 'hot', 1900); fail(limiter, 'hot', 1901)
    for (let i = 0; i < 10; i++) expect(limiter.beginAttempt('hot', 2100).allowed).toBe(false)
    expect(limiter.trackedIdentities).toBe(1)
    expect(limiter.beginAttempt('new', 2100).allowed).toBe(true)
  })

  it('reserves concurrent slots before awaiting passwords; completion is idempotent', async () => {
    const limiter = new LoginRateLimiter(2, 1000, 2)
    const attempts = await Promise.all(Array.from({ length: 100 }, () => Promise.resolve(limiter.beginAttempt('same', 1000))))
    const admitted = attempts.filter(attempt => attempt.allowed)
    expect(admitted).toHaveLength(2)
    // Active reservations cannot expire out from under their late completion.
    expect(limiter.beginAttempt('same', 5000).allowed).toBe(false)
    for (const attempt of admitted) if (attempt.allowed) { attempt.finish(false, 5000); attempt.finish(true, 5001) }
    expect(limiter.beginAttempt('same', 5002)).toMatchObject({ allowed: false, retryAfterSeconds: 1 })
    expect(limiter.beginAttempt('same', 6001).allowed).toBe(true)
  })

  it('expires sliding failures and releases successful admission without growing timestamps', () => {
    const limiter = new LoginRateLimiter(2, 1000)
    fail(limiter, 'client', 1000)
    fail(limiter, 'client', 2001)
    const accepted = limiter.beginAttempt('client', 2002)
    expect(accepted.allowed).toBe(true)
    if (accepted.allowed) accepted.finish(true, 2002)
    expect(limiter.trackedIdentities).toBe(0)
    expect(limiter.beginAttempt('x'.repeat(129), 2002)).toMatchObject({ allowed: false, reason: 'capacity' })
    expect(limiter.trackedIdentities).toBe(0)
  })
})
