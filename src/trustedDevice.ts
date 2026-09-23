import type { SecureIdentity } from '../server/secure-client'

export const TRUST_DB = 'codex-remote-trusted-device-v1'
export const TRUST_FENCE = 'codex-remote-trust-fence-v1'
export const TRUST_ACTIVE = 'codex-remote-trust-active-v1'
export const TRUST_AGE = 7 * 86400000
export type TrustedDevice = SecureIdentity & { id: string; origin: string; owner: CryptoKey; fence: string; created: number; expires: number; signature: Uint8Array<ArrayBuffer> }
const unavailable = () => Error('Không thể nhớ hoặc quên thiết bị. Kiểm tra quyền lưu trữ rồi thử lại; có thể bỏ chọn để mở khóa chỉ trong lần này.')
export function trustFence(): string | null { return localStorage.getItem(TRUST_FENCE) }
export function beginDeviceTrust(): string {
  const current = trustFence()
  if (current) return current
  const value = crypto.randomUUID(); localStorage.setItem(TRUST_FENCE, value); return value
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(TRUST_DB, 1)
    let done = false
    const fail = () => { done = true; clearTimeout(timer); reject(unavailable()) }
    const timer = setTimeout(fail, 1500)
    request.onupgradeneeded = () => request.result.createObjectStore('device')
    request.onblocked = request.onerror = fail
    request.onsuccess = () => {
      clearTimeout(timer)
      if (done) request.result.close()
      else { request.result.onversionchange = () => request.result.close(); resolve(request.result) }
    }
  })
}
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>, check = () => {}, signal?: AbortSignal): Promise<T> {
  const db = await database()
  try {
    check(); if (signal?.aborted) throw unavailable()
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('device', mode)
      const abort = () => { try { tx.abort() } catch { /* already complete */ } }
      const timer = setTimeout(abort, 2000)
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
      signal?.addEventListener('abort', abort, { once: true })
      tx.onabort = tx.onerror = () => { cleanup(); reject(unavailable()) }
      try {
        const request = action(tx.objectStore('device'))
        tx.oncomplete = () => { cleanup(); try { check(); resolve(request.result) } catch (error) { reject(error) } }
      } catch (error) { abort(); cleanup(); reject(error) }
    })
  } finally { db.close() }
}
function valid(row: TrustedDevice, now: number): boolean {
  return Boolean(row && typeof row.id === 'string' && row.id.length <= 64 && row.origin === location.origin
    && [row.app, row.generation, row.binding].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(value))
    && typeof row.fence === 'string' && row.fence.length <= 64 && row.fence === trustFence()
    && row.owner instanceof CryptoKey && !row.owner.extractable && row.owner.type === 'secret'
    && row.owner.algorithm.name === 'HKDF' && row.owner.usages.join(',') === 'deriveKey'
    && row.signature instanceof Uint8Array && row.signature.length === 32
    && Number.isSafeInteger(row.created) && row.created <= now && Number.isSafeInteger(row.expires)
    && row.expires > now && row.expires <= row.created + TRUST_AGE)
}
const encoder = new TextEncoder()
const claims = (row: TrustedDevice) => encoder.encode(JSON.stringify([row.id, row.origin, row.app, row.generation, row.binding, row.fence, row.created, row.expires]))
const signingKey = (owner: CryptoKey) => crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(location.origin), info: encoder.encode('codex-remote/trusted-device-record/v1') }, owner, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify'])
/** Conditional deletion cannot remove a newer explicit save from another tab. */
export async function discardDevice(row: TrustedDevice, check = () => {}) {
  await transaction('readwrite', store => {
    const get = store.get('current')
    get.onsuccess = () => { if (get.result?.id === row?.id) store.delete('current') }
    return get
  }, check)
}
export async function readDevice(check: () => void, signal: AbortSignal): Promise<TrustedDevice | undefined> {
  if (!trustFence()) return undefined // Missing/unavailable fence never adopts an orphan key.
  const row = await transaction<TrustedDevice>('readonly', store => store.get('current'), check, signal)
  check()
  if (!row) return undefined
  if (localStorage.getItem(TRUST_ACTIVE) !== row.id) { await discardDevice(row, check); return undefined }
  let verified = false
  if (valid(row, Date.now())) {
    try { verified = await crypto.subtle.verify('HMAC', await signingKey(row.owner), row.signature, claims(row)) } catch { /* Corrupt capability or metadata. */ }
  }
  check()
  if (!verified || !valid(row, Date.now()) || localStorage.getItem(TRUST_ACTIVE) !== row.id) { await discardDevice(row, check); return undefined }
  return row
}
export async function saveDevice(owner: CryptoKey, identity: SecureIdentity, sessionExpires: number, fence: string, check: () => void, signal: AbortSignal) {
  const now = Date.now()
  const row: TrustedDevice = { ...identity, owner, id: crypto.randomUUID(), origin: location.origin, fence, created: now, expires: Math.min(now + TRUST_AGE, sessionExpires * 1000), signature: new Uint8Array(32) }
  const live = () => { check(); if (!valid(row, Date.now())) throw unavailable() }
  live()
  row.signature = new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(owner), claims(row))); live()
  try {
    await transaction('readwrite', store => store.put(row, 'current'), live, signal)
    live()
    // Publish only after the transaction AND the original user intent are still valid.
    // A crash/stale completion leaves an orphan capability which restore never adopts.
    localStorage.setItem(TRUST_ACTIVE, row.id)
  } catch (error) { await discardDevice(row).catch(() => {}); throw error }
  return row.expires
}
/** Rotate a synchronous nonsecret fence BEFORE any await, even if deletion is blocked. */
export function forgetDevice(): Promise<void> {
  let fenced = false
  try { localStorage.setItem(TRUST_FENCE, crypto.randomUUID()); fenced = true; localStorage.removeItem(TRUST_ACTIVE) } catch { /* IDB deletion can still revoke. */ }
  return transaction('readwrite', store => {
    const get = store.get('current')
    get.onsuccess = () => {
      // Do not delete a newly opted-in row that was saved after this revocation.
      try { if (!fenced || get.result?.fence !== trustFence()) store.delete('current') }
      catch { store.transaction.abort() }
    }
    return get
  }).catch(error => { if (!fenced) throw error /* A durable fence already denies old rows after a crash. */ })
}
