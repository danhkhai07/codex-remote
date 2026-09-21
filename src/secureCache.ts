import { CompactEncrypt, compactDecrypt, decodeProtectedHeader } from 'jose'
import { decode64, deriveKey, encode64, jsonBytes, randomId, text, utf8 } from '../server/secure-wire'
import type { ResponseMeta } from '../server/secure-response'
export const SECURE_CACHE_DB = 'codex-remote-cipher-cache-v1'
const LIMIT = 64 * 1024 * 1024, ENTRY_LIMIT = 8 * 1024 * 1024, AGE = 7 * 86400000
const MAX_ENTRIES = 1024, MAX_SCAN = 4096, MAX_PENDING = 16
export type CachedMeta = { path: string; representation: string; response: ResponseMeta; expires: number }
type RecordEntry = { id: string; namespace: string; bytes: number; touched: number; expires: number; meta: string; body: string }
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SECURE_CACHE_DB, 1)
    let expired = false
    const timer = setTimeout(() => { expired = true; reject(Error('Cache unavailable')) }, 1500)
    request.onupgradeneeded = () => { request.result.createObjectStore('entries', { keyPath: 'id' }); request.result.createObjectStore('settings') }
    request.onsuccess = () => { clearTimeout(timer); if (expired) request.result.close(); else resolve(request.result) }
    request.onerror = () => { clearTimeout(timer); reject(Error('Cache unavailable')) }
    request.onblocked = () => { expired = true; clearTimeout(timer); reject(Error('Cache blocked')) }
  })
}
async function transaction<T>(store: string, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database()
  try { return await new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode), request = operation(tx.objectStore(store))
    const timer = setTimeout(() => { try { tx.abort() } catch { /* already closed */ }; reject(Error('Cache timeout')) }, 3000)
    tx.oncomplete = () => { clearTimeout(timer); resolve(request.result) }; tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(Error('Cache unavailable')) }
  }) } finally { db.close() }
}
async function encrypted(key: CryptoKey, namespace: string, id: string, kind: string, bytes: Uint8Array) {
  return new CompactEncrypt(bytes).setProtectedHeader({ alg: 'dir', enc: 'A256GCM', typ: 'codex-cache-v1', ns: namespace, id, kind }).encrypt(key)
}
async function decrypted(key: CryptoKey, namespace: string, id: string, kind: string, value: string) {
  if (typeof value !== 'string' || value.length > ENTRY_LIMIT) throw Error('Invalid cache')
  const h = decodeProtectedHeader(value)
  if (Object.keys(h).sort().join(',') !== 'alg,enc,id,kind,ns,typ' || h.typ !== 'codex-cache-v1' || h.ns !== namespace || h.id !== id || h.kind !== kind) throw Error('Invalid cache')
  const { plaintext } = await compactDecrypt(value, key, { keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'], maxDecompressedLength: 0 })
  return plaintext
}
/** Treat IDB rows as untrusted; never let negative/NaN accounting bypass limits. */
function validEntry(value: unknown): value is RecordEntry {
  const row = value as RecordEntry | undefined
  return Boolean(row && typeof row.id === 'string' && row.id.length <= 256 && typeof row.namespace === 'string'
    && row.id.startsWith(row.namespace + ':') && typeof row.meta === 'string' && typeof row.body === 'string'
    && Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= ENTRY_LIMIT
    && row.bytes === row.meta.length + row.body.length && Number.isFinite(row.touched) && row.touched >= 0
    && Number.isFinite(row.expires) && row.expires >= 0)
}
export class CipherCache {
  #key?: CryptoKey
  #index?: CryptoKey
  #epoch = 0
  #writes: Promise<void> = Promise.resolve()
  #pending = 0
  #pendingBytes = 0
  constructor(readonly namespace: string) {}
  async unlock(owner: CryptoKey) {
    const epoch = ++this.#epoch
    // Atomic get-or-add avoids two tabs racing to install different salts.
    const db = await database()
    let salt: string
    try { salt = await new Promise<string>((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite'), store = tx.objectStore('settings'), r = store.get('salt')
      const timer = setTimeout(() => { try { tx.abort() } catch { /* already closed */ }; reject(Error('Cache timeout')) }, 3000)
      let value: string
      r.onsuccess = () => { try { value = typeof r.result === 'string' ? r.result : randomId(32); if (!r.result) store.put(value, 'salt') } catch { tx.abort(); reject(Error('Cache unavailable')) } }
      tx.oncomplete = () => { clearTimeout(timer); resolve(value) }; tx.onerror = tx.onabort = () => { clearTimeout(timer); reject(Error('Cache unavailable')) }
    }) } finally { db.close() }
    const key = await deriveKey(owner, salt, 'cache-body/' + this.namespace)
    const index = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: decode64(salt), info: utf8.encode('codex-remote/secure/v1/cache-index/' + this.namespace) }, owner, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign'])
    if (epoch !== this.#epoch) return
    this.#key = key; this.#index = index
  }
  lock() { this.#epoch++; this.#key = undefined; this.#index = undefined }
  async identify(path: string, representation: string) {
    if (!this.#index) return randomId()
    return encode64(new Uint8Array(await crypto.subtle.sign('HMAC', this.#index, jsonBytes([path, representation]))))
  }
  async #bodyContext(id: string, revision: string) {
    const index = this.#index
    if (!index) throw Error('Cache locked')
    // JWE protected headers are authenticated but visible. Keep the revision
    // inside encrypted metadata; bind the body using a keyed opaque identifier.
    return encode64(new Uint8Array(await crypto.subtle.sign('HMAC', index, jsonBytes(['cache-body-context', id, revision]))))
  }
  async get(id: string): Promise<{ entry: RecordEntry; meta: CachedMeta } | null> {
    try {
      const key = this.#key, epoch = this.#epoch
      if (!key) return null
      const entry = await transaction<RecordEntry | undefined>('entries', 'readonly', s => s.get(this.namespace + ':' + id))
      if (!validEntry(entry) || entry.id !== this.namespace + ':' + id || entry.namespace !== this.namespace || entry.expires < Date.now()) return null
      const meta = JSON.parse(text.decode(await decrypted(key, this.namespace, id, 'meta', entry.meta))) as CachedMeta
      if (!Number.isFinite(meta.expires) || meta.expires < Date.now() || typeof meta.path !== 'string' || typeof meta.representation !== 'string' || !meta.response?.revision || epoch !== this.#epoch) return null
      return { entry, meta }
    } catch { return null }
  }
  async body(id: string, cached: { entry: RecordEntry; meta: CachedMeta }): Promise<Uint8Array> {
    const key = this.#key, epoch = this.#epoch
    if (!key) throw Error('Cache locked')
    const result = await decrypted(key, this.namespace, await this.#bodyContext(id, cached.meta.response.revision!), 'body', cached.entry.body)
    if (epoch !== this.#epoch) throw Error('Cache locked')
    // Touch only the current row in the same transaction; never resurrect a
    // purged/evicted entry or race logout with an untracked background write.
    if (this.#pending < MAX_PENDING) {
    this.#pending++
    this.#writes = this.#writes.then(async () => {
      if (epoch !== this.#epoch) return
      const db = await database()
      try { await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('entries', 'readwrite'), store = tx.objectStore('entries'), request = store.get(cached.entry.id)
        const timer = setTimeout(() => { try { tx.abort() } catch { /* closed */ }; reject(Error('Cache timeout')) }, 3000)
        request.onsuccess = () => { try { const row = request.result as RecordEntry | undefined; if (epoch === this.#epoch && validEntry(row) && row.body === cached.entry.body) store.put({ ...row, touched: Date.now() }) } catch { tx.abort(); reject(Error('Cache unavailable')) } }
        tx.oncomplete = () => { clearTimeout(timer); resolve() }; tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(Error('Cache unavailable')) }
      }) } finally { db.close() }
    }).catch(() => {}).finally(() => { this.#pending-- })
    }
    return result
  }
  async put(id: string, meta: CachedMeta, body: Uint8Array) {
    const key = this.#key, epoch = this.#epoch
    if (!key || body.length > ENTRY_LIMIT || !meta.response.revision || this.#pending >= MAX_PENDING || this.#pendingBytes + body.length > LIMIT) return
    this.#pending++; this.#pendingBytes += body.length
    const operation = this.#writes.then(async () => {
      if (epoch !== this.#epoch) return
      meta = { ...meta, expires: Date.now() + AGE }
      const bodyContext = await this.#bodyContext(id, meta.response.revision!)
      const [encodedMeta, encodedBody] = await Promise.all([encrypted(key, this.namespace, id, 'meta', jsonBytes(meta)), encrypted(key, this.namespace, bodyContext, 'body', body)])
      const bytes = encodedMeta.length + encodedBody.length
      if (bytes > ENTRY_LIMIT || epoch !== this.#epoch) return
      const db = await database()
      try { await new Promise<void>((resolve, reject) => {
        if (epoch !== this.#epoch) { resolve(); return }
        const tx = db.transaction('entries', 'readwrite'), store = tx.objectStore('entries'), read = store.openCursor()
        const timer = setTimeout(() => { try { tx.abort() } catch { /* closed */ }; reject(Error('Cache timeout')) }, 3000)
        const retained: Array<{ id: string; bytes: number; touched: number }> = []
        let total = 0, scanned = 0
        const next = { id: this.namespace + ':' + id, namespace: this.namespace, bytes, expires: meta.expires, touched: Date.now(), meta: encodedMeta, body: encodedBody } satisfies RecordEntry
        read.onsuccess = () => {
          try {
            if (epoch !== this.#epoch) { tx.abort(); return }
            const cursor = read.result
            if (!cursor) { store.put(next); return }
            // A corrupt database may exceed our row cap. Discard this cache only;
            // no drafts, keys or unrelated browser storage share this store.
            if (++scanned > MAX_SCAN) { store.clear(); store.put(next); return }
            const row: unknown = cursor.value
            if (!validEntry(row) || row.id !== cursor.primaryKey || row.id === next.id || row.expires < Date.now()) cursor.delete()
            else {
              retained.push({ id: row.id, bytes: row.bytes, touched: row.touched }); total += row.bytes
              while (retained.length >= MAX_ENTRIES || total + bytes > LIMIT) {
                let oldest = 0
                for (let i = 1; i < retained.length; i++) if (retained[i].touched < retained[oldest].touched) oldest = i
                const [removed] = retained.splice(oldest, 1); store.delete(removed.id); total -= removed.bytes
              }
            }
            cursor.continue()
          } catch { tx.abort(); reject(Error('Cache write failed')) }
        }
        tx.oncomplete = () => { clearTimeout(timer); resolve() }; tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(Error('Cache write failed')) }
      }) } finally { db.close() }
    }).catch(() => {}).finally(() => { this.#pending--; this.#pendingBytes -= body.length })
    this.#writes = operation; await operation
  }
  async purgeOtherGenerations(assertLive: () => void = () => {}, signal?: AbortSignal) {
    const epoch = this.#epoch
    try {
      const db = await database()
      try { assertLive(); if (epoch !== this.#epoch) return
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('entries', 'readwrite'), store = tx.objectStore('entries')
          const abort = () => { try { tx.abort() } catch { /* closed */ } }
          signal?.addEventListener('abort', abort, { once: true })
          const timer = setTimeout(abort, 3000)
          const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
          const app = this.namespace.split(':')[0] + ':', current = this.namespace + ':'
          // Delete by opaque primary-key ranges, without reading ciphertext rows.
          store.delete(IDBKeyRange.bound(app, current, false, true))
          store.delete(IDBKeyRange.bound(current + '\uffff', app + '\uffff', true, false))
          tx.oncomplete = () => { cleanup(); resolve() }; tx.onabort = tx.onerror = () => { cleanup(); reject(Error('Cache unavailable')) }
        })
      } finally { db.close() }
    } catch { assertLive(); /* Online reads work without cache. */ }
  }
  async purgeApp() {
    this.lock(); await this.#writes
    try {
      const app = this.namespace.split(':')[0] + ':'
      await transaction('entries', 'readwrite', s => s.delete(IDBKeyRange.bound(app, app + '\uffff')))
    } catch { /* Best effort when browser storage is denied. */ }
  }
}
