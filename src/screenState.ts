import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'

const KEY = 'codex-remote:screen:v1'
const MAX_AGE = 7 * 24 * 60 * 60_000
type Entry = { at: number; value: unknown }
let values: Record<string, Entry> | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let listening = false

function state() {
  if (!values) {
    try { values = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, Entry> }
    catch { values = {} }
    if (!values || typeof values !== 'object' || Array.isArray(values)) values = {}
  }
  if (!listening && typeof window !== 'undefined') {
    listening = true
    window.addEventListener('pagehide', flushScreenState)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushScreenState()
    })
  }
  return values
}

export function validScreenValue(key: string, value: unknown): boolean {
  if (key.startsWith('pptx:') && key.endsWith(':page')) return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
  if (key.startsWith('pptx:') && key.endsWith(':zoom')) return typeof value === 'number' && Number.isFinite(value) && value >= 0.5 && value <= 3
  const record = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  if (key === 'draft-skills') return Boolean(record && Object.values(record).every(value => Array.isArray(value) && value.length <= 20 && value.every(skill => skill && typeof skill.name === 'string' && typeof skill.path === 'string')))
  if (key === 'drafts') return Boolean(record && Object.values(record).every(text => typeof text === 'string'))
  if (key === 'file-viewer') return value === null || Boolean(record && typeof record.path === 'string' && record.path.startsWith('/'))
  if (key === 'link-viewer') return value === null || Boolean(record && typeof record.url === 'string')
  if (['file-browser', 'model', 'effort'].includes(key)) return value === null || typeof value === 'string'
  if (key === 'drawer' || key.endsWith(':metadata') || key.endsWith(':hidden')) return typeof value === 'boolean'
  if (key === 'command-notice') return value === null || Boolean(record && typeof record.title === 'string' && Array.isArray(record.lines) && record.lines.every(line => line && typeof line.label === 'string' && typeof line.value === 'string'))
  if (key.startsWith('reading:')) return Boolean(record && typeof record.top === 'number' && Number.isFinite(record.top) && typeof record.following === 'boolean')
  if (key.includes(':scroll')) return Boolean(record && ['top', 'left'].every(field => typeof record[field] === 'number' && Number.isFinite(record[field])))
  if (key.endsWith(':zoom')) return value === 'fit' || (typeof value === 'number' && Number.isFinite(value) && value >= 0.2 && value <= 2)
  if (key.endsWith(':offset')) return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  if (key.endsWith(':mode')) return value === 'preview' || value === 'raw'
  if (key.startsWith('browser:')) return typeof value === 'string'
  return true
}

export function readScreenState<T>(key: string, fallback: T): T {
  const entry = state()[key]
  if (!entry || typeof entry.at !== 'number' || Date.now() - entry.at > MAX_AGE) return fallback
  if (!validScreenValue(key, entry.value)) { delete state()[key]; return fallback }
  return entry.value as T
}

export function writeScreenState(key: string, value: unknown) {
  state()[key] = { at: Date.now(), value }
  // Small metadata only: no file bytes, credentials, or raw event history.
  if (timer === undefined) timer = setTimeout(flushScreenState, 200)
}

export function flushScreenState() {
  clearTimeout(timer)
  timer = undefined
  if (!values) return
  values = Object.fromEntries(Object.entries(values)
    .filter(([, entry]) => entry && Date.now() - entry.at <= MAX_AGE)
    .sort((a, b) => b[1].at - a[1].at).slice(0, 200))
  try { localStorage.setItem(KEY, JSON.stringify(values)) } catch { /* Storage may be full or disabled. */ }
}

export function clearScreenState() {
  clearTimeout(timer)
  timer = undefined
  values = {}
  try { localStorage.removeItem(KEY) } catch { /* Best effort on logout. */ }
}

export function useScreenState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readScreenState(key, fallback))
  useEffect(() => { writeScreenState(key, value) }, [key, value])
  return [value, setValue] as const
}

export function useRestoredScroll(ref: RefObject<HTMLElement | null>, key: string, ready: boolean) {
  useLayoutEffect(() => {
    const element = ref.current
    if (!ready || !element) return
    const saved = readScreenState(key, { top: 0, left: 0 })
    element.scrollTop = saved.top
    element.scrollLeft = saved.left
    const save = () => writeScreenState(key, { top: element.scrollTop, left: element.scrollLeft })
    element.addEventListener('scroll', save, { passive: true })
    return () => { element.removeEventListener('scroll', save) }
  }, [ref, key, ready])
}
