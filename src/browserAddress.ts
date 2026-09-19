import { parseLocalhostAddress, type LocalhostAddress } from './localhostAddress'

export type BrowserAddress = { kind: 'localhost'; local: LocalhostAddress } | { kind: 'web'; url: string }
export function parseBrowserAddress(value: string, origin: string): BrowserAddress | null {
  const input = value.trim()
  if (!input || [...input].some(character => character.charCodeAt(0) <= 32 || character === '\\')) return null
  const local = parseLocalhostAddress(input)
  if (local) return { kind: 'localhost', local }
  if (!/^https?:\/\//i.test(input) && !(input.startsWith('/') && !input.startsWith('//'))) return null
  try {
    const url = new URL(input, origin)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    return { kind: 'web', url: url.href }
  } catch { return null }
}
