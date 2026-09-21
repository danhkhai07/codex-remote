import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { credentialVersion, type SessionPayload } from './auth.js'

export type SessionIdentity = Pick<SessionPayload, 'nonce' | 'expiresAt' | 'credentialVersion'>
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
/** One gateway process owns this durable revocation file. No bearer tokens are stored. */
export class SessionRegistry {
  readonly #key: string
  readonly credentialVersion: string
  #revoked = new Map<string, number>()
  #listeners = new Map<string, Set<() => void>>()
  constructor(secret: string, readonly file?: string, password = '') {
    this.credentialVersion = credentialVersion(secret, password)
    this.#key = this.credentialVersion
    if (file && existsSync(file)) {
      const state = JSON.parse(readFileSync(file, 'utf8'))
      if (state.version !== 1 || typeof state.key !== 'string' || !Array.isArray(state.revoked)
        || state.revoked.some((item: unknown) => !Array.isArray(item) || item.length !== 2 || !/^[a-f0-9]{64}$/.test(item[0]) || !Number.isSafeInteger(item[1]))) throw Error('Invalid session revocation state')
      // A different signing key already invalidates all prior bearer tokens.
      if (state.key === this.#key) this.#revoked = new Map(state.revoked)
    }
  }
  valid(session: SessionIdentity): boolean {
    return session.credentialVersion === this.credentialVersion && session.expiresAt * 1000 > Date.now() && !this.#revoked.has(digest(session.nonce))
  }
  revoke(session: SessionIdentity) {
    const revoked = new Map([...this.#revoked].filter(([, expiry]) => expiry * 1000 > Date.now()))
    const id = digest(session.nonce)
    revoked.set(id, session.expiresAt)
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
      const temp = `${this.file}.${process.pid}.tmp`
      writeFileSync(temp, JSON.stringify({ version: 1, key: this.#key, revoked: [...revoked] }) + '\n', { mode: 0o600 })
      renameSync(temp, this.file)
    }
    this.#revoked = revoked
    for (const close of (this.#listeners.get(id) ?? [])) close()
  }
  watch(session: SessionIdentity, close: () => void): () => void {
    if (!this.valid(session)) { close(); return () => {} }
    const id = digest(session.nonce), listeners = this.#listeners.get(id) ?? new Set()
    this.#listeners.set(id, listeners)
    const end = () => { cleanup(); close() }
    const timer = setTimeout(end, Math.min(2_147_483_647, session.expiresAt * 1000 - Date.now()))
    timer.unref()
    const cleanup = () => { clearTimeout(timer); listeners.delete(end); if (!listeners.size) this.#listeners.delete(id) }
    listeners.add(end)
    return cleanup
  }
}
