import { isPreviewImage } from './attachmentFiles'
import { useEffect, useState, type MutableRefObject } from 'react'
import { readDeviceValue, writeDeviceValue } from './deviceCache'
import { useThreadState } from './useThreadState'

export type ComposerImage = { key: string; file: File; previewUrl: string }
const EMPTY: ComposerImage[] = []
type SavedImages = { savedAt: number; threads: Record<string, Array<{ key: string; file: File }>> }

export function useDraftImages(threadId: string | null, urls: MutableRefObject<Set<string>>) {
  const [images, setImages, , clear, values, restore] = useThreadState(threadId, EMPTY)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    void readDeviceValue('draft-images').then(raw => {
      if (cancelled) return
      const saved = raw as SavedImages | undefined
      if (!saved || Date.now() - saved.savedAt > 7 * 24 * 60 * 60_000 || !saved.threads) return
      const restored: Record<string, ComposerImage[]> = {}
      for (const [id, entries] of Object.entries(saved.threads)) {
        if (!Array.isArray(entries)) continue
        restored[id] = entries.filter(entry => entry.file instanceof File).map(entry => {
          const previewUrl = isPreviewImage(entry.file) ? URL.createObjectURL(entry.file) : ''
          if (previewUrl) urls.current.add(previewUrl)
          return { ...entry, previewUrl }
        })
      }
      restore(restored)
    }).catch(() => undefined).finally(() => { if (!cancelled) setReady(true) })
    return () => { cancelled = true }
  }, [restore, urls])

  useEffect(() => {
    if (!ready) return
    const threads = Object.fromEntries(Object.entries(values).filter(([, entries]) => entries.length)
      .map(([id, entries]) => [id, entries.map(({ key, file }) => ({ key, file }))]))
    void writeDeviceValue({ savedAt: Date.now(), threads }, 'draft-images').catch(() => undefined)
  }, [ready, values])
  return [images, setImages, clear, ready] as const
}
