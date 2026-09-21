import { useSyncExternalStore } from 'react'

export type PinnedFile = { path: string; kind: 'file' | 'directory' }
const KEY = 'codex-remote:pinned-files:v1'
const listeners = new Set<() => void>()
let snapshot: { pins: PinnedFile[]; storageError: boolean } | undefined

export function parsePinnedFiles(raw: string | null): PinnedFile[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]')
    if (!Array.isArray(value)) return []
    const seen = new Set<string>()
    return value.filter((entry): entry is PinnedFile => {
      if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string' ||
        !entry.path.startsWith('/') || entry.path.length > 4096 ||
        !['file', 'directory'].includes(entry.kind) || seen.has(entry.path)) return false
      seen.add(entry.path)
      return true
    }).map(({ path, kind }) => ({ path, kind }))
  } catch { return [] }
}

function getSnapshot() {
  if (!snapshot) {
    try { snapshot = { pins: parsePinnedFiles(localStorage.getItem(KEY)), storageError: false } }
    catch { snapshot = { pins: [], storageError: true } }
  }
  return snapshot
}

function onStorage(event: StorageEvent) {
  if (event.key !== KEY && event.key !== null) return
  snapshot = undefined
  listeners.forEach(listener => listener())
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener('storage', onStorage)
  listeners.add(listener)
  // Pick up changes made in another tab while no file view was mounted.
  if (!snapshot?.storageError) snapshot = undefined
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('storage', onStorage)
  }
}

export function togglePinnedFile(pin: PinnedFile) {
  const current = getSnapshot().pins
  const pins = current.some(entry => entry.path === pin.path)
    ? current.filter(entry => entry.path !== pin.path) : [...current, pin]
  let storageError = false
  try { localStorage.setItem(KEY, JSON.stringify(pins)) } catch { storageError = true }
  snapshot = { pins, storageError }
  listeners.forEach(listener => listener())
}

export function forgetPinnedFilesMemory() { snapshot = undefined }

export function usePinnedFiles() {
  return { ...useSyncExternalStore(subscribe, getSnapshot, getSnapshot), togglePin: togglePinnedFile }
}
