import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'

type StopState = { turnId: string; phase: 'stopping' | 'error'; message: string }

export function turnHasEnded(thread: { historyUnavailable?: boolean; latestTurn?: { id: string; status: string }; turns?: Array<{ id: string; status: string }> }, turnId: string) {
  if (thread.historyUnavailable) return false
  const turn = thread.latestTurn?.id === turnId ? thread.latestTurn : thread.turns?.find(turn => turn.id === turnId)
  return Boolean(turn && ['completed', 'interrupted', 'failed'].includes(turn.status))
}

export function useInterrupt(csrf: string | undefined, onConfirmed: (threadId: string, turnId: string) => void) {
  const [states, setStates] = useState<Record<string, StopState>>({})
  const operations = useRef(new Map<string, { turnId: string; abort: AbortController }>())
  const confirm = useCallback((threadId: string, turnId: string) => {
    const operation = operations.current.get(threadId)
    if (operation?.turnId === turnId) {
      operation.abort.abort()
      operations.current.delete(threadId)
    }
    setStates(current => {
      if (current[threadId]?.turnId !== turnId) return current
      const next = { ...current }; delete next[threadId]; return next
    })
    onConfirmed(threadId, turnId)
  }, [onConfirmed])

  useEffect(() => () => {
    for (const operation of operations.current.values()) operation.abort.abort()
    operations.current.clear()
  }, [csrf])

  const stop = useCallback(async (threadId: string, turnId: string) => {
    if (!csrf || operations.current.has(threadId)) return
    const abort = new AbortController()
    operations.current.set(threadId, { turnId, abort })
    setStates(current => ({ ...current, [threadId]: { turnId, phase: 'stopping', message: 'Stopping Codex…' } }))
    let requestError = ''
    // Sending the command is not proof that the process has stopped. Poll in
    // parallel so a lost RPC acknowledgement or SSE cannot leave Stop stuck.
    void api.interrupt(threadId, turnId, csrf, AbortSignal.any([abort.signal, AbortSignal.timeout(12_000)]))
      .catch(error => { requestError = error instanceof Error ? error.message : 'Stop request failed' })
    const deadline = Date.now() + 20_000
    try {
      while (!abort.signal.aborted && Date.now() < deadline) {
        try {
          const response = await api.thread(threadId, AbortSignal.any([abort.signal, AbortSignal.timeout(4_000)]))
          if (abort.signal.aborted) return
          if (turnHasEnded(response.thread, turnId)) { confirm(threadId, turnId); return }
        } catch { /* Preserve the screen while offline; bounded retries below. */ }
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); abort.signal.removeEventListener('abort', done); resolve() }
          const timer = setTimeout(done, 1_000)
          abort.signal.addEventListener('abort', done, { once: true })
          if (abort.signal.aborted) done()
        })
      }
      if (!abort.signal.aborted) setStates(current => ({ ...current, [threadId]: {
        turnId, phase: 'error', message: requestError
          ? 'Could not confirm stop. Check your connection and retry.'
          : 'Codex has not confirmed stopping yet. You can retry.',
      } }))
    } finally {
      if (operations.current.get(threadId)?.abort === abort) operations.current.delete(threadId)
      abort.abort()
    }
  }, [csrf, confirm])
  return { states, stop, confirm }
}
