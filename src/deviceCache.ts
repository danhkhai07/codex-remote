import type { Thread } from './types'
import type { TranscriptItem } from './transcript'

const DATABASE_NAME = 'codex-remote-device-cache'
const DATABASE_VERSION = 1
const STORE_NAME = 'state'
const SNAPSHOT_KEY = 'conversation'
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60_000

export type ConversationSnapshot = {
  version: 1
  savedAt: number
  threads: Thread[]
  selectedId: string | null
  thread: Thread | null
  transcripts: Record<string, TranscriptItem[]>
  activeTurnId: string | null
  lastEventId: number
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!('indexedDB' in globalThis)) return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Unable to open the device cache'))
  })
}

async function readValue(): Promise<unknown> {
  const database = await openDatabase()
  if (!database) return undefined
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(SNAPSHOT_KEY)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Unable to read the device cache'))
    transaction.oncomplete = () => database.close()
  })
}

async function writeValue(value?: ConversationSnapshot): Promise<void> {
  const database = await openDatabase()
  if (!database) return
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    if (value) store.put(value, SNAPSHOT_KEY)
    else store.delete(SNAPSHOT_KEY)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Unable to update the device cache'))
  }).finally(() => database.close())
}

export async function loadConversationSnapshot(): Promise<ConversationSnapshot | null> {
  try {
    const value = await readValue() as Partial<ConversationSnapshot> | undefined
    if (!value || value.version !== 1 || typeof value.savedAt !== 'number' || Date.now() - value.savedAt > MAX_CACHE_AGE_MS) return null
    if (!Array.isArray(value.threads) || (value.selectedId !== null && typeof value.selectedId !== 'string')) return null
    if (typeof value.lastEventId !== 'number' || !Number.isSafeInteger(value.lastEventId) || value.lastEventId < 0) return null
    return value as ConversationSnapshot
  } catch {
    return null
  }
}

export async function saveConversationSnapshot(snapshot: Omit<ConversationSnapshot, 'version' | 'savedAt'>): Promise<void> {
  try {
    const selectedTranscripts = snapshot.selectedId ? snapshot.transcripts[snapshot.selectedId] ?? [] : []
    await writeValue({
      ...snapshot,
      version: 1,
      savedAt: Date.now(),
      threads: snapshot.threads.slice(0, 200),
      transcripts: snapshot.selectedId ? { [snapshot.selectedId]: selectedTranscripts.slice(-800) } : {},
    })
  } catch {
    // Device storage can be unavailable in private mode or under quota pressure.
  }
}

export async function clearConversationSnapshot(): Promise<void> {
  try { await writeValue() } catch { /* Best-effort cache cleanup on logout. */ }
}
