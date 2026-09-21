import { describe, expect, it } from 'vitest'
import { groupConversations, type GroupSnapshot } from './conversationGroups'
import type { Thread } from './types'

const thread = (id: string): Thread => ({ id, cwd: '/repo', createdAt: 1, updatedAt: 1, status: 'idle' })
const snapshot: GroupSnapshot = {
  revision: 3, vaultPath: '/vault', sharedContextPath: '/vault/Shared/Context.md',
  groups: [
    { id: 'alpha', name: 'Alpha', contextPath: '/vault/Groups/alpha/Context.md' },
    { id: 'empty', name: 'Empty', contextPath: '/vault/Groups/empty/Context.md' },
  ],
  assignments: { first: 'alpha', third: 'alpha', orphan: 'deleted-group' },
}

describe('conversation folders', () => {
  it('keeps order within folders, includes empty folders, and never hides stale assignments', () => {
    const threads = ['first', 'orphan', 'second', 'third'].map(thread)
    const grouped = groupConversations(threads, snapshot)
    expect(grouped.map(({ group, threads }) => [group?.id ?? null, threads.map(thread => thread.id)])).toEqual([
      ['alpha', ['first', 'third']], ['empty', []], [null, ['orphan', 'second']],
    ])
    expect(grouped.flatMap(group => group.threads)).toHaveLength(threads.length)
  })

  it('returns deleted-folder conversations to Ungrouped without needing new thread history', () => {
    const threads = ['first', 'second'].map(thread)
    expect(groupConversations(threads, { ...snapshot, groups: [] })).toEqual([{ group: null, threads }])
    expect(groupConversations([thread('third')], snapshot)[0].threads.map(thread => thread.id)).toEqual(['third'])
  })
  it('pins each leader first while preserving other conversations and input order', () => {
    const threads = ['first', 'orphan', 'second', 'third'].map(thread)
    const withLeader = { ...snapshot, groups: snapshot.groups.map(group => ({ ...group, leaderThreadId: 'third' })) }
    expect(groupConversations(threads, withLeader).map(bucket => bucket.threads.map(item => item.id)))
      .toEqual([['third', 'first'], [], ['orphan', 'second']])
    expect(threads.map(item => item.id)).toEqual(['first', 'orphan', 'second', 'third'])
    const changed = { ...withLeader, groups: withLeader.groups.map(group => ({ ...group, leaderThreadId: 'first' })) }
    expect(groupConversations(threads, changed)[0].threads.map(item => item.id)).toEqual(['first', 'third'])
  })

  it('does not inject a leader excluded by search or assigned to another folder', () => {
    const withLeader = { ...snapshot, groups: snapshot.groups.map(group => ({ ...group, leaderThreadId: 'third' })) }
    expect(groupConversations([thread('first')], withLeader)[0].threads.map(item => item.id)).toEqual(['first'])
    expect(groupConversations([thread('first'), thread('third')], {
      ...withLeader, assignments: { first: 'alpha', third: 'empty' },
    }).map(bucket => bucket.threads.map(item => item.id))).toEqual([['first'], ['third'], []])
  })

})
