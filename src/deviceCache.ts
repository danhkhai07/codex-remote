import type { Session, Thread } from './types'
import type { TranscriptItem } from './transcript'
import { compactThreadHistory, isCachedThread, isThreadMetadata } from './threadHistoryCache'
import { jsonBytes, limitConversation, limitItems, MAX_CONVERSATION_BYTES } from '../server/conversation-size'

const DATABASE_NAME = 'codex-remote-device-cache'
const DATABASE_VERSION = 1
const STORE_NAME = 'state'
const SNAPSHOT_KEY = 'conversation'
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60_000
let writes: Promise<void> = Promise.resolve()

export type ConversationSnapshot = {
  version: 1
  savedAt: number
  threads: Thread[]
  selectedId: string | null
  thread: Thread | null
  histories?: Thread[]
  transcripts: Record<string, TranscriptItem[]>
  activeTurnId: string | null
  lastEventId: number
  eventEpoch?: string
  session?: Omit<Session, 'csrf'>
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!('indexedDB' in globalThis)) return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    let expired = false
    const timeout = setTimeout(() => { expired = true; resolve(null) }, 1_500)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => {
      clearTimeout(timeout)
      if (expired) request.result.close()
      else resolve(request.result)
    }
    request.onerror = () => { clearTimeout(timeout); reject(request.error ?? new Error('Unable to open the device cache')) }
  })
}

export async function readDeviceValue(key = SNAPSHOT_KEY): Promise<unknown> {
  await writes
  const database = await openDatabase()
  if (!database) return undefined
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const timer = setTimeout(() => {
      try { transaction.abort() } catch { /* Completion may already be queued. */ }
      reject(new Error('Device cache read timed out'))
    }, 3_000)
    const request = transaction.objectStore(STORE_NAME).get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Unable to read the device cache'))
    transaction.oncomplete = () => { clearTimeout(timer); database.close() }
    transaction.onabort = () => { clearTimeout(timer); database.close(); reject(new Error('Device cache read aborted')) }
  })
}

export function writeDeviceValue(value?: unknown, key = SNAPSHOT_KEY): Promise<void> {
  const operation = writes.then(() => writeValue(value, key))
  writes = operation.catch(() => undefined)
  return operation
}

async function writeValue(value: unknown, key: string): Promise<void> {
  const database = await openDatabase()
  if (!database) return
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const timer = setTimeout(() => {
      try { transaction.abort() } catch { /* Completion may already be queued. */ }
      reject(new Error('Device cache write timed out'))
    }, 3_000)
    const store = transaction.objectStore(STORE_NAME)
    if (value !== undefined) store.put(value, key)
    else store.delete(key)
    transaction.oncomplete = () => { clearTimeout(timer); resolve() }
    transaction.onerror = () => { clearTimeout(timer); reject(transaction.error ?? new Error('Unable to update the device cache')) }
    transaction.onabort = () => { clearTimeout(timer); reject(transaction.error ?? new Error('Device cache write aborted')) }
  }).finally(() => database.close())
}

export async function loadConversationSnapshot(): Promise<ConversationSnapshot | null> {
  try {
    const value = await readDeviceValue() as Partial<ConversationSnapshot> | undefined
    if (!value || value.version !== 1 || typeof value.savedAt !== 'number' || Date.now() - value.savedAt > MAX_CACHE_AGE_MS) return null
    if (!Array.isArray(value.threads) || (value.selectedId !== null && typeof value.selectedId !== 'string')) return null
    value.threads = value.threads.filter(isThreadMetadata)
    if (typeof value.lastEventId !== 'number' || !Number.isSafeInteger(value.lastEventId) || value.lastEventId < 0) return null
    if (value.thread !== null && !isCachedThread(value.thread)) return null
    if (!value.transcripts || typeof value.transcripts !== 'object' || Array.isArray(value.transcripts)) return null
    if (!Object.values(value.transcripts).every(items => Array.isArray(items) && items.every(item => item && typeof item.turnId === 'string'))) return null
    if (value.thread) value.thread = limitConversation(value.thread, MAX_CONVERSATION_BYTES - 64)
    if (Array.isArray(value.histories)) value.histories = value.histories.filter(isCachedThread).slice(-8).map(compactThreadHistory)
    for (const [id, items] of Object.entries(value.transcripts)) {
      const history = value.thread?.id === id ? value.thread : value.histories?.find(thread => thread.id === id)
      value.transcripts[id] = limitItems(items, Math.max(2, MAX_CONVERSATION_BYTES - jsonBytes(history ?? null) - 32)).items
    }
    return value as ConversationSnapshot
  } catch {
    return null
  }
}

export async function saveConversationSnapshot(snapshot: Omit<ConversationSnapshot, 'version' | 'savedAt'>): Promise<void> {
  try {
    const selectedTranscripts = snapshot.selectedId ? snapshot.transcripts[snapshot.selectedId] ?? [] : []
    const thread = snapshot.thread ? limitConversation(snapshot.thread, MAX_CONVERSATION_BYTES - 64) : null
    const boundedTranscript = limitItems(selectedTranscripts, Math.max(2, MAX_CONVERSATION_BYTES - jsonBytes(thread) - 32)).items
    await writeDeviceValue({
      ...snapshot,
      version: 1,
      savedAt: Date.now(),
      threads: snapshot.threads.slice(0, 200).map(({ turns: _turns, ...metadata }) => metadata),
      thread,
      histories: snapshot.histories?.slice(-8).map(history => history.id === thread?.id ? thread : compactThreadHistory(history)),
      transcripts: snapshot.selectedId ? { [snapshot.selectedId]: boundedTranscript } : {},
    })
  } catch {
    // Device storage can be unavailable in private mode or under quota pressure.
  }
}

export async function clearConversationSnapshot(): Promise<void> {
  try { await Promise.all([writeDeviceValue(), writeDeviceValue(undefined, 'draft-images')]) } catch { /* Best-effort cache cleanup on logout. */ }
}
