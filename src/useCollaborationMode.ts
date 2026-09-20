import { useCallback, useEffect, useRef, useState } from 'react'

export type CollaborationMode = 'default' | 'plan'
export const MODE_STORAGE_KEY = 'codex-remote:collaboration-modes:v1'
export function parseModes(raw: string | null): Record<string, CollaborationMode> {
  try {
    const value: unknown = JSON.parse(raw ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([id, mode]) => id && (mode === 'plan' || mode === 'default')))
  } catch { return {} }
}
function readModes() {
  try { return parseModes(localStorage.getItem(MODE_STORAGE_KEY)) } catch { return {} }
}
export function useCollaborationMode(threadId: string | null) {
  const [values, setValues] = useState(readModes)
  const current = useRef(values)
  const [saveError, setSaveError] = useState('')
  const saveForThread = useCallback((id: string, mode: CollaborationMode) => {
    const next = { ...current.current, ...readModes(), [id]: mode }
    current.current = next
    setValues(next)
    try { localStorage.setItem(MODE_STORAGE_KEY, JSON.stringify(next)); setSaveError('') }
    catch { setSaveError('Chế độ chỉ được giữ trong phiên này vì trình duyệt không lưu được lựa chọn.') }
  }, [])
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== MODE_STORAGE_KEY && event.key !== null) return
      current.current = readModes(); setValues(current.current)
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  const setMode = useCallback((mode: CollaborationMode) => { if (threadId) saveForThread(threadId, mode) }, [threadId, saveForThread])
  return { mode: threadId ? values[threadId] ?? 'default' : 'default', setMode, saveForThread, saveError }
}
