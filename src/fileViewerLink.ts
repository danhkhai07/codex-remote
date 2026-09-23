import type { LocalFileReference } from './MarkdownMessage'

/** Bookmark/new-tab URL contains a path, never credentials or decrypted content. */
export function fileViewerUrl(reference: LocalFileReference): string {
  const query = new URLSearchParams({ path: reference.path })
  if (reference.line) query.set('line', String(reference.line))
  return `/files?${query}`
}
export function fileViewerReference(href: string): LocalFileReference | null {
  try {
    const url = new URL(href, 'https://app.invalid')
    if (url.origin !== 'https://app.invalid' || !['/files', '/files/'].includes(url.pathname)) return null
    const path = url.searchParams.get('path')
    if (!path?.startsWith('/') || path.includes('\0') || path.length > 4096) return null
    const line = Number(url.searchParams.get('line'))
    return { path, ...(Number.isSafeInteger(line) && line > 0 ? { line } : {}) }
  } catch { return null }
}
export function regularLinkClick(event: { button: number; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
}
