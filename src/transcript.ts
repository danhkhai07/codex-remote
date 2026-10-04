import type { RemoteEvent, Thread, ThreadItem } from './types'
import { commandText, eventMethod, eventTurnId, itemText } from './model'
import { limitItems, MAX_CONVERSATION_BYTES } from '../server/conversation-size'

export type TranscriptItem = ThreadItem & { turnId: string; streaming?: boolean }

const INTERNAL_ITEM_TYPES = new Set(['contextcompaction', 'enteredreviewmode', 'exitedreviewmode'])
const PUBLIC_ACTIVITY_TYPES = new Set([
  'commandexecution', 'filechange', 'mcptoolcall', 'websearch', 'historytools',
  'dynamictoolcall', 'collabagenttoolcall', 'subagentactivity', 'extension',
  'functioncalloutput', 'hookprompt',
])

/** Keep private bookkeeping out of the conversation without discarding source data. */
export function isVisibleTranscriptItem(item: ThreadItem): boolean {
  const type = String(item.type ?? '').toLocaleLowerCase()
  if (['usermessage', 'agentmessage', 'plan'].includes(type)) return true
  if (type === 'reasoning') return Boolean(itemText(item).trim())
  if (INTERNAL_ITEM_TYPES.has(type)) return false
  if (itemText(item).trim() || commandText(item).trim() || (Array.isArray(item.changes) && item.changes.length > 0)) return true
  if (typeof item.historyDetail === 'string' && item.historyDetail) return true
  return PUBLIC_ACTIVITY_TYPES.has(type)
}

/** Completed server history supersedes cached deltas. A stable recent-page
 * snapshot also drops completed items that fell outside its bounded window. */
export function reconcileTranscript(items: TranscriptItem[], thread: Thread, authoritativeWindow = false): TranscriptItem[] {
  if (thread.historyUnavailable) return items
  const turns = new Map((thread.turns ?? []).map(turn => [turn.id, turn]))
  const completedItems = new Set((thread.turns ?? [])
    .filter(turn => ['completed', 'interrupted', 'failed'].includes(turn.status))
    .flatMap(turn => (turn.items ?? []).filter(item => item.id).map(item => `${turn.id}:${item.id}`)))
  const next = items.filter(item => {
    if (completedItems.has(`${item.turnId}:${item.id}`)) return false
    if (!authoritativeWindow || !thread.historyWindow) return true
    const turn = turns.get(item.turnId)
    // A recent-page response omits old turns and may omit old items within a
    // completed turn. Cached SSE for those items must not reappear at the end.
    if (turn) return !['completed', 'interrupted', 'failed'].includes(turn.status)
    return item.turnId === thread.latestTurn?.id && thread.latestTurn.status === 'inProgress'
  })
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
  } else if (typeof params.delta === 'string' && (method === 'item/agentMessage/delta' || method === 'item/plan/delta' || method === 'item/commandExecution/outputDelta')) {
    const agent = method !== 'item/commandExecution/outputDelta'
    const field = agent ? 'text' : 'aggregatedOutput'
    next = { ...previous, id, turnId, type: method === 'item/plan/delta' ? 'plan' : agent ? 'agentMessage' : 'commandExecution', streaming: true,
      [field]: String(previous?.[field] ?? '') + params.delta }
  } else return items
  return limitItems(index < 0 ? [...items, next] : items.map((item, cursor) => cursor === index ? next : item), MAX_CONVERSATION_BYTES).items
}

export function conversationItems(thread: Thread, live: TranscriptItem[]): TranscriptItem[] {
  const result: TranscriptItem[] = []
  const storedTurns = new Map((thread.turns ?? []).map(turn => [turn.id, turn.items ?? []]))
  if (thread.historyWindow?.browsingOlder) live = []
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
      const selected = current ?? { ...item, turnId }
      if (isVisibleTranscriptItem(selected)) result.push(selected)
    }
    result.push(...updates.filter(item => !storedIds.has(item.id) && isVisibleTranscriptItem(item)))
  }
  return limitItems(thread.historyWindow ? result.slice(-240) : result, MAX_CONVERSATION_BYTES).items
}
