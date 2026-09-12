import { useCallback, useState, type SetStateAction } from 'react'
import { useEffect } from 'react'
import { readScreenState, writeScreenState } from './screenState'

/** Async callbacks retain their originating thread, even after navigation. */
export function useThreadState<T>(threadId: string | null, initial: T, storageKey?: string) {
  const [values, setValues] = useState<Record<string, T>>(() => storageKey ? readScreenState(storageKey, {}) : {})
  useEffect(() => { if (storageKey) writeScreenState(storageKey, values) }, [storageKey, values])
  const setForThread = useCallback((id: string | null, action: SetStateAction<T>) => {
    if (!id) return
    setValues(current => {
      const previous = current[id] ?? initial
      const next = typeof action === 'function' ? (action as (value: T) => T)(previous) : action
      return Object.is(previous, next) ? current : { ...current, [id]: next }
    })
  }, [initial])
  const setValue = useCallback((action: SetStateAction<T>) => setForThread(threadId, action), [setForThread, threadId])
  const clear = useCallback(() => setValues({}), [])
  return [threadId ? values[threadId] ?? initial : initial, setValue, setForThread, clear, values, setValues] as const
}
