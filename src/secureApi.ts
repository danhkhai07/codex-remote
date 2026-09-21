import { ensurePreviewMigrationReady } from './legacyPreviewWorkers'
import { SecureTransport, SecureTransportError } from '../server/secure-client'
import type { SecureMetadata } from '../server/secure-wire'
import { CipherCache } from './secureCache'
export { SecureTransportError }
export const secureTransport = new SecureTransport()
let metadata: SecureMetadata | undefined
let cache: CipherCache | undefined
let setupPromise: Promise<SecureMetadata> | undefined
let epoch = 0
let migrationReady: () => Promise<void>
const urls = new Set<string>()
const locks = new Set<() => void>()
const broadcast = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('codex-remote-secure-lock-v1') : undefined
/** Await a fresh known-residue check before setup/restore/login/unlock. */
export function installMigrationReady(hook: () => Promise<void>) { migrationReady = hook }
installMigrationReady(() => ensurePreviewMigrationReady(true))
export function awaitMigrationReady() { return migrationReady() }
export async function secureSetup() {
  await awaitMigrationReady()
  if (!setupPromise) setupPromise = secureTransport.setup().then(value => { metadata = value; return value }).catch(error => { setupPromise = undefined; throw error })
  return setupPromise
}
export const secureRequired = () => Boolean(metadata?.required)
export const secureUnlocked = () => secureTransport.unlocked
export function onSecureLock(callback: () => void) { locks.add(callback); return () => { locks.delete(callback) } }
export function secureObjectUrl(blob: Blob) { const url = URL.createObjectURL(blob); urls.add(url); return url }
export function revokeSecureUrl(url: string) { URL.revokeObjectURL(url); urls.delete(url) }
export async function unlockSecure(key: string) {
  await awaitMigrationReady()
  // Fresh metadata detects rotation, including after a previous unsuccessful unlock.
  const fresh = await secureTransport.setup()
  if (!fresh.required || !fresh.app || !fresh.generation) throw Error('Secure API is not configured')
  if (metadata?.generation && metadata.generation !== fresh.generation) await cache?.purgeApp()
  metadata = fresh
  await secureTransport.unlock(key)
  cache = new CipherCache(fresh.app + ':' + fresh.generation + ':owner')
  try { await cache.unlock(secureTransport.owner!); await cache.purgeOtherGenerations() } catch { /* Storage failure never prevents online access. */ }
}
export function lockSecure(logout = false, notify = true) {
  epoch++
  secureTransport.lock()
  if (logout) void cache?.purgeApp(); else cache?.lock()
  cache = undefined
  for (const url of urls) URL.revokeObjectURL(url)
  urls.clear()
  for (const callback of locks) callback()
  if (notify) broadcast?.postMessage({ kind: logout ? 'logout' : 'lock' })
}
broadcast?.addEventListener('message', event => { if (['lock', 'logout'].includes(event.data?.kind)) lockSecure(event.data.kind === 'logout', false) })
export async function secureLogin(password: string) {
  await awaitMigrationReady()
  const response = await fetch('/api/session/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
  await response.arrayBuffer()
  if (!response.ok) throw new SecureTransportError(response.status, response.status === 429 ? 'Too many attempts. Try again later.' : 'Login failed')
}
export async function secureFetch(path: string, init: RequestInit = {}): Promise<Response> {
  // The outer gate always checks setup before mounting business UI. No discovery
  // request or fallback to plaintext on network failure is allowed here.
  if (!metadata) throw new SecureTransportError(423, 'Secure setup is not ready')
  if (!metadata.required) return fetch(path, init)
  const started = epoch
  const assertUnlocked = () => { if (started !== epoch || !secureTransport.unlocked) throw new SecureTransportError(423, 'Secure request cancelled by lock') }
  const method = init.method ?? 'GET', current = cache
  const representation = JSON.stringify(Object.fromEntries(new Headers(init.headers).entries()))
  const resource = await current?.identify(path, representation)
  let previous = resource && method === 'GET' ? await current?.get(resource) : null
  if (previous && (previous.meta.path !== path || previous.meta.representation !== representation)) previous = null
  const perform = (revision?: string) => secureTransport.request(path, init, resource ? { resource, revision } : undefined)
  let result
  try { result = await perform(previous?.meta.response.revision) }
  catch (error) {
    if (error instanceof SecureTransportError && [401, 412].includes(error.status)) {
      const currentSetup = await secureTransport.setup().catch(() => undefined)
      if (currentSetup?.generation && currentSetup.generation !== metadata?.generation) { await current?.purgeApp(); lockSecure(true) }
      else if (error.status === 401) lockSecure()
    }
    throw error
  }
  if (result.meta.unchanged) {
    await result.response.arrayBuffer() // Authenticate completion before using any cached bytes.
    try {
      if (!previous || !resource || !current || result.meta.revision !== previous.meta.response.revision) throw Error('Missing cached body')
      const body = await current.body(resource, previous)
      assertUnlocked()
      return new Response(body as Uint8Array<ArrayBuffer>, { status: result.meta.status, headers: result.meta.headers })
    } catch { result = await perform() } // Safe read refetch; never replay a mutation.
  }
  if (method === 'GET' && result.response.ok && result.meta.revision && resource && current) {
    // Server issues a revision only for bounded responses. Read once, then cache
    // a separately encrypted representation, never a transport packet.
    const body = new Uint8Array(await result.response.arrayBuffer())
    await current.put(resource, { path, representation, response: result.meta, expires: 0 }, body)
    assertUnlocked()
    return new Response(body, { status: result.meta.status, headers: result.meta.headers })
  }
  if (path === '/api/session/logout' && result.response.ok) {
    await result.response.arrayBuffer(); lockSecure(true)
    return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } })
  }
  return result.response
}
