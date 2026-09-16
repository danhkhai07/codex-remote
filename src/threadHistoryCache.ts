import type { Thread } from './types'
import { limitConversation } from '../server/conversation-size'

export const HISTORY_CACHE_LIMIT = 15

export function isThreadMetadata(value: unknown): value is Thread {
  if (!value || typeof value !== 'object') return false
  const thread = value as Thread
  return typeof thread.id === 'string' && typeof thread.cwd === 'string' &&
    (thread.name == null || typeof thread.name === 'string') &&
    (thread.preview == null || typeof thread.preview === 'string')
}

export function isCachedThread(value: unknown): value is Thread {
  if (!isThreadMetadata(value)) return false
  return Array.isArray(value.turns) && value.turns.every(turn => turn && typeof turn.id === 'string' &&
      typeof turn.status === 'string' && Array.isArray(turn.items) && turn.items.every(item => item && typeof item === 'object' && !Array.isArray(item)))
}

export function compactThreadHistory(thread: Thread): Thread {
  return limitConversation(thread)
}

export class ThreadHistoryCache {
  private entries = new Map<string, Thread>()
  private compacted = new WeakMap<Thread, Thread>()

  get(id: string): Thread | undefined {
    const value = this.entries.get(id)
    if (value) { this.entries.delete(id); this.entries.set(id, value) }
    return value
  }

  remember(thread: Thread): void {
    const previous = this.entries.get(thread.id)
    // A transient metadata-only response must not erase already visible messages.
    let value = thread.historyUnavailable && previous
      ? { ...previous, ...thread, turns: previous.turns, historyCacheTruncated: previous.historyCacheTruncated }
      : previous?.turns === thread.turns ? thread : this.compacted.get(thread)
    if (!value) {
      value = compactThreadHistory(thread)
      this.compacted.set(thread, value)
    } else value = compactThreadHistory(value)
    this.entries.delete(thread.id)
    this.entries.set(thread.id, value)
    while (this.entries.size > HISTORY_CACHE_LIMIT) this.entries.delete(this.entries.keys().next().value!)
  }

  restore(threads: unknown): void {
    if (!Array.isArray(threads)) return
    for (const thread of threads.slice(-HISTORY_CACHE_LIMIT)) if (isCachedThread(thread)) this.remember(thread)
  }

  snapshot(): Thread[] { return [...this.entries.values()] }
  delete(id: string): void { this.entries.delete(id) }
  clear(): void { this.entries.clear(); this.compacted = new WeakMap() }
}
