/** Serialized UTF-8 JSON, not UTF-16 character count. Original rollouts are untouched. */
export const MAX_CONVERSATION_BYTES = 5_000_000
const encoder = new TextEncoder()
const sizes = new WeakMap<object, number>()

export function jsonBytes(value: unknown): number {
  if (value && typeof value === 'object') {
    const known = sizes.get(value)
    if (known !== undefined) return known
    const bytes = encoder.encode(JSON.stringify(value)).length
    sizes.set(value, bytes)
    return bytes
  }
  return encoder.encode(JSON.stringify(value) ?? 'null').length
}

// Keep recent array entries and string suffixes, never a sliced/invalid JSON document. A single huge
// string is shortened too, so one large tool result cannot consume unlimited space.
function jsonRecent(value: unknown, budget: number): unknown {
  if (jsonBytes(value) <= budget) return value
  if (typeof value === 'string') {
    // Count JSON-escaped UTF-8 in one pass, avoiding repeated multi-MB
    // stringify/encode allocations when a streamed tool result hits the cap.
    let remaining = budget - 5 // Two quotes and the three-byte ellipsis.
    if (remaining < 0) return ''
    let start = value.length
    while (start > 0) {
      const code = value.charCodeAt(start - 1)
      let width = 1
      let cost = code < 0x80 ? 1 : code < 0x800 ? 2 : 3
      if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) cost = 2
      else if (code < 32) cost = 6
      else if (code >= 0xd800 && code <= 0xdfff) {
        const previous = value.charCodeAt(start - 2)
        if (code >= 0xdc00 && previous >= 0xd800 && previous <= 0xdbff) { cost = 4; width = 2 }
        else cost = 6 // JSON.stringify escapes lone surrogates.
      }
      if (cost > remaining) break
      remaining -= cost
      start -= width
    }
    return '…' + value.slice(start)
  }
  if (Array.isArray(value)) return limitItems(value, budget).items
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    let remaining = budget - 2
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue
      const overhead = jsonBytes(key) + 1 + (Object.keys(result).length ? 1 : 0)
      if (remaining - overhead < 4) break
      const clipped = jsonRecent(item, remaining - overhead)
      result[key] = clipped
      remaining -= overhead + jsonBytes(clipped)
      if (clipped !== item) break
    }
    return result
  }
  return null
}

export function limitItems<T>(items: T[], budget = MAX_CONVERSATION_BYTES): { items: T[]; truncated: boolean } {
  // Reserve space for a truncation marker even when the next item will not fit.
  let remaining = Math.max(2, budget - 64) - 2
  const kept: T[] = []
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    const cost = jsonBytes(item) + (kept.length ? 1 : 0)
    if (cost <= remaining) { kept.push(item); remaining -= cost; continue }
    const room = remaining - (kept.length ? 1 : 0)
    if (room >= 256) {
      // Keep routing/render identifiers before potentially huge item fields.
      const ordered = item && typeof item === 'object' && !Array.isArray(item)
        ? { historyItemTruncated: true, id: (item as Record<string, unknown>).id, type: (item as Record<string, unknown>).type,
          turnId: (item as Record<string, unknown>).turnId, ...item } : item
      kept.push(jsonRecent(ordered, room) as T)
    } else if (kept.length) {
      const last = kept.at(-1)
      if (last && typeof last === 'object' && !Array.isArray(last)) kept[kept.length - 1] = { ...last, historyItemTruncated: true }
    }
    return { items: kept.reverse(), truncated: true }
  }
  return { items, truncated: false }
}

type History = {
  turns?: Array<{ id: string; status: string; items?: unknown[] }>
  historyCacheTruncated?: boolean
  historyTruncation?: 'head' | 'tail'
  latestTurn?: { id: string; status: string }
}

export function limitConversation<T extends History>(thread: T, budget = MAX_CONVERSATION_BYTES): T {
  if (jsonBytes(thread) <= budget) return thread
  const latest = thread.turns?.at(-1)
  const latestTurn = thread.latestTurn ?? (latest ? { id: latest.id, status: latest.status } : undefined)
  let result = { ...thread, turns: [] as NonNullable<T['turns']>, historyCacheTruncated: true, historyTruncation: 'head' as const, latestTurn }
  if (jsonBytes(result) > budget) {
    // Oversized metadata must not defeat the cap. Put control fields first.
    const { turns: _turns, latestTurn: _latest, historyCacheTruncated: _truncated, historyTruncation: _side, ...metadata } = thread
    const fields = metadata as Record<string, unknown>
    result = jsonRecent({ id: fields.id, cwd: fields.cwd, latestTurn, historyCacheTruncated: true, historyTruncation: 'head', turns: [], ...metadata }, budget) as typeof result
    return result as T
  }
  let remaining = budget - jsonBytes(result)
  const turns = thread.turns ?? []
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index]
    const metadata = { ...turn, items: [] }
    const overhead = jsonBytes(metadata) + (result.turns.length ? 1 : 0)
    if (overhead > remaining) break
    const bounded = limitItems(turn.items ?? [], remaining - overhead + 2)
    const entry = { ...metadata, items: bounded.items }
    result.turns.push(entry)
    remaining -= jsonBytes(entry) + (result.turns.length > 1 ? 1 : 0)
    if (bounded.truncated) break
  }
  // Do not memoize a mutable builder; callers receive an immutable replacement.
  return { ...result, turns: [...result.turns].reverse() } as T
}
