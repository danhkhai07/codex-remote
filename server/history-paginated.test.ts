import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, appendFile, readFile, rm, open, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { HistoryPages } from './history-pages.js'
import { RolloutHistory } from './rollout-history.js'
import { paginatedBootstrapRecords, materialized, materializedUser, materializedAnswer, nativeStart, nativeComplete, nativeEvent, rawUser, rawAssistant, record, serializeRecords, withOrdinals } from './fixtures/native-history-order.mjs'
import { reconcileTranscript, conversationItems } from '../src/transcript.js'
import type { Thread } from '../src/types.js'
const owned: string[] = []
afterEach(async () => { for (const root of owned.splice(0)) await rm(root, { recursive: true, force: true }) })
const secret = 'ONLY FAKE INDEX SIGNING'.repeat(4)
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'paginated-history-')); owned.push(root)
  await mkdir(join(root, 'sessions'))
  const metadata = { id: 'owned-thread', cwd: '/fixture', path: join(root, 'sessions', 'owned.jsonl') }
  const rows = paginatedBootstrapRecords(metadata.id, metadata.cwd)
  await writeFile(metadata.path, serializeRecords(rows))
  const source = new RolloutHistory(root, join(root, 'index')), pages = new HistoryPages(secret, source)
  let nextOrdinal = rows.length
  return { root, metadata, rows, source, pages,
    restart: () => new HistoryPages(secret, new RolloutHistory(root, join(root, 'index'))),
    append: async (rows: unknown[]) => { await appendFile(metadata.path, serializeRecords(withOrdinals(rows, nextOrdinal))); nextOrdinal += rows.length },
  }
}
const visibleIds = (page: Awaited<ReturnType<HistoryPages['page']>>) => page.turns.flatMap(t => t.items).filter(i => ['userMessage', 'agentMessage'].includes(i.type)).map(i => i.id)
it('accepts the actual paginated bootstrap, retains canonical IDs, and has no invented legacy events', async () => {
  const f = await fixture()
  expect(f.rows[0].payload).toMatchObject({ history_mode: 'paginated', history_base: null, subagent_history_start_ordinal: null })
  expect(f.rows[4].type).toBe('response_item'); expect(f.rows[6].type).toBe('turn_context')
  expect(f.rows[9].payload.type).toBe('task_started'); expect(f.rows[12].payload.item.type).toBe('UserMessage')
  expect(f.rows.some(row => ['user_message', 'agent_message'].includes(row.payload.type))).toBe(false)
  const page = await f.pages.page(f.metadata, () => {})
  expect(visibleIds(page)).toEqual(['native-user-1', 'native-agent-1'])
  expect(page.turns[0].id).toBe('first'); expect(page.latestTurn).toEqual({ id: 'first', status: 'completed' })
  const scanned = f.source.metrics.indexBytes
  expect(await f.pages.page(f.metadata, () => {})).toEqual(page)
  expect(f.source.metrics.indexBytes).toBe(scanned)
  expect(await f.restart().page(f.metadata, () => {})).toEqual(page)
  // Same exact IDs reconcile a persisted completed item against a partial SSE.
  const thread = { id: f.metadata.id, turns: page.turns } as Thread
  const live = [{ id: 'native-agent-1', turnId: 'first', type: 'agentMessage', text: 'First partial', streaming: true }]
  expect(reconcileTranscript(live, thread)).toEqual([])
  expect(conversationItems(thread, reconcileTranscript(live, thread))).toHaveLength(2)
})
it('persists mode/ordinal checkpoints before and after the first materialized message', async () => {
  const f = await fixture()
  await writeFile(f.metadata.path, serializeRecords(f.rows.slice(0, 5)))
  expect(visibleIds(await f.pages.page(f.metadata, () => {}))).toEqual([])
  await appendFile(f.metadata.path, serializeRecords(f.rows.slice(5, 13)))
  expect(visibleIds(await f.restart().page(f.metadata, () => {}))).toEqual(['native-user-1'])
  await appendFile(f.metadata.path, serializeRecords(f.rows.slice(13)))
  expect(visibleIds(await f.restart().page(f.metadata, () => {}))).toEqual(['native-user-1', 'native-agent-1'])
  const indexed = f.source.metrics.indexBytes
  await f.append([rawUser('Next model context'), nativeStart('second'), materializedUser(f.metadata.id, 'second', 'u2', 'Second input'), materializedAnswer(f.metadata.id, 'second', 'a2', 'Second answer'), nativeComplete('second')])
  const page = await f.pages.page(f.metadata, () => {})
  expect(page.turns.map(t => [t.id, t.items.map(i => i.id)])).toEqual([['first', ['native-user-1', 'native-agent-1']], ['second', ['u2', 'a2']]])
  expect(f.source.metrics.indexBytes - indexed).toBeLessThan(5000)
})
it('loads twenty messages excluding materialized tools; older pages retain IDs with no repeat/gap', async () => {
  const f = await fixture()
  for (let n = 0; n < 35; n++) await f.append([
    nativeStart(`t${n}`), materializedUser(f.metadata.id, `t${n}`, `u${n}`, `Input ${n}`),
    ...Array.from({ length: 6 }, (_, k) => materialized(f.metadata.id, `t${n}`, { type: 'Plan', id: `p${n}-${k}`, text: 'Tool fixture' })),
    materializedAnswer(f.metadata.id, `t${n}`, `a${n}`, `Answer ${n}`), nativeComplete(`t${n}`),
  ])
  const first = await f.pages.page(f.metadata, () => {})
  expect(first.messages).toBe(20); expect(first.scanned).toBe(80)
  expect(visibleIds(first)).toEqual(Array.from({ length: 10 }, (_, n) => [`u${25+n}`, `a${25+n}`]).flat())
  const all = visibleIds(first)
  let cursor = first.older
  while (cursor) { const page = await f.pages.page(f.metadata, () => {}, cursor); all.push(...visibleIds(page)); cursor = page.older }
  expect(all).toHaveLength(72); expect(new Set(all).size).toBe(72)
  expect(all).toContain('native-user-1')
})
it('resumes a cancelled paginated scan from its committed ordinal without rescanning the prefix', async () => {
  const f = await fixture()
  const rows = Array.from({ length: 1200 }, (_, n) => materializedAnswer(f.metadata.id, 'first', `checkpoint-${n}`, `${n}:` + 'x'.repeat(2048)))
  await f.append(rows)
  const size = (await stat(f.metadata.path)).size
  await expect(f.pages.page(f.metadata, () => { if (f.source.metrics.indexBytes > 1500000) throw Error('cancel after checkpoint') })).rejects.toThrow('cancel after checkpoint')
  const restarted = new RolloutHistory(f.root, join(f.root, 'index'))
  const pages = new HistoryPages(secret, restarted), page = await pages.page(f.metadata, () => {})
  expect(visibleIds(page)).toEqual(Array.from({ length: 20 }, (_, n) => `checkpoint-${1180+n}`))
  expect(restarted.metrics.rebuilds).toBe(0)
  expect(restarted.metrics.indexBytes).toBeGreaterThan(0)
  expect(restarted.metrics.indexBytes).toBeLessThan(size - 1000000)
  const before = restarted.metrics.indexBytes
  await f.append([materializedAnswer(f.metadata.id, 'first', 'checkpoint-tail', 'Append after restart')])
  expect(visibleIds(await pages.page(f.metadata, () => {})).at(-1)).toBe('checkpoint-tail')
  expect(restarted.metrics.indexBytes - before).toBeLessThan(1000)
}, 90000)
it('preserves canonical multi-part answer text and final/commentary phases', async () => {
  const f = await fixture()
  await f.append([
    materialized(f.metadata.id, 'first', { type: 'AgentMessage', id: 'parts', content: [{ type: 'Text', text: 'Xin ' }, { type: 'Text', text: 'chào 😀' }], phase: 'commentary' }),
    materializedAnswer(f.metadata.id, 'first', 'final', 'Kết quả', 'final_answer'),
  ])
  const page = await f.pages.page(f.metadata, () => {})
  expect(page.turns[0].items.slice(-2)).toMatchObject([
    { id: 'parts', text: 'Xin chào 😀', phase: 'commentary' },
    { id: 'final', text: 'Kết quả', phase: 'final_answer' },
  ])
})
it('preserves explicit late/orphan association, first terminal state and original position on duplicate completion', async () => {
  const f = await fixture()
  await f.append([
    materializedAnswer(f.metadata.id, 'review', 'r1', 'Before lifecycle'),
    nativeEvent('item_started', { thread_id: f.metadata.id, turn_id: 'wrong', item: { type: 'AgentMessage', id: 'not-completed', content: [{ type: 'Text', text: 'Still live' }] } }),
    nativeStart('later'), materializedUser(f.metadata.id, 'later', 'later-u', 'Later input'),
  ])
  const orphan = await f.pages.page(f.metadata, () => {})
  expect(orphan.turns.find(t => t.id === 'review')).toMatchObject({ status: 'unknown', items: [{ id: 'r1' }] })
  expect(orphan.latestTurn?.id).toBe('later')
  await f.append([nativeStart('review'), nativeEvent('turn_aborted', { turn_id: 'review', reason: 'interrupted' }), nativeComplete('review'),
    materializedAnswer(f.metadata.id, 'first', 'native-agent-1', 'Corrected snapshot'), nativeComplete('later')])
  const page = await f.restart().page(f.metadata, () => {})
  expect(visibleIds(page)).toEqual(['native-user-1', 'native-agent-1', 'r1', 'later-u'])
  expect(page.turns.find(t => t.id === 'review')?.status).toBe('interrupted')
  expect(page.turns[0].items[1].text).toBe('Corrected snapshot')
  expect(page.generation).not.toBe(orphan.generation)
})
it('does not apply legacy rollback/compaction/context events to paginated display history', async () => {
  const f = await fixture(), before = await f.pages.page(f.metadata, () => {}), prefix = await readFile(f.metadata.path)
  await f.append([
    nativeEvent('thread_rolled_back', { num_turns: 1 }), record('compacted', { message: 'Model summary', replacement_history: [rawUser('Replacement context').payload] }),
    rawAssistant('INTERNAL', 'analysis'), nativeEvent('user_message', { message: 'LEGACY COPY' }), nativeEvent('agent_message', { message: 'LEGACY COPY' }),
    materialized(f.metadata.id, 'first', { type: 'Reasoning', id: 'hidden', summary_text: ['PRIVATE'], raw_content: ['PRIVATE'] }),
    materialized(f.metadata.id, 'first', { type: 'AgentMessage', id: 'internal', content: [{ type: 'Text', text: 'INTERNAL' }], channel: 'analysis' }),
  ])
  const page = await f.restart().page(f.metadata, () => {})
  expect(visibleIds(page)).toEqual(visibleIds(before)); expect(page.messages).toBe(2)
  expect(JSON.stringify(page)).not.toMatch(/PRIVATE|INTERNAL|LEGACY/)
  expect((await readFile(f.metadata.path)).subarray(0, prefix.length)).toEqual(prefix)
  // A real paginated revert switches native lineage. Never silently expose only
  // a replacement suffix when a referenced prefix is not supported yet.
  const replacement = paginatedBootstrapRecords(f.metadata.id, f.metadata.cwd)
  replacement[0].payload.history_base = { thread_id: 'ancestor', end_ordinal_exclusive: 12 }
  await writeFile(f.metadata.path + '.replacement', serializeRecords(replacement))
  await rename(f.metadata.path + '.replacement', f.metadata.path)
  await expect(f.pages.page(f.metadata, () => {})).rejects.toThrow('no partial history')
})
it('bounds a synthetic huge canonical item before materialization and reads only authenticated detail ranges', async () => {
  const f = await fixture(), fd = await open(f.metadata.path, 'a')
  await fd.write(JSON.stringify({ timestamp: '2026-09-25T00:00:00.000Z', ordinal: f.rows.length, type: 'event_msg' }).slice(0, -1) + ',"payload":{"type":"item_completed","thread_id":"owned-thread","turn_id":"first","item":{"type":"AgentMessage","id":"giant","content":[{"type":"Text","text":"')
  const block = Buffer.alloc(65536, 120)
  for (let n = 0; n < 256; n++) await fd.write(block)
  await fd.write('"}],"phase":"final_answer"},"completed_at_ms":1}}\n'); await fd.close()
  const page = await f.pages.page(f.metadata, () => {}), giant = page.turns[0].items.at(-1)!
  expect(giant.id).toBe('giant'); expect(String(giant.text).length).toBeLessThanOrEqual(16384)
  const scan = f.source.metrics.indexBytes
  const first = await f.pages.detail(f.metadata, String(giant.historyDetail), 0, () => {})
  await f.pages.detail(f.metadata, String(giant.historyDetail), first.next!, () => {})
  expect(f.source.metrics.detailBytes).toBe(65536); expect(f.source.metrics.indexBytes).toBe(scan)
}, 90000)
it('refuses malformed/gapped ordinals and cross-thread canonical IDs rather than inventing identities', async () => {
  const f = await fixture()
  await appendFile(f.metadata.path, serializeRecords(withOrdinals([materializedAnswer(f.metadata.id, 'first', 'x', 'x')], f.rows.length + 1)))
  await expect(f.pages.page(f.metadata, () => {})).rejects.toThrow('ordinal')
  await writeFile(f.metadata.path, serializeRecords(f.rows))
  await f.append([materializedAnswer('other-thread', 'first', 'x', 'x')])
  await expect(f.pages.page(f.metadata, () => {})).rejects.toThrow('different native thread')
})
