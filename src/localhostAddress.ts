export type LocalhostAddress = { port: number; path: string }

/** Only explicit loopback addresses: the server never receives an arbitrary host. */
export function parseLocalhostAddress(value: string): LocalhostAddress | null {
  const input = value.trim()
  if (!input || [...input].some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || character === '\\')) return null
  const match = /^(?:(?:http:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\]):)?(\d+)([/?#].*)?$/i.exec(input)
  if (!match) return null
  // A port by itself is convenient; a path requires an explicit localhost address.
  if (match[2] && /^\d+[/?#]/.test(input)) return null
  const port = Number(match[1])
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) return null
  try {
    const url = new URL(`http://127.0.0.1:${port}${match[2] || '/'}`)
    return { port, path: `${url.pathname}${url.search}${url.hash}` }
  } catch {
    return null
  }
}

export function isLocalhostUrl(value: string): boolean {
  return /^http:\/\//i.test(value.trim()) && parseLocalhostAddress(value) !== null
}
