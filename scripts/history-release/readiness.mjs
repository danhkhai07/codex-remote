import assert from 'node:assert/strict'

const terminal = new Set(['completed', 'failed', 'interrupted', 'cancelled'])
export function orchestrationBusy(state) {
  assert(Array.isArray(state?.tasks) && Array.isArray(state?.notices), 'Incomplete orchestration state')
  assert(state.tasks.every(t => typeof t?.status === 'string'), 'Unknown task')
  assert(state.notices.every(n => ['pending', 'sending', 'sent', 'review'].includes(n?.status)), 'Unknown report state')
  return state.tasks.filter(t => !terminal.has(t.status) || t.dispatchPending === true
    || (t.dispatchPending === undefined && ['failed', 'interrupted', 'cancelled'].includes(t.status))).length
    + state.notices.filter(n => ['pending', 'sending'].includes(n.status)).length
    + (state.archives ?? []).filter(a => ['preparing', 'sent'].includes(a.status)).length
}

// API authority is always NEW encrypted maintenance. The local read-only state
// guard also sees orphaned group jobs and in-flight notices omitted by snapshots.
// No task/conversation (including this worker and the leader) is exempt.
export async function allReadiness(api, restartReadiness, readState) {
  const native = await restartReadiness(api)
  const groups = await api('/api/conversation-groups')
  assert(Array.isArray(groups?.groups) && groups.assignments && typeof groups.assignments === 'object', 'Incomplete groups')
  let queued = 0
  for (const group of groups.groups) {
    const member = group.leaderThreadId || Object.entries(groups.assignments).find(([, id]) => id === group.id)?.[0]
    if (!member) continue // Empty groups are still covered by the global state guard.
    const team = await api(`/api/threads/${encodeURIComponent(member)}/orchestration`)
    assert(team.groupId === group.id && Array.isArray(team.tasks) && Number.isInteger(team.pendingResults), 'Incomplete team')
    queued += team.tasks.filter(t => !terminal.has(t.status) || t.dispatchPending !== false).length + team.pendingResults
  }
  queued += orchestrationBusy(readState())
  return { ...native, queued, ready: native.ready && queued === 0 }
}
