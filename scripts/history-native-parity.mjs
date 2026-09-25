// Run ONLY through codex-heavy after worktree build. Own HOME/CODEX_HOME and
// synthetic sessions; no production thread reads, turn/start or owner keys.
// Paginated scenarios MUST use native paging APIs, never includeTurns:true.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, appendFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
import { HistoryPages } from '../dist-server/history-pages.js'
import { RolloutHistory } from '../dist-server/rollout-history.js'
import { RemoteController } from '../dist-server/controller.js'
import { bootstrapRecords, paginatedBootstrapRecords, materialized, materializedUser, materializedAnswer, serializeRecords, withOrdinals, nativeEvent, nativeUser, nativeAnswer, nativeStart, nativeComplete, rawUser, record } from '../server/fixtures/native-history-order.mjs'
const binary = '/root/.codex/packages/standalone/releases/0.155.0-x86_64-unknown-linux-musl/bin/codex'
const root = await mkdtemp(join(tmpdir(), 'history-native-parity-')), home = join(root, 'native')
let native
let parseWarnings = []
const calls = []
const launch = () => {
  const child = new CodexAppServer('/usr/bin/env', ['-i', 'PATH=/usr/local/bin:/usr/bin:/bin', `HOME=${root}`, `CODEX_HOME=${home}`, binary])
  const request = child.request.bind(child)
  child.request = (method, params, ...args) => { calls.push({ method, includeTurns: params?.includeTurns }); return request(method, params, ...args) }
  child.on('log', line => {
    // Owned fake HOME/config/rollouts only; never production log content.
    if (/parse.*rollout|invalid.*rollout|deserializ|missing field|skipping.*rollout|projection.*expected ordinal/i.test(line)) parseWarnings.push(line)
    if (process.env.HISTORY_PARITY_DIAGNOSTIC) console.error('[owned-native]', line)
  })
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
const rpc = (method, params) => native.request(method, params)
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const message = (turnId, item) => ({ turnId, id: item.id, type: item.type,
  text: item.type === 'agentMessage' ? item.text : item.content.filter(part => part.type === 'text').map(part => part.text).join('\n'),
  ...(item.type === 'agentMessage' ? { phase: item.phase ?? null } : {}),
})
const display = entries => entries.filter(({ item }) => ['userMessage', 'agentMessage'].includes(item.type)).map(({ turnId, item }) => message(turnId, item))
const fromTurns = turns => turns.flatMap(turn => turn.items.map(item => ({ turnId: turn.id, item })))
const allNativePages = async (method, threadId, extra = {}) => {
  const result = [], cursors = new Set()
  let cursor = null
  for (let n = 0; n < 50; n++) {
    const page = await rpc(method, { threadId, limit: 7, sortDirection: 'asc', ...extra, ...(cursor ? { cursor } : {}) })
    assert(Array.isArray(page.data), 'Native page schema changed')
    result.push(...page.data)
    if (!page.nextCursor) return result
    assert(!cursors.has(page.nextCursor), 'Native cursor did not advance')
    cursor = page.nextCursor; cursors.add(cursor)
  }
  throw Error('Owned parity fixture unexpectedly exceeds bounded page count')
}
const paginatedNative = async id => {
  // Seed discoverable fixture metadata through supported APIs, never SQL.
  // Native paging reads its own materialized DB; merely placing JSONL on disk
  // leaves that DB empty. Resume/unsubscribe ONLY this owned offline fixture
  // makes the native writer flush/project it without starting a model turn.
  await rpc('thread/list', { limit: 100, useStateDbOnly: false })
  await rpc('thread/read', { threadId: id, includeTurns: false })
  await rpc('thread/resume', { threadId: id, excludeTurns: true, modelProvider: 'fixture', model: 'gpt-6-astra', approvalPolicy: 'never', sandbox: 'read-only' })
  await rpc('thread/unsubscribe', { threadId: id })
  const turns = await allNativePages('thread/turns/list', id, { itemsView: 'notLoaded' })
  const entries = await allNativePages('thread/items/list', id)
  return { turns, entries }
}
const allIndexPages = async (pages, metadata) => {
  const first = await pages.page(metadata, () => {}), entries = fromTurns(first.turns)
  let cursor = first.older
  for (let n = 0; cursor && n < 50; n++) {
    const page = await pages.page(metadata, () => {}, cursor)
    entries.unshift(...fromTurns(page.turns)); cursor = page.older
  }
  assert.equal(cursor, null)
  return { first, entries }
}
try {
  await mkdir(join(home, 'sessions', '2026', '09', '25'), { recursive: true })
  await writeFile(join(home, 'config.toml'), 'model_provider = "fixture"\n[model_providers.fixture]\nname = "Fixture offline"\nbase_url = "http://127.0.0.1:1/v1"\nwire_api = "responses"\n', { mode: 0o600 })
  const scenarios = ['paginated-torn-record', 'paginated-bootstrap', 'paginated-twenty-tools', 'paginated-cancelled', 'paginated-late-items', 'paginated-rollback-compaction', 'legacy-control']
  let comparisons = 0
  for (const scenario of scenarios) {
    parseWarnings = []
    const checkWarnings = () => {
      const unexpected = parseWarnings.filter(line => scenario !== 'paginated-torn-record' ||
        !/skipping malformed rollout line during projection/.test(line))
      assert.deepEqual(unexpected, [], 'Native rejected otherwise-valid fixture records; do not accept partial parity')
    }
    const id = randomUUID(), path = join(home, 'sessions', '2026', '09', '25', `rollout-2026-09-25T00-00-00-${id}.jsonl`), metadata = { id, cwd: root, path }
    let rows = paginatedBootstrapRecords(id, root)
    if (['paginated-twenty-tools', 'paginated-torn-record'].includes(scenario)) {
      for (let n = 0; n < (scenario === 'paginated-torn-record' ? 25 : 13); n++) rows.push(nativeStart(`t${n}`), materializedUser(id, `t${n}`, `u${n}`, `Input ${n}`),
        materialized(id, `t${n}`, { type: 'Plan', id: `tool-${n}`, text: 'Materialized non-message' }), materializedAnswer(id, `t${n}`, `a${n}`, `Answer ${n}`), nativeComplete(`t${n}`))
    }
    if (scenario === 'paginated-cancelled') rows = [rows[0], rawUser('Bootstrap'), nativeStart('cancel'), nativeEvent('turn_aborted', { turn_id: 'cancel', reason: 'interrupted' }), nativeComplete('cancel'), nativeStart('empty'), nativeComplete('empty')]
    if (scenario === 'paginated-late-items') rows.push(materializedAnswer(id, 'review', 'review-a', 'Before lifecycle'), nativeStart('later'), materializedUser(id, 'later', 'later-u', 'Later input'), nativeStart('review'), nativeComplete('review'), materializedAnswer(id, 'first', 'native-agent-1', 'Corrected snapshot'), nativeComplete('later'))
    if (scenario === 'paginated-rollback-compaction') rows.push(nativeEvent('thread_rolled_back', { num_turns: 1 }), record('compacted', { message: 'Context summary' }), rawUser('Model replacement'), nativeStart('after'), materializedUser(id, 'after', 'after-u', 'Visible after compaction'), materializedAnswer(id, 'after', 'after-a', 'After answer'), nativeComplete('after'))
    if (scenario === 'legacy-control') rows = [bootstrapRecords(id, root)[0], rawUser('Imported context'), nativeUser('Legacy input'), nativeAnswer('Legacy answer'), nativeUser('Next legacy input'), nativeAnswer('Next legacy answer')]
    else {
      rows = withOrdinals(rows)
      assert.equal(rows[0].payload.history_mode, 'paginated')
      assert(!rows.some(row => ['user_message', 'agent_message'].includes(row.payload.type)), 'Paginated fixture fabricated legacy display events')
    }
    const indexDirectory = join(root, `index-${scenario}`)
    if (scenario === 'paginated-bootstrap') {
      await writeFile(path, serializeRecords(rows.slice(0, 5)), { mode: 0o600 })
      assert.equal((await new HistoryPages('FAKE'.repeat(16), new RolloutHistory(home, indexDirectory)).page(metadata, () => {})).messages, 0)
      await appendFile(path, serializeRecords(rows.slice(5, 13)))
      assert.deepEqual(display(fromTurns((await new HistoryPages('FAKE'.repeat(16), new RolloutHistory(home, indexDirectory)).page(metadata, () => {})).turns)).map(item => item.id), ['native-user-1'])
      await appendFile(path, serializeRecords(rows.slice(13)))
    } else if (scenario === 'paginated-torn-record') {
      // Same structural corruption as TECH: General, synthetic bytes only.
      // Valid record 16 keeps its original ordinal; no invented legacy events.
      await writeFile(path, serializeRecords(rows.slice(0, 16)) + '{"timestamp":"2026-09-25T00:00:00.000Z","o\n' + serializeRecords(rows.slice(16)), { mode: 0o600 })
    } else await writeFile(path, serializeRecords(rows), { mode: 0o600 })
    const callStart = calls.length
    native = launch()
    const before = await readFile(path)
    const expected = scenario === 'legacy-control'
      ? await rpc('thread/read', { threadId: id, includeTurns: true }).then(result => ({ turns: result.thread.turns, entries: fromTurns(result.thread.turns) }))
      : await paginatedNative(id)
    if (scenario === 'paginated-torn-record') {
      assert.deepEqual(display(expected.entries).map(item => item.id), ['native-user-1', 'native-agent-1', ...Array.from({ length: 25 }, (_, n) => [`u${n}`, `a${n}`]).flat()], 'Native must retain every valid message on both sides of corruption')
    }
    const prepared = await readFile(path)
    assert.equal(digest(prepared.subarray(0, before.length)), digest(before), 'Native preparation changed the owned fixture prefix')
    const actual = await allIndexPages(new HistoryPages('FAKE'.repeat(16), new RolloutHistory(home, indexDirectory)), metadata)
    checkWarnings()
    assert.deepEqual(display(actual.entries), display(expected.entries), `${scenario}: native canonical IDs/turn/content differ`)
    assert.equal(actual.first.messages, Math.min(20, display(expected.entries).length))
    assert.equal(actual.first.latestTurn?.id, expected.turns.at(-1)?.id)
    assert.equal(actual.first.latestTurn?.status, expected.turns.at(-1)?.status)
    for (const turn of actual.first.turns) {
      const original = expected.turns.find(t => t.id === turn.id)
      if (original) assert.equal(turn.status, original.status, `${scenario}: turn status differs`)
    }
    assert.equal(digest(await readFile(path)), digest(prepared), 'Index read mutated synthetic canonical source')
    // Also exercise the actual app controller against the installed binary,
    // including legacy's unsupported native paging boundary.
    const controller = new RemoteController({ workspaceRoots: [root], historyNativeHome: home, historyIndexPath: indexDirectory,
      sessionSecret: 'FAKE'.repeat(16), production: true }, native)
    const controlled = await controller.readHistoryPage(id)
    assert.deepEqual(display(fromTurns(controlled.thread.turns)), display(fromTurns(actual.first.turns)))
    checkWarnings()
    if (scenario !== 'legacy-control') assert(!calls.slice(callStart).some(call => call.includeTurns === true))
    comparisons++; await stop(native); native = undefined
    if (scenario === 'paginated-bootstrap') {
      const next = JSON.parse((await readFile(path, 'utf8')).trim().split('\n').at(-1)).ordinal + 1
      await appendFile(path, serializeRecords(withOrdinals([rawUser('Next bootstrap context'), nativeStart('subsequent'), materializedUser(id, 'subsequent', 'sub-u', 'Subsequent input'), materializedAnswer(id, 'subsequent', 'sub-a', 'Subsequent answer'), nativeComplete('subsequent')], next)))
      native = launch()
      const expected = await paginatedNative(id)
      const actual = await allIndexPages(new HistoryPages('FAKE'.repeat(16), new RolloutHistory(home, indexDirectory)), metadata)
      assert.deepEqual(display(actual.entries), display(expected.entries)); checkWarnings()
      comparisons++; await stop(native); native = undefined
    }
  }
  assert(!calls.some(call => !['thread/list', 'thread/read', 'thread/items/list', 'thread/turns/list', 'thread/resume', 'thread/unsubscribe'].includes(call.method)))
  console.log(JSON.stringify({ fixture: 'native-0.155.0-paginated-and-legacy-parity', comparisons, nativeCalls: calls.length, productionRead: false, modelTurns: 0 }))
} finally { await stop(native); await rm(root, { recursive: true, force: true }) }
