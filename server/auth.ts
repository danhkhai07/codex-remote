import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const SESSION_COOKIE = 'codex_remote_session'
export const sessionCookieName = (secure: boolean) => secure ? '__Host-codex_remote_session' : SESSION_COOKIE

export type SessionPayload = {
  credentialVersion: string
  csrf: string
  expiresAt: number
  issuedAt: number
  nonce: string
}

function base64url(value: string): string {
  return Buffer.from(value).toString('base64url')
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

function sameBytes(left: string, right: string): boolean {
  const a = createHash('sha256').update(left).digest()
  const b = createHash('sha256').update(right).digest()
  return timingSafeEqual(a, b)
}

export function passwordMatches(provided: unknown, expected: string): boolean {
  return typeof provided === 'string' && sameBytes(provided, expected)
}

export const credentialVersion = (secret: string, password = '') => createHmac('sha256', secret).update(`codex-credentials-v1:${password}`).digest('hex')

export function createSession(secret: string, ttlSeconds: number, password = ''): { token: string; payload: SessionPayload } {
  const now = Math.floor(Date.now() / 1000)
  const payload: SessionPayload = {
    credentialVersion: credentialVersion(secret, password),
    csrf: randomBytes(24).toString('base64url'),
    expiresAt: now + ttlSeconds,
    issuedAt: now,
    nonce: randomBytes(18).toString('base64url'),
  }
  const encoded = base64url(JSON.stringify(payload))
  return { token: `${encoded}.${sign(encoded, secret)}`, payload }
}

export function verifySession(token: string | undefined, secret: string, password?: string): SessionPayload | null {
  if (!token) return null
  const separator = token.lastIndexOf('.')
  if (separator < 1) return null
  const encoded = token.slice(0, separator)
  const signature = token.slice(separator + 1)
  if (!sameBytes(signature, sign(encoded, secret))) return null

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<SessionPayload>
    const now = Math.floor(Date.now() / 1000)
    if (
      typeof payload.credentialVersion !== 'string' ||
      (password !== undefined && payload.credentialVersion !== credentialVersion(secret, password)) ||
      typeof payload.csrf !== 'string' ||
      !Number.isSafeInteger(payload.expiresAt) ||
      !Number.isSafeInteger(payload.issuedAt) ||
      typeof payload.nonce !== 'string' ||
      (payload.expiresAt ?? 0) <= now ||
      (payload.issuedAt ?? Infinity) > now + 30
    ) return null
    return payload as SessionPayload
  } catch {
    return null
  }
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const result: Record<string, string> = {}
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const separator = part.indexOf('=')
    if (separator < 1) continue
    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    try {
      result[key] = decodeURIComponent(value)
    } catch {
      // Ignore malformed cookies rather than rejecting unrelated requests.
    }
  }
  return result
}

export function setSessionCookie(
  res: ServerResponse,
  token: string,
  ttlSeconds: number,
  secure: boolean,
): void {
  const parts = [
    `${sessionCookieName(secure)}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${ttlSeconds}`,
  ]
  if (secure) parts.push('Secure')
  res.setHeader('Set-Cookie', parts.join('; '))
}

export function clearSessionCookie(res: ServerResponse, secure: boolean): void {
  const parts = [
    `${sessionCookieName(secure)}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
  ]
  if (secure) parts.push('Secure')
  res.setHeader('Set-Cookie', parts.join('; '))
}

export function getSession(req: IncomingMessage, secret: string, secure = false, password = ''): SessionPayload | null {
  const name = sessionCookieName(secure)
  // Duplicate cookie names are ambiguous (including cookie tossing from siblings).
  if ((req.headers.cookie ?? '').split(';').filter(part => part.trim().startsWith(`${name}=`)).length !== 1) return null
  return verifySession(parseCookies(req)[name], secret, password)
}
