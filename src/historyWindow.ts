import type { Thread, ThreadItem, Turn } from './types'

/** Keep a bounded historical window. The current/pending turn remains in its
 * separate SSE state; fetching old history never changes native/model context. */
export function prependHistory(current: Thread, older: Thread): Thread {
  if (current.id !== older.id || !older.historyWindow) return current
  if (current.historyWindow?.generation && current.historyWindow.generation !== older.historyWindow.generation) return { ...current, historyWindow: { ...current.historyWindow, older: null, invalidated: true } }
  const turns: Turn[] = [], seen = new Set<string>()
  let count = 0
  for (const turn of [...(older.turns ?? []), ...(current.turns ?? [])]) {
    const items: ThreadItem[] = []
    for (const item of turn.items) {
      const id = `${turn.id}:${item.id}`
      if (seen.has(id) || count >= 240) continue
      seen.add(id); items.push(item); count++
    }
    if (!items.length) continue
    const previous = turns.at(-1)
    if (previous?.id === turn.id) previous.items.push(...items)
    else turns.push({ ...turn, items })
  }
  return { ...current, turns, historyWindow: { ...older.historyWindow, browsingOlder: true } }
}

/** A rewrite invalidates old cursors, but must not move someone reading history. */
export function refreshHistoryWindow(current: Thread, incoming: Thread, paused = false): Thread {
  if (current.id !== incoming.id) return current
  if (paused && current.historyWindow && !current.historyWindow.browsingOlder) current = { ...current, historyWindow: { ...current.historyWindow, browsingOlder: true } }
  if (!current.historyWindow?.browsingOlder) return incoming
  if (current.historyWindow.generation && incoming.historyWindow?.generation !== current.historyWindow.generation) {
    return { ...current, historyWindow: { ...current.historyWindow, older: null, invalidated: true } }
  }
  return current
}
