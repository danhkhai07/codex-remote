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
    const rows = [{ type: 'session_meta', payload: { id: thread.id, cwd: thread.cwd, cli_version: '0.155.0', history_mode: 'paginated', history_base: null, subagent_history_start_ordinal: null } }]
    for (const turn of thread.turns ?? []) {
      rows.push({ type: 'event_msg', payload: { type: 'task_started', turn_id: turn.id } })
      for (const item of turn.items ?? []) {
        const canonical = { ...item, type: item.type[0].toUpperCase() + item.type.slice(1) }
        if (item.type === 'agentMessage') { canonical.content = [{ type: 'Text', text: item.text ?? '' }]; delete canonical.text }
        rows.push({ type: 'event_msg', payload: { type: 'item_completed', thread_id: thread.id, turn_id: turn.id,
          item: canonical, started_at_ms: 1, completed_at_ms: 2 } })
      }
      if (turn.status !== 'inProgress') rows.push({ type: 'event_msg', payload: { type: turn.status === 'completed' || turn.status === 'failed' ? 'task_complete' : 'turn_aborted', turn_id: turn.id, ...(turn.status === 'failed' ? { error: { message: 'Fixture failure' } } : {}) } })
    }
    const temporary = entry.path + '.tmp'; owned.add(temporary)
    writeFileSync(temporary, rows.map((row, ordinal) => JSON.stringify({ timestamp: '2026-09-25T00:00:00.000Z', ordinal, ...row })).join('\n') + '\n', { mode: 0o600 }); renameSync(temporary, entry.path)
    entry.signature = signature
  }
  return { ...thread, path: entry.path }
}
