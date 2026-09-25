import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import type { ReplySnapshot } from '../server/read-state'
import type { Thread } from './types'

const empty = (): ReplySnapshot => ({ revision: -1, unread: {} })

export function useUnreadMessages(threads: Thread[], readingId: string | null, enabled: boolean, csrf?: string, visibleReplyIds: string[] = []) {
  const [state, setState] = useState(empty)
  const current = useRef(state)
  const access = useRef({ enabled, csrf, readingId, visibleReplyIds })
  access.current = { enabled, csrf, readingId, visibleReplyIds }
  const generation = useRef(0)
  const acknowledging = useRef(new Set<string>())
  const apply = useCallback((next: ReplySnapshot) => {
    if (next.revision < current.current.revision) return
    current.current = next
    setState(next)
  }, [])
  const refresh = useCallback(async () => {
    if (!access.current.enabled) return
    const epoch = generation.current
    try {
      const next = await api.readState()
      if (epoch === generation.current && access.current.enabled) apply(next)
    } catch { /* Retain the current badges and retry on reconnect/poll. */ }
  }, [apply])
  // Lightweight server snapshot keeps read receipts synchronized even if SSE was missed.
  useEffect(() => {
    generation.current++
    if (!enabled) return
    void refresh()
    const timer = setInterval(() => void refresh(), 10_000)
    return () => { generation.current++; clearInterval(timer) }
  }, [enabled, csrf, refresh])

  const signature = JSON.stringify(threads.map(({ id, updatedAt, status }) => ({ id, updatedAt, status })))
  const versions = useRef(new Map<string, string>())
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const targets = JSON.parse(signature) as Array<{ id: string; updatedAt: number; status: unknown }>
    void (async () => {
      for (const target of targets) {
        if (controller.signal.aborted) return
        const version = JSON.stringify(target)
        if (versions.current.get(target.id) === version) continue
        try {
          let before: string | undefined
          do {
            const result = await api.messageIds(target.id, AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]), before)
            if (controller.signal.aborted) return
            if (result.nextCursor && result.nextCursor === before) throw Error('Read cursor did not advance')
            before = result.nextCursor ?? undefined
            await refresh()
          } while (before)
          if (controller.signal.aborted) return
          versions.current.set(target.id, version)
          await refresh()
        } catch { /* Leave version unrecorded so later refreshes can retry. */ }
      }
    })()
    return () => controller.abort()
  }, [enabled, signature, threads, refresh])

  const visibleSignature = JSON.stringify(visibleReplyIds)
  useEffect(() => {
    if (!enabled || !csrf || !readingId) return
    const visible = new Set<string>(JSON.parse(visibleSignature))
    // A cached/hidden conversation must not acknowledge an answer it has not rendered.
    const ids = (state.unread[readingId] ?? []).filter(id => visible.has(id)).slice(0, 1000)
    if (!ids.length) return
    const key = JSON.stringify([readingId, ids])
    if (acknowledging.current.has(key)) return
    acknowledging.current.add(key)
    const epoch = generation.current
    void api.acknowledgeReplies(readingId, ids, csrf, AbortSignal.timeout(15_000)).then(next => {
      if (epoch === generation.current && access.current.enabled) apply(next)
    }).catch(() => { /* A failed receipt remains unread; polling will retry. */ })
      .finally(() => acknowledging.current.delete(key))
  }, [enabled, csrf, readingId, visibleSignature, state, apply])

  const clear = useCallback(() => {
    generation.current++
    versions.current.clear()
    current.current = empty()
    setState(current.current)
  }, [])
  const counts = Object.fromEntries(Object.entries(state.unread).map(([id, ids]) => [id, ids.length]))
  return { counts, refresh, clear }
}
