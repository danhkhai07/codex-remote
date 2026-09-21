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
let readyEpoch = -1
let lifetime = new AbortController()
export class SecureCancelledError extends SecureTransportError { constructor() { super(423, 'Secure operation cancelled by lock') } }
function advanceEpoch() { epoch++; readyEpoch = -1; lifetime.abort(); lifetime = new AbortController(); setupPromise = undefined }
/** Capture user intent BEFORE its first await, including a native file picker. */
export function secureIntent(requireUnlocked = true) {
  const started = epoch, signal = lifetime.signal
  return { signal, assert() {
    if (signal.aborted || started !== epoch || (requireUnlocked && metadata?.required && (!secureTransport.unlocked || readyEpoch !== epoch))) throw new SecureCancelledError()
  } }
}
let migrationReady: () => Promise<void>
const urls = new Set<string>()
const locks = new Set<() => void>()
const broadcast = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('codex-remote-secure-lock-v1') : undefined
/** Await a fresh known-residue check before setup/restore/login/unlock. */
export function installMigrationReady(hook: () => Promise<void>) { migrationReady = hook }
installMigrationReady(() => ensurePreviewMigrationReady(true))
export function awaitMigrationReady() { return migrationReady() }
export async function secureSetup() {
  const intent = secureIntent(false)
  await awaitMigrationReady(); intent.assert()
  if (!setupPromise) {
    const operation = secureTransport.setup().then(value => { intent.assert(); metadata = value; return value }).catch(error => { if (setupPromise === operation) setupPromise = undefined; throw error })
    setupPromise = operation
  }
  const value = await setupPromise; intent.assert(); return value
}
export const secureRequired = () => Boolean(metadata?.required)
export const secureUnlocked = () => readyEpoch === epoch && secureTransport.unlocked
export function onSecureLock(callback: () => void) { locks.add(callback); return () => { locks.delete(callback) } }
export function secureObjectUrl(blob: Blob) { const url = URL.createObjectURL(blob); urls.add(url); return url }
export function revokeSecureUrl(url: string) { URL.revokeObjectURL(url); urls.delete(url) }
export async function unlockSecure(key: string) {
  advanceEpoch(); secureTransport.lock(); cache?.lock(); cache = undefined
  const intent = secureIntent(false)
  let candidate: CipherCache | undefined
  try {
    await awaitMigrationReady(); intent.assert()
    const fresh = await secureTransport.setup(); intent.assert()
    if (!fresh.required || !fresh.app || !fresh.generation) throw Error('Secure API is not configured')
    await secureTransport.unlock(key); intent.assert()
    candidate = new CipherCache(fresh.app + ':' + fresh.generation + ':owner')
    try { await candidate.unlock(secureTransport.owner!); intent.assert(); await candidate.purgeOtherGenerations(intent.assert, intent.signal) }
    catch { intent.assert(); /* Storage failure still allows online access. */ }
    intent.assert()
    metadata = fresh; cache = candidate; readyEpoch = epoch
  } catch (error) {
    candidate?.lock()
    // Stale completion must never lock a newer successful unlock.
    if (!intent.signal.aborted) secureTransport.lock()
    throw error
  }
}
export function lockSecure(logout = false, notify = true) {
  advanceEpoch()
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
  const intent = secureIntent(false)
  await awaitMigrationReady(); intent.assert()
  const response = await fetch('/api/session/login', { method: 'POST', signal: intent.signal, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
  await response.arrayBuffer(); intent.assert()
  if (!response.ok) throw new SecureTransportError(response.status, response.status === 429 ? 'Too many attempts. Try again later.' : 'Login failed')
}
export async function secureFetch(path: string, init: RequestInit = {}): Promise<Response> {
  // The outer gate always checks setup before mounting business UI. No discovery
  // request or fallback to plaintext on network failure is allowed here.
  if (!metadata) throw new SecureTransportError(423, 'Secure setup is not ready')
  if (!metadata.required) return fetch(path, init)
  const intent = secureIntent(); intent.assert()
  const assertUnlocked = intent.assert
  init = { ...init, signal: init.signal ? AbortSignal.any([init.signal, intent.signal]) : intent.signal }
  const method = init.method ?? 'GET', current = cache
  const representation = JSON.stringify(Object.fromEntries(new Headers(init.headers).entries()))
  const resource = await current?.identify(path, representation); assertUnlocked()
  let previous = resource && method === 'GET' ? await current?.get(resource) : null; assertUnlocked()
  if (previous && (previous.meta.path !== path || previous.meta.representation !== representation)) previous = null
  const perform = async (revision?: string) => { assertUnlocked(); const value = await secureTransport.request(path, init, resource ? { resource, revision } : undefined); assertUnlocked(); return value }
  let result
  try { result = await perform(previous?.meta.response.revision) }
  catch (error) {
    assertUnlocked()
    if (error instanceof SecureTransportError && [401, 412].includes(error.status)) {
      const currentSetup = await secureTransport.setup().catch(() => undefined); assertUnlocked()
      if (currentSetup?.generation && currentSetup.generation !== metadata?.generation) { await current?.purgeApp(); assertUnlocked(); lockSecure(true) }
      else if (error.status === 401) lockSecure()
    }
    throw error
  }
  if (result.meta.unchanged) {
    await result.response.arrayBuffer(); assertUnlocked() // Authenticate completion before cached bytes.
    try {
      if (!previous || !resource || !current || result.meta.revision !== previous.meta.response.revision) throw Error('Missing cached body')
      const body = await current.body(resource, previous)
      assertUnlocked()
      return new Response(body as Uint8Array<ArrayBuffer>, { status: result.meta.status, headers: result.meta.headers })
    } catch { assertUnlocked(); result = await perform() } // Safe read refetch; never replay a mutation.
  }
  if (method === 'GET' && result.response.ok && result.meta.revision && resource && current) {
    // Server issues a revision only for bounded responses. Read once, then cache
    // a separately encrypted representation, never a transport packet.
    const body = new Uint8Array(await result.response.arrayBuffer()); assertUnlocked()
    await current.put(resource, { path, representation, response: result.meta, expires: 0 }, body)
    assertUnlocked()
    return new Response(body, { status: result.meta.status, headers: result.meta.headers })
  }
  if (path === '/api/session/logout' && result.response.ok) {
    await result.response.arrayBuffer(); assertUnlocked(); lockSecure(true)
    return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } })
  }
  assertUnlocked(); return result.response
}
