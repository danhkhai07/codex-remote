import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { createSession, passwordMatches, verifySession, getSession, sessionCookieName } from './auth.js'

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

it('rejects old browser cookie names, ambiguous cookies, and tokens from an old password generation', () => {
  const { token } = createSession('fixture-secret', 600, 'password')
  const request = (cookie: string) => ({ headers: { cookie } }) as IncomingMessage
  const name = sessionCookieName(true)
  expect(getSession(request(`${name}=${token}`), 'fixture-secret', true, 'password')).not.toBeNull()
  expect(getSession(request(`codex_remote_session=${token}`), 'fixture-secret', true, 'password')).toBeNull()
  expect(getSession(request(`${name}=${token}; ${name}=${token}`), 'fixture-secret', true, 'password')).toBeNull()
  expect(getSession(request(`${name}=${token}`), 'fixture-secret', true, 'new-password')).toBeNull()
})
