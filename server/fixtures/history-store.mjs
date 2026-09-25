// Owned fake rollout storage for browser/native fixtures, never real CODEX_HOME.
import { mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
export const historyFixtureHome = join(tmpdir(), `codex-remote-history-fixtures-${process.getuid?.() ?? 'test'}`)
const owned = new Set(), records = new Map()
process.once('SIGTERM', () => process.exit(143))
process.once('exit', () => { for (const path of owned) rmSync(path, { recursive: true, force: true }) })
export function historyFixtureConfig() {
  const historyIndexPath = join(historyFixtureHome, 'indexes', randomUUID())
  owned.add(historyIndexPath)
  return { historyNativeHome: historyFixtureHome, historyIndexPath }
}
export function persistedFixtureThread(thread) {
  mkdirSync(join(historyFixtureHome, 'sessions'), { recursive: true, mode: 0o700 })
  const signature = createHash('sha256').update(JSON.stringify(thread)).digest('hex')
  let entry = records.get(thread.id)
  if (!entry) {
    entry = { path: join(historyFixtureHome, 'sessions', `${randomUUID()}.jsonl`), signature: '' }
    records.set(thread.id, entry); owned.add(entry.path)
  }
  if (entry.signature !== signature) {
    const rows = [{ type: 'session_meta', payload: { id: thread.id, cwd: thread.cwd } }]
    for (const turn of thread.turns ?? []) {
      rows.push({ type: 'event_msg', payload: { type: 'task_started', turn_id: turn.id } })
      for (const item of turn.items ?? []) rows.push({ type: 'event_msg', payload: { type: 'item_completed', turn_id: turn.id, item } })
      if (turn.status !== 'inProgress') rows.push({ type: 'event_msg', payload: { type: turn.status === 'completed' ? 'task_complete' : turn.status === 'failed' ? 'task_failed' : 'turn_aborted', turn_id: turn.id } })
    }
    const temporary = entry.path + '.tmp'; owned.add(temporary)
    writeFileSync(temporary, rows.map(row => JSON.stringify(row)).join('\n') + '\n', { mode: 0o600 }); renameSync(temporary, entry.path)
    entry.signature = signature
  }
  return { ...thread, path: entry.path }
}
