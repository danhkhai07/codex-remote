import { describe, expect, it } from 'vitest'
import { createSession, passwordMatches, verifySession } from './auth.js'

describe('remote session authentication', () => {
  it('issues verifiable, expiring signed sessions', () => {
    const secret = 's'.repeat(48)
    const session = createSession(secret, 600)

    expect(verifySession(session.token, secret)).toMatchObject({ csrf: session.payload.csrf })
    expect(verifySession(`${session.token}tampered`, secret)).toBeNull()
    expect(verifySession(session.token, 'x'.repeat(48))).toBeNull()
    expect(verifySession(createSession(secret, -1).token, secret)).toBeNull()
  })

  it('compares passwords without accepting non-string values', () => {
    expect(passwordMatches('correct horse battery staple', 'correct horse battery staple')).toBe(true)
    expect(passwordMatches('wrong', 'correct horse battery staple')).toBe(false)
    expect(passwordMatches(null, 'correct horse battery staple')).toBe(false)
  })
})
