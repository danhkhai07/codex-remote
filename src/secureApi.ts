import { ensurePreviewMigrationReady } from './legacyPreviewWorkers'
import { SecureTransport, SecureTransportError } from '../server/secure-client'
import type { SecureMetadata } from '../server/secure-wire'
import { CipherCache } from './secureCache'
import { beginDeviceTrust, discardDevice, forgetDevice, readDevice, saveDevice, trustFence, TRUST_FENCE, type TrustedDevice } from './trustedDevice'
export { SecureTransportError }
export const secureTransport = new SecureTransport()
let metadata: SecureMetadata | undefined
let cache: CipherCache | undefined
let setupPromise: Promise<SecureMetadata> | undefined
let epoch = 0
let readyEpoch = -1
let unlockFence: string | null | undefined
let trustExpiry: ReturnType<typeof setTimeout> | undefined
let accessDeadline = 0
let lifetime = new AbortController()
export class SecureCancelledError extends SecureTransportError { constructor() { super(423, 'Secure operation cancelled by lock') } }
function advanceEpoch() { clearTimeout(trustExpiry); epoch++; readyEpoch = -1; lifetime.abort(); lifetime = new AbortController(); setupPromise = undefined }
/** Capture user intent BEFORE its first await, including a native file picker. */
export function secureIntent(requireUnlocked = true) {
  const started = epoch, signal = lifetime.signal
  return { signal, assert() {
    if (started === epoch && readyEpoch === epoch) {
      if (Date.now() >= accessDeadline) lockSecure()
      else if (unlockFence !== currentFence()) lockSecure(false, false, false)
    }
    if (signal.aborted || started !== epoch || (readyEpoch === epoch && unlockFence !== currentFence()) || (requireUnlocked && metadata?.required && (!secureTransport.unlocked || readyEpoch !== epoch))) throw new SecureCancelledError()
  } }
}
let migrationReady: () => Promise<void>
const urls = new Set<string>()
const locks = new Set<(message?: string) => void>()
const broadcast = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('codex-remote-secure-lock-v1') : undefined
/** Await a fresh known-residue check before setup/restore/login/unlock. */
export function installMigrationReady(hook: () => Promise<void>) { migrationReady = hook }
installMigrationReady(() => ensurePreviewMigrationReady(true))
export function awaitMigrationReady() { return migrationReady() }
export async function secureSetup() {
  const intent = secureIntent(false)
  await awaitMigrationReady(); intent.assert()
  try { beginDeviceTrust() } catch { /* RAM-only access does not require local storage. */ }
  if (!setupPromise) {
    const operation = secureTransport.setup().then(value => { intent.assert(); metadata = value; return value }).catch(error => { if (setupPromise === operation) setupPromise = undefined; throw error })
    setupPromise = operation
  }
  const value = await setupPromise; intent.assert(); return value
}
export const secureRequired = () => Boolean(metadata?.required)
export const secureUnlocked = () => readyEpoch === epoch && secureTransport.unlocked
export function onSecureLock(callback: (message?: string) => void) { locks.add(callback); return () => { locks.delete(callback) } }
export function secureObjectUrl(blob: Blob) { const url = URL.createObjectURL(blob); urls.add(url); return url }
export function revokeSecureUrl(url: string) { URL.revokeObjectURL(url); urls.delete(url) }
function currentFence() { try { return trustFence() } catch { return undefined } }
async function openSecure(key?: string, remember = false) {
  advanceEpoch(); secureTransport.lock(); cache?.lock(); cache = undefined
  const intent = secureIntent(false)
  unlockFence = currentFence()
  let candidate: CipherCache | undefined, saved: TrustedDevice | undefined
  const current = () => { intent.assert(); if (unlockFence !== currentFence() || (saved && saved.expires <= Date.now())) throw new SecureCancelledError() }
  try {
    await awaitMigrationReady(); current()
    const fresh = await secureTransport.setup(); current()
    if (!fresh.required || !fresh.app || !fresh.generation) throw Error('Secure API is not configured')
    if (key === undefined) {
      saved = await readDevice(current, intent.signal); current()
      if (!saved) return false
      if (saved.app !== fresh.app || saved.generation !== fresh.generation) {
        await discardDevice(saved, current); return false
      }
      await secureTransport.unlock(saved.owner, saved); current()
    } else {
      await secureTransport.unlock(key); current()
    }
    if (secureTransport.identity?.app !== fresh.app || secureTransport.identity.generation !== fresh.generation) throw new SecureTransportError(412, 'Secure configuration changed; unlock again')
    // Never open the cache/private UI on cookie possession or stored-key presence alone.
    const authenticated = await secureTransport.request('/api/session'); current()
    const session = await authenticated.response.json(); current()
    if (!authenticated.response.ok || !Number.isSafeInteger(session.expiresAt) || session.expiresAt * 1000 <= Date.now() || typeof session.csrf !== 'string') throw new SecureTransportError(401, 'Phiên đăng nhập hết hạn')
    if (saved && (saved.expires > session.expiresAt * 1000 || saved.expires <= Date.now())) throw new SecureTransportError(401, 'Thời gian nhớ thiết bị đã hết')
    candidate = new CipherCache(fresh.app + ':' + fresh.generation + ':owner')
    try { await candidate.unlock(secureTransport.owner!); current(); await candidate.purgeOtherGenerations(current, intent.signal) }
    catch { current(); /* Storage failure still allows online access without cache. */ }
    let rememberedExpiry: number | undefined
    if (remember) {
      const fence = beginDeviceTrust(); unlockFence = fence
      rememberedExpiry = await saveDevice(secureTransport.owner!, secureTransport.identity!, session.expiresAt, fence, current, intent.signal); current()
    }
    current()
    const expires = saved?.expires ?? rememberedExpiry ?? session.expiresAt * 1000
    if (expires <= Date.now()) throw new SecureTransportError(401, 'Phiên đăng nhập hết hạn')
    metadata = fresh; cache = candidate; accessDeadline = expires; readyEpoch = epoch
    const openedEpoch = epoch
    const expire = () => {
      if (epoch !== openedEpoch) return
      const remaining = expires - Date.now()
      if (remaining <= 0) lockSecure()
      else trustExpiry = setTimeout(expire, Math.min(2147483647, remaining))
    }
    expire()
    return true
  } catch (error) {
    candidate?.lock()
    if (!intent.signal.aborted) {
      secureTransport.lock()
      // A transient offline/proof transport failure does not silently forget valid trust.
      // It still leaves RAM/UI locked; a later reload must perform fresh authorization.
      if (saved && (saved.expires <= Date.now() || (error instanceof SecureTransportError && [401, 403, 412].includes(error.status)))) await discardDevice(saved, intent.assert).catch(() => {})
    }
    throw error
  }
}
export const unlockSecure = (key: string, remember = false) => openSecure(key, remember)
export const restoreSecureDevice = () => openSecure()
/** React unmount/ordinary exit clears RAM but is not a user request to forget trust. */
export const releaseSecureMemory = () => lockSecure(false, false, false)
export function lockSecure(logout = false, notify = true, forget = true) {
  advanceEpoch()
  const lockedEpoch = epoch
  if (forget) void forgetDevice().catch(() => {
    if (epoch === lockedEpoch) for (const callback of locks) callback('Không thể xóa dữ liệu nhớ thiết bị. Thử lại khi bộ nhớ trình duyệt khả dụng; đăng xuất sẽ thu hồi phiên trên máy chủ.')
  })
  unlockFence = currentFence()
  secureTransport.lock()
  if (logout) void cache?.purgeApp(); else cache?.lock()
  cache = undefined
  for (const url of urls) URL.revokeObjectURL(url)
  urls.clear()
  for (const callback of locks) callback()
  if (notify) broadcast?.postMessage({ kind: logout ? 'logout' : 'lock' })
}
broadcast?.addEventListener('message', event => { if (['lock', 'logout'].includes(event.data?.kind)) lockSecure(event.data.kind === 'logout', false, false) })
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if ((event.key === TRUST_FENCE || event.key === null) && unlockFence !== currentFence()) lockSecure(false, false, false)
})
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && readyEpoch === epoch && Date.now() >= accessDeadline) lockSecure()
})
export async function secureLogin(password: string) {
  const intent = secureIntent(false)
  await awaitMigrationReady(); intent.assert()
  await forgetDevice().catch(() => {}); intent.assert() // A new server session cannot reuse old trust binding.
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

/** History-only local paint, after THIS unlock performed fresh owner/session proof.
 * No plaintext persistence, no cache access on a locked/offline cold session. */
export async function cachedHistoryResponse(path: string): Promise<Response | null> {
  if (!/^\/api\/threads\/[^/?]+\/history(?:\?before=[^#]*)?$/.test(path) || !metadata?.required) return null
  const intent = secureIntent(); intent.assert()
  const current = cache
  if (!current) return null
  try {
    const id = await current.identify(path, '{}'); intent.assert()
    const previous = await current.get(id); intent.assert()
    if (!previous || previous.meta.path !== path || previous.meta.representation !== '{}' || previous.meta.response.status !== 200) return null
    const body = await current.body(id, previous); intent.assert()
    return new Response(body as Uint8Array<ArrayBuffer>, { headers: previous.meta.response.headers })
  } catch { intent.assert(); return null }
}
