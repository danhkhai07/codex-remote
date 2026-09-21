import type { Thread } from './types'

export type ConversationGroup = { id: string; name: string; contextPath: string; leaderThreadId?: string; leaderEpoch?: number }
export type GroupSnapshot = {
  revision: number
  vaultPath: string
  sharedContextPath: string
  groups: ConversationGroup[]
  assignments: Record<string, string>
}

export function conversationGroup(snapshot: GroupSnapshot | null, threadId?: string | null) {
  return threadId ? snapshot?.groups.find(group => group.id === snapshot.assignments[threadId]) : undefined
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
    ...snapshot.groups.map(group => {
      const members = buckets.get(group.id)!
      const leaderIndex = members.findIndex(thread => thread.id === group.leaderThreadId)
      if (leaderIndex > 0) members.unshift(...members.splice(leaderIndex, 1))
      return { group, threads: members }
    }),
    { group: null, threads: ungrouped },
  ]
}
