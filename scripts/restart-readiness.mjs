const terminalTurns = new Set(['completed', 'failed', 'interrupted'])
const idleThreads = new Set(['idle', 'notLoaded'])

// A thread error is not an active turn. Confirm terminal history instead of
// trusting the error label alone. Unknown or incomplete data never permits restart.
export async function restartReadiness(api) {
  const result = await api('/api/threads')
  const pending = await api('/api/pending')
  if (!Array.isArray(result?.data) || !Array.isArray(pending?.data)) throw Error('Incomplete idle response')
  let busy = 0
  const terminalErrors = []
  for (const thread of result.data) {
    if (idleThreads.has(thread?.status?.type)) continue
    if (thread?.status?.type === 'systemError' && typeof thread.id === 'string' && thread.id) {
      const response = await api(`/api/threads/${encodeURIComponent(thread.id)}`)
      const detail = response?.thread ?? response
      if (detail?.id === thread.id
        && (detail.status?.type === 'systemError' || idleThreads.has(detail.status?.type))
        && !detail.historyUnavailable
        && (!detail.latestTurn || terminalTurns.has(detail.latestTurn.status))
        && (!detail.historyCacheTruncated || detail.historyTruncation === 'head')
        && Array.isArray(detail.turns) && detail.turns.length > 0
        && detail.turns.every(turn => terminalTurns.has(turn?.status))) {
        terminalErrors.push(thread.id)
        continue
      }
    }
    busy++
  }
  return { ready: !result.nextCursor && busy === 0 && pending.data.length === 0,
    busy, incomplete: Boolean(result.nextCursor), pending: pending.data.length, terminalErrors }
}
