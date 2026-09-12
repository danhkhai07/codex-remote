export type UnreadEntry = { known: string[]; unread: string[]; initialized: boolean; version?: number }
export type UnreadState = Record<string, UnreadEntry>

export function restoreUnread(value: unknown): UnreadState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry &&
    Array.isArray(entry.known) && entry.known.every((id: unknown) => typeof id === 'string') &&
    Array.isArray(entry.unread) && entry.unread.every((id: unknown) => typeof id === 'string') &&
    typeof entry.initialized === 'boolean' && (entry.version === undefined || typeof entry.version === 'number')))
}

export function observeMessages(previous: UnreadEntry | undefined, ids: string[], reading: boolean, version?: number): UnreadEntry {
  const known = new Set(previous?.known)
  const unread = new Set(previous?.unread)
  // A first history scan establishes a baseline. Live messages still count if
  // they arrive while that scan is pending; replayed IDs never count twice.
  const baseline = version !== undefined && !previous?.initialized
  for (const id of ids) {
    if (!known.has(id) && !baseline && !reading) unread.add(id)
    known.add(id)
  }
  return {
    known: [...known], unread: reading ? [] : [...unread],
    initialized: previous?.initialized === true || version !== undefined,
    version: version ?? previous?.version,
  }
}
