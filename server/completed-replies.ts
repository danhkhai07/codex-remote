/** One reply per successful turn; progress, failed and interrupted turns do not count. */
export function completedReplyIds(turn: Record<string, unknown>): string[] {
  if (turn.status !== 'completed' || typeof turn.id !== 'string' || !Array.isArray(turn.items)) return []
  const hasAnswer = turn.items.some(item => item && item.type === 'agentMessage' &&
    (item.phase == null || item.phase === 'final_answer') && typeof item.text === 'string' && item.text.trim())
  return hasAnswer ? [`reply:${turn.id}`] : []
}
