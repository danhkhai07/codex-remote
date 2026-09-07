import { describe, expect, it } from 'vitest'
import { LoginRateLimiter } from './login-rate-limit.js'

describe('LoginRateLimiter', () => {
  it('blocks after eight failures and clears after a successful login', () => {
    const limiter = new LoginRateLimiter()
    const now = 1_000_000

    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect(limiter.isBlocked('client', now + attempt)).toBe(false)
      limiter.recordFailure('client', now + attempt)
    }
    expect(limiter.isBlocked('client', now + 8)).toBe(true)

    limiter.clear('client')
    expect(limiter.isBlocked('client', now + 9)).toBe(false)
  })

  it('expires isolated failures outside the window', () => {
    const limiter = new LoginRateLimiter(2, 1_000)
    limiter.recordFailure('client', 1_000)
    expect(limiter.isBlocked('client', 2_001)).toBe(false)
  })

  it('uses a fixed lockout instead of extending it on blocked requests', () => {
    const limiter = new LoginRateLimiter(2, 1_000)
    limiter.recordFailure('client', 1_000)
    limiter.recordFailure('client', 1_001)
    expect(limiter.isBlocked('client', 1_002)).toBe(true)
    expect(limiter.isBlocked('client', 1_900)).toBe(true)
    expect(limiter.isBlocked('client', 2_003)).toBe(false)
  })
})
