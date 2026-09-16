import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModelOption } from './types'
import { readScreenState, writeScreenState } from './screenState'

export const CONVERSATION_SETTINGS_KEY = 'codex-remote:conversation-settings:v1'
export type ConversationSettings = { model: string; effort: string | null }
type Settings = Record<string, ConversationSettings>

export function parseConversationSettings(raw: string | null): Settings {
  try {
    const value: unknown = JSON.parse(raw ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([id, entry]) => id && entry &&
      typeof entry.model === 'string' && entry.model.length > 0 &&
      (entry.effort === null || (typeof entry.effort === 'string' && entry.effort.length > 0))))
  } catch { return {} }
}

function readSettings(): Settings {
  try { return parseConversationSettings(localStorage.getItem(CONVERSATION_SETTINGS_KEY)) } catch { return {} }
}

export function settingsForModel(model: ModelOption, effort: string | null): ConversationSettings {
  return { model: model.model, effort: model.supportedReasoningEfforts?.some(option => option.reasoningEffort === effort)
    ? effort : model.defaultReasoningEffort ?? null }
}

export function useConversationSettings(threadId: string | null) {
  const [values, setValues] = useState(readSettings)
  const current = useRef(values)
  const [saveError, setSaveError] = useState('')
  const save = useCallback((id: string, value: ConversationSettings) => {
    // Merge the latest device copy so changing one conversation cannot erase another tab's choices.
    const next = { ...current.current, ...readSettings(), [id]: value }
    current.current = next
    setValues(next)
    try { localStorage.setItem(CONVERSATION_SETTINGS_KEY, JSON.stringify(next)); setSaveError('') }
    catch { setSaveError('Model/effort chỉ được giữ trong phiên này vì trình duyệt không lưu được lựa chọn.') }
  }, [])
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== CONVERSATION_SETTINGS_KEY && event.key !== null) return
      current.current = readSettings()
      setValues(current.current)
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  const update = useCallback((value: ConversationSettings) => { if (threadId) save(threadId, value) }, [threadId, save])
  const migrateLegacy = useCallback((id: string | null, fallbackModel?: string | null) => {
    if (!id) return
    const model = readScreenState<string | null>('model', null) ?? fallbackModel
    const effort = readScreenState<string | null>('effort', null)
    if (!current.current[id] && model && (effort || readScreenState('model', null))) save(id, { model, effort })
    writeScreenState('model', null)
    writeScreenState('effort', null)
  }, [save])
  return { settings: threadId ? values[threadId] : undefined, update, migrateLegacy, saveError }
}
