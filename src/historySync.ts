/** Live deltas carry the conversation; full reads are recovery/consistency work. */
export function scheduleHistorySync(live: boolean, history: () => void, metadata: () => void): () => void {
  history()
  const recovery = setInterval(history, live ? 5 * 60_000 : 15_000)
  const listing = live ? setInterval(metadata, 15_000) : undefined
  return () => { clearInterval(recovery); clearInterval(listing) }
}
