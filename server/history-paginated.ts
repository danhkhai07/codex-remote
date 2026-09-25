/** Canonical paginated rollouts have a different projector from legacy replay.
 * Only completed materialized items and explicit turn lifecycle records affect
 * display history. No content-based pairing, implicit turns or legacy counters.
 * Keep native item/turn identities for SSE/cache reconciliation.
 * Source/validation limits: docs/performance/history-window-2026-09-25.md.
 */
type RecordValue = Record<string, unknown>
export type PaginatedChange =
  | { kind: 'turn'; id: string; status: 'inProgress' | 'completed' | 'failed' | 'interrupted' }
  | { kind: 'item'; turn: string; id: string; item: RecordValue; hidden: boolean }
const object = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
const identity = (value: unknown, max: number) => {
  if (typeof value !== 'string' || !value || value.length >= max) throw Error('Invalid paginated history identity')
  return value
}
export function projectPaginated(row: RecordValue, threadId: string): PaginatedChange | null {
  if (row.type !== 'event_msg') return null
  const event = object(row.payload)
  switch (event.type) {
    case 'task_started': return { kind: 'turn', id: identity(event.turn_id, 257), status: 'inProgress' }
    case 'task_complete': return { kind: 'turn', id: identity(event.turn_id, 257), status: event.error ? 'failed' : 'completed' }
    case 'turn_aborted': return event.turn_id == null ? null : { kind: 'turn', id: identity(event.turn_id, 257), status: 'interrupted' }
    case 'item_completed': {
      if (event.thread_id !== threadId) throw Error('Paginated item belongs to a different native thread')
      const item = object(event.item), type = item.type
      if (typeof type !== 'string' || !type) throw Error('Invalid paginated materialized item')
      const hidden = type.toLowerCase() === 'reasoning' ||
        (item.channel != null && !['commentary', 'final', 'final_answer'].includes(String(item.channel))) ||
        (item.phase != null && !['commentary', 'final', 'final_answer'].includes(String(item.phase)))
      return { kind: 'item', turn: identity(event.turn_id, 257), id: identity(item.id, 4096), item, hidden }
    }
    default:
      // Includes legacy user_message/agent_message, item_started, raw tools,
      // error and thread_rolled_back. A paginated native revert changes the
      // rollout/lineage; the legacy rollback marker is NOT a deletion command.
      return null
  }
}
