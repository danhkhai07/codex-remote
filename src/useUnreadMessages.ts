import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { readScreenState, writeScreenState } from './screenState'
import { observeMessages, restoreUnread, type UnreadState } from './unread'
import type { Thread } from './types'

export function useUnreadMessages(threads: Thread[], readingId: string | null, enabled: boolean) {
  const [state, setState] = useState(() => restoreUnread(readScreenState('unread-completed-replies', {})))
  const current = useRef(state)
  const reading = useRef(readingId)
  reading.current = readingId
  const update = useCallback((next: UnreadState) => {
    current.current = next
    writeScreenState('unread-completed-replies', next)
    setState(next)
  }, [])
  const observe = useCallback((id: string, ids: string[], version?: number) => {
    update({ ...current.current, [id]: observeMessages(current.current[id], ids, reading.current === id, version) })
  }, [update])
  useEffect(() => {
    if (readingId && current.current[readingId]?.unread.length) observe(readingId, [])
  }, [readingId, observe])

  // Poll only changed histories, one at a time, returning IDs rather than
  // downloading transcripts. Persisted baselines recover missed background events.
  const signature = JSON.stringify(threads.map(({ id, updatedAt }) => ({ id, updatedAt })))
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const targets = JSON.parse(signature) as Array<{ id: string; updatedAt: number }>
    void (async () => {
      for (const target of targets) {
        if (controller.signal.aborted) return
        if (current.current[target.id]?.version === target.updatedAt) continue
        try {
          const result = await api.messageIds(target.id, AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]))
          if (!controller.signal.aborted) observe(target.id, result.ids, target.updatedAt)
        } catch { /* Retry on the next list refresh; keep the existing badge. */ }
      }
    })()
    return () => controller.abort()
  }, [enabled, signature, threads, observe])

  const clear = useCallback(() => update({}), [update])
  const counts = Object.fromEntries(Object.entries(state).map(([id, value]) => [id, value.unread.length]))
  return { counts, observe, clear }
}
