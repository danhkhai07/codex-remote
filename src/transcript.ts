import type { RemoteEvent, Thread, ThreadItem } from './types'
import { eventMethod, eventTurnId } from './model'
import { limitItems, MAX_CONVERSATION_BYTES } from '../server/conversation-size'

export type TranscriptItem = ThreadItem & { turnId: string; streaming?: boolean }

/** Completed server history supersedes partial deltas cached before a disconnect. */
export function reconcileTranscript(items: TranscriptItem[], thread: Thread): TranscriptItem[] {
  if (thread.historyUnavailable) return items
  const completedItems = new Set((thread.turns ?? [])
    .filter(turn => ['completed', 'interrupted', 'failed'].includes(turn.status))
    .flatMap(turn => (turn.items ?? []).filter(item => item.id).map(item => `${turn.id}:${item.id}`)))
  const next = items.filter(item => !completedItems.has(`${item.turnId}:${item.id}`))
  return next.length === items.length ? items : next
}

export function updateTranscript(items: TranscriptItem[], event: RemoteEvent): TranscriptItem[] {
  const method = eventMethod(event)
  const params = event.payload.params as Record<string, unknown> | undefined
  const turnId = eventTurnId(event)
  if (!params || !turnId) return items
  if (method === 'turn/completed') return limitItems(items.map(item => item.turnId === turnId ? { ...item, streaming: false } : item), MAX_CONVERSATION_BYTES).items
  const supplied = params.item as ThreadItem | undefined
  const id = supplied?.id ?? params.itemId
  if (typeof id !== 'string') return items
  const index = items.findIndex(item => item.id === id && item.turnId === turnId)
  const previous = index < 0 ? undefined : items[index]
  let next: TranscriptItem
  if ((method === 'item/started' || method === 'item/completed') && supplied) {
    next = { ...previous, ...supplied, turnId, streaming: method !== 'item/completed' }
  } else if (typeof params.delta === 'string' && (method === 'item/agentMessage/delta' || method === 'item/commandExecution/outputDelta')) {
    const agent = method === 'item/agentMessage/delta'
    const field = agent ? 'text' : 'aggregatedOutput'
    next = { ...previous, id, turnId, type: agent ? 'agentMessage' : 'commandExecution', streaming: true,
      [field]: String(previous?.[field] ?? '') + params.delta }
  } else return items
  return limitItems(index < 0 ? [...items, next] : items.map((item, cursor) => cursor === index ? next : item), MAX_CONVERSATION_BYTES).items
}

export function conversationItems(thread: Thread, live: TranscriptItem[]): TranscriptItem[] {
  const result: TranscriptItem[] = []
  const storedTurns = new Map((thread.turns ?? []).map(turn => [turn.id, turn.items ?? []]))
  const liveTurns = new Map<string, TranscriptItem[]>()
  for (const item of live) {
    const group = liveTurns.get(item.turnId)
    if (group) group.push(item)
    else liveTurns.set(item.turnId, [item])
  }
  for (const turnId of new Set([...storedTurns.keys(), ...liveTurns.keys()])) {
    const stored = storedTurns.get(turnId) ?? []
    const updates = liveTurns.get(turnId) ?? []
    const byId = new Map(updates.map(item => [item.id, item]))
    const storedIds = new Set(stored.map(item => item.id))
    for (const item of stored) {
      const current = byId.get(item.id)
      result.push(current ?? { ...item, turnId })
    }
    result.push(...updates.filter(item => !storedIds.has(item.id)))
  }
  return limitItems(result, MAX_CONVERSATION_BYTES).items
}
