import type { RemoteEvent, Thread, ThreadItem } from './types'
import { eventMethod, eventTurnId } from './model'

export type TranscriptItem = ThreadItem & { turnId: string; streaming?: boolean }

export function updateTranscript(items: TranscriptItem[], event: RemoteEvent): TranscriptItem[] {
  const method = eventMethod(event)
  const params = event.payload.params as Record<string, unknown> | undefined
  const turnId = eventTurnId(event)
  if (!params || !turnId) return items
  if (method === 'turn/completed') return items.map(item => item.turnId === turnId ? { ...item, streaming: false } : item)
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
  return index < 0 ? [...items, next] : items.map((item, cursor) => cursor === index ? next : item)
}

export function conversationItems(thread: Thread, live: TranscriptItem[]): TranscriptItem[] {
  const result: TranscriptItem[] = []
  const turns = new Set([...(thread.turns ?? []).map(turn => turn.id), ...live.map(item => item.turnId)])
  for (const turnId of turns) {
    const stored = (thread.turns ?? []).find(turn => turn.id === turnId)?.items ?? []
    for (const item of stored) {
      const current = live.find(entry => entry.turnId === turnId && entry.id === item.id)
      result.push(current ?? { ...item, turnId })
    }
    result.push(...live.filter(item => item.turnId === turnId && !stored.some(entry => entry.id === item.id)))
  }
  return result
}
