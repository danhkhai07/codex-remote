import { useEffect, useState } from 'react'

export const YOLO_PREFERENCE_KEY = 'codex-remote:yolo'

export function readYoloPreference(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(YOLO_PREFERENCE_KEY) === 'enabled'
}

function savedPreference(): boolean {
  try { return readYoloPreference(localStorage) } catch { return false }
}

export function useYoloPreference() {
  const [enabled, setEnabled] = useState(savedPreference)
  const [saveError, setSaveError] = useState('')
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === YOLO_PREFERENCE_KEY || event.key === null) setEnabled(savedPreference())
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  function update(value: boolean) {
    setEnabled(value)
    try {
      localStorage.setItem(YOLO_PREFERENCE_KEY, value ? 'enabled' : 'disabled')
      setSaveError('')
    } catch {
      setSaveError('YOLO changed for now, but this browser could not save the preference for next time.')
    }
  }
  return [enabled, update, saveError] as const
}
