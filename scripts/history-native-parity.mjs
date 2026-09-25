// Acceptance oracle; run ONLY through codex-heavy after worktree server build.
// Own CODEX_HOME/HOME, synthetic JSONL, read-only thread/read; no turn/start,
// real credentials, production state, transcript payloads, or native resume.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, appendFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
import { HistoryPages } from '../dist-server/history-pages.js'
import { RolloutHistory } from '../dist-server/rollout-history.js'
import { bootstrapRecords, serializeRecords, nativeEvent, nativeUser, nativeAnswer, nativeStart, nativeComplete, rawUser, record } from '../server/fixtures/native-history-order.mjs'
const binary = '/root/.codex/packages/standalone/releases/0.155.0-x86_64-unknown-linux-musl/bin/codex'
const root = await mkdtemp(join(tmpdir(), 'history-native-parity-')), home = join(root, 'native')
let native
let parseWarning = false
const launch = () => {
  const child = new CodexAppServer('/usr/bin/env', ['-i', 'PATH=/usr/local/bin:/usr/bin:/bin', `HOME=${root}`, `CODEX_HOME=${home}`, binary])
  // Never print stderr bodies, even though input and environment are synthetic.
  child.on('log', line => { if (/parse.*rollout|invalid.*rollout|deserializ|missing field/i.test(line)) parseWarning = true })
  return child
}
const stop = async child => {
  if (!child || child.state === 'stopped' || child.state === 'failed') return
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.off('state', listener); reject(Error('Owned native process did not exit; fixture directory retained')) }, 10000)
    const listener = state => { if (state === 'stopped' || state === 'failed') { clearTimeout(timer); child.off('state', listener); resolve() } }
    child.on('state', listener); child.stop()
  })
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const display = turns => turns.map(turn => ({ id: turn.id, status: turn.status, items: (turn.items ?? []).filter(item => ['userMessage', 'agentMessage'].includes(item.type)).map(item => ({
  id: item.id, type: item.type, text: item.type === 'agentMessage' ? item.text : item.content.filter(part => part.type === 'text').map(part => part.text).join('\n'),
})) })).filter(turn => turn.items.length)
try {
  await mkdir(join(home, 'sessions', '2026', '09', '25'), { recursive: true })
  // Prevent provider traffic; these probes do not ask a model to execute anything.
  await writeFile(join(home, 'config.toml'), 'model_provider = "fixture"\n[model_providers.fixture]\nname = "Fixture offline"\nbase_url = "http://127.0.0.1:1/v1"\nwire_api = "responses"\n', { mode: 0o600 })
  const scenarios = ['bootstrap', 'legacy', 'cancelled', 'fork-flattened', 'rollback']
  let comparisons = 0
  for (const scenario of scenarios) {
    const id = randomUUID(), path = join(home, 'sessions', '2026', '09', '25', `rollout-2026-09-25T00-00-00-${id}.jsonl`)
    let rows = bootstrapRecords(id, root)
    if (scenario === 'legacy') rows = [rows[0], rawUser('Imported context'), nativeUser('Legacy input'), nativeAnswer('Legacy answer'), nativeUser('Next legacy input'), nativeAnswer('Next legacy answer')]
    if (scenario === 'cancelled') rows = [rows[0], rawUser('Bootstrap'), nativeStart('cancel'), nativeEvent('turn_aborted', { turn_id: 'cancel', reason: 'interrupted' }), nativeComplete('cancel'), nativeStart('empty'), nativeComplete('empty')]
    if (scenario === 'fork-flattened') rows = [rows[0], nativeUser('Copied inherited input'), nativeAnswer('Copied inherited answer'), nativeStart('fork-turn'), nativeUser('Fork input'), nativeAnswer('Fork answer'), nativeComplete('fork-turn')]
    if (scenario === 'rollback') rows = [rows[0], nativeStart('keep'), nativeUser('Keep'), nativeAnswer('Keep answer'), nativeComplete('keep'), nativeStart('drop'), nativeUser('Drop'), nativeAnswer('Drop answer'), nativeComplete('drop'), nativeEvent('thread_rolled_back', { num_turns: 1 }), record('compacted', { message: 'Compaction summary' }), nativeUser('After compaction'), nativeAnswer('After compaction answer')]
    await writeFile(path, serializeRecords(rows), { mode: 0o600 })
    native = launch()
    const before = digest(await readFile(path)), result = await native.request('thread/read', { threadId: id, includeTurns: true })
    const pages = new HistoryPages('fixture-only-secret'.repeat(4), new RolloutHistory(home, join(root, `index-${scenario}`)))
    const window = await pages.page({ id, cwd: root, path }, () => {})
    assert.deepEqual(display(window.turns), display(result.thread.turns), `${scenario}: native display identity/association differs`)
    assert.equal(window.latestTurn?.status, result.thread.turns.at(-1)?.status, `${scenario}: terminal status`)
    assert.equal(digest(await readFile(path)), before, 'Native fixture source changed on read')
    assert.equal(parseWarning, false, 'Native rejected a fixture record; repair schema before accepting parity')
    comparisons++
    await stop(native); native = undefined
    if (scenario === 'bootstrap') {
      await appendFile(path, serializeRecords([rawUser('Subsequent input'), nativeStart('subsequent'), nativeUser('Subsequent input'), nativeAnswer('Subsequent answer'), nativeComplete('subsequent')]))
      native = launch()
      const result = await native.request('thread/read', { threadId: id, includeTurns: true })
      const resumed = new HistoryPages('fixture-only-secret'.repeat(4), new RolloutHistory(home, join(root, `index-${scenario}`)))
      assert.deepEqual(display((await resumed.page({ id, cwd: root, path }, () => {})).turns), display(result.thread.turns))
      assert.equal(parseWarning, false); comparisons++
      await stop(native); native = undefined
    }
  }
  console.log(JSON.stringify({ fixture: 'native-0.155.0-history-parity', comparisons, productionRead: false, modelTurns: 0 }))
} finally { await stop(native); await rm(root, { recursive: true, force: true }) }
