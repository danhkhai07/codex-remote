import type { Thread } from './types'

export type ConversationGroup = { id: string; name: string; contextPath: string }
export type GroupSnapshot = {
  revision: number
  vaultPath: string
  sharedContextPath: string
  groups: ConversationGroup[]
  assignments: Record<string, string>
}

/** Missing/deleted group references never hide a conversation. */
export function groupConversations(threads: Thread[], snapshot: GroupSnapshot) {
  const buckets = new Map(snapshot.groups.map(group => [group.id, [] as Thread[]]))
  const ungrouped: Thread[] = []
  for (const thread of threads) {
    const bucket = buckets.get(snapshot.assignments[thread.id])
    ;(bucket ?? ungrouped).push(thread)
  }
  return [
    ...snapshot.groups.map(group => ({ group, threads: buckets.get(group.id)! })),
    { group: null, threads: ungrouped },
  ]
}
