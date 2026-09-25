import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, appendFile, open, readFile, rename, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { HistoryPages } from './history-pages.js'
import { RolloutHistory, historyItem } from './rollout-history.js'
const owned: string[] = []
afterEach(async () => { for (const dir of owned.splice(0)) await rm(dir, { recursive: true, force: true }) })
const row = (type: string, payload: unknown) => JSON.stringify({ type, payload }) + '\n'
const event = (type: string, payload: object = {}) => row('event_msg', { type, ...payload })
const item = (id: string, type: string, text = id, turn = 't') => {
  if (['userMessage', 'UserMessage', 'agentMessage', 'AgentMessage'].includes(type)) return event(type.toLowerCase() === 'usermessage' ? 'user_message' : 'agent_message', { message: text, images: [], local_images: [], phase: type.toLowerCase() === 'agentmessage' ? 'final_answer' : undefined })
  return event('item_completed', { turn_id: turn, item: { id, type, text } })
}
async function fixture(messages = 60, tools = 3) {
  const dir = await mkdtemp(join(tmpdir(), 'history-test-')); owned.push(dir)
  await mkdir(join(dir, 'sessions'))
  const metadata = { id: 'fake-thread', cwd: '/fake', path: join(dir, 'sessions', 'fake.jsonl') }
  const header = row('session_meta', { id: metadata.id, cwd: metadata.cwd }) + event('task_started', { turn_id: 't' })
  let body = header
  for (let n = 0; n < messages; n++) { body += item('m' + n, n % 2 ? 'agentMessage' : 'userMessage'); for (let k = 0; k < tools; k++) body += item(`tool${n}-${k}`, 'commandExecution', 'tool output') }
  body += event('task_complete', { turn_id: 't' })
  await writeFile(metadata.path, body)
  const source = new RolloutHistory(dir, join(dir, 'index')), pages = new HistoryPages('FAKE'.repeat(16), source)
  return { dir, metadata, header, source, pages, live: () => {} }
}
const ids = (page: Awaited<ReturnType<HistoryPages['page']>>) => page.turns.flatMap(t => t.items).filter(i => ['userMessage', 'agentMessage'].includes(i.type)).map(i => i.type === 'agentMessage' ? String(i.text) : String((i.content as Array<{ text: string }>)[0].text))
describe('read-only persisted native history windows', () => {
  it('counts exactly twenty messages, bounded tools, stable pages and persisted restart revision', async () => {
    const f = await fixture(61, 5), before = createHash('sha256').update(await readFile(f.metadata.path)).digest('hex')
    const first = await f.pages.page(f.metadata, f.live)
    expect(ids(first)).toEqual(Array.from({ length: 20 }, (_, n) => 'm' + (41 + n)))
    expect(first.scanned).toBe(80)
    expect(first.turns[0].items.some(i => i.type === 'historyTools')).toBe(true)
    const older = await f.pages.page(f.metadata, f.live, first.older!)
    expect(ids(older)).toEqual(Array.from({ length: 20 }, (_, n) => 'm' + (21 + n)))
    const all = [...ids(first), ...ids(older)]
    let cursor = older.older
    while (cursor) { const next = await f.pages.page(f.metadata, f.live, cursor); all.push(...ids(next)); cursor = next.older }
    expect(new Set(all).size).toBe(61); expect(all).toHaveLength(61)
    const scanned = f.source.metrics.indexBytes
    expect(await f.pages.page(f.metadata, f.live)).toEqual(first)
    expect(f.source.metrics.indexBytes).toBe(scanned)
    const restarted = new RolloutHistory(f.dir, join(f.dir, 'index'))
    expect(await new HistoryPages('FAKE'.repeat(16), restarted).page(f.metadata, f.live)).toEqual(first)
    expect(restarted.metrics.indexBytes).toBe(0)
    expect(createHash('sha256').update(await readFile(f.metadata.path)).digest('hex')).toBe(before)
  })
  it('indexes only append, waits for complete JSONL, and rejects stale cursors after rotation', async () => {
    const f = await fixture(), first = await f.pages.page(f.metadata, f.live), previousBytes = f.source.metrics.indexBytes
    const complete = item('fresh', 'agentMessage'), prefix = complete.slice(0, -5)
    await appendFile(f.metadata.path, prefix)
    expect(ids(await f.pages.page(f.metadata, f.live))).toEqual(ids(first))
    const partialBytes = f.source.metrics.indexBytes
    await f.pages.page(f.metadata, f.live); expect(f.source.metrics.indexBytes).toBe(partialBytes)
    await appendFile(f.metadata.path, complete.slice(-5))
    const latest = await f.pages.page(f.metadata, f.live)
    expect(ids(latest).at(-1)).toBe('fresh'); expect(latest.generation).toBe(first.generation)
    expect(f.source.metrics.indexBytes - previousBytes).toBeLessThan(1024)
    expect(ids(await f.pages.page(f.metadata, f.live, first.older!)).at(-1)).toBe('m39')
    await writeFile(f.metadata.path + '.next', f.header + item('replacement', 'agentMessage'))
    await rename(f.metadata.path + '.next', f.metadata.path)
    await expect(f.pages.page(f.metadata, f.live, first.older!)).rejects.toThrow('rewritten')
    expect(ids(await f.pages.page(f.metadata, f.live))).toEqual(['replacement'])
  })
  it('bounds an independent synthetic huge single record before materialization; detail reads ranges only', async () => {
    const f = await fixture(0, 0), fd = await open(f.metadata.path, 'a')
    await fd.write('{"type":"event_msg","payload":{"type":"agent_message","message":"')
    // Synthetic 16 MiB ONE item, separate from the 197 MB whole-transcript fixture.
    const block = Buffer.from('x'.repeat(65536))
    for (let n = 0; n < 256; n++) await fd.write(block)
    await fd.write('"}}\n'); await fd.close()
    const page = await f.pages.page(f.metadata, f.live), giant = page.turns[0].items[0]
    expect(String(giant.text).length).toBeLessThanOrEqual(16384)
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(25000)
    const scan = f.source.metrics.indexBytes
    const first = await f.pages.detail(f.metadata, String(giant.historyDetail), 0, f.live)
    const second = await f.pages.detail(f.metadata, String(giant.historyDetail), first.next!, f.live)
    expect(Buffer.byteLength(first.text)).toBe(32768); expect(second.offset).toBe(first.next)
    expect(f.source.metrics.detailBytes).toBe(65536); expect(f.source.metrics.indexBytes).toBe(scan)
    await expect(f.pages.detail({ ...f.metadata, id: 'other' }, String(giant.historyDetail), 0, f.live)).rejects.toThrow('cursor')
    await appendFile(f.metadata.path, event('thread_rolled_back', { num_turns: 1 }))
    await expect(f.pages.detail(f.metadata, String(giant.historyDetail), 0, f.live)).rejects.toThrow(/changed|rewritten/)
  }, 90000)
  it('uses display events once, ignoring model context/canonical copies and preserving interrupted status', async () => {
    const f = await fixture(0, 0)
    await appendFile(f.metadata.path, event('task_started', { turn_id: 'display' }) + row('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'not a UI message' }] }) +
      event('item_completed', { turn_id: 'display', item: { type: 'AgentMessage', id: 'native-copy', content: [{ type: 'Text', text: 'final' }] } }) +
      item('ignored-id', 'AgentMessage', 'final') + event('turn_aborted', { turn_id: 'display' }) + event('task_complete', { turn_id: 'display' }))
    const page = await f.pages.page(f.metadata, f.live)
    expect(ids(page)).toEqual(['final']); expect(page.turns[0].status).toBe('interrupted')
    expect(page.turns[0].items[0].id).toBe('item-1')
    expect(page.latestTurn?.status).toBe('interrupted')
  })
  it('validates thread/path/descriptor, signed cursors and cancellation with recoverable cache', async () => {
    const f = await fixture(), first = await f.pages.page(f.metadata, f.live)
    await expect(f.pages.page({ ...f.metadata, cwd: '/other' }, f.live)).rejects.toThrow('identity')
    await expect(f.pages.page(f.metadata, f.live, first.older! + 'x')).rejects.toThrow('cursor')
    const external = join(f.dir, 'outside.jsonl'); await writeFile(external, f.header)
    const link = join(f.dir, 'sessions', 'link.jsonl'); await symlink(external, link)
    await expect(f.pages.page({ ...f.metadata, path: link }, f.live)).rejects.toThrow('outside')
    let checks = 0
    await appendFile(f.metadata.path, item('later', 'agentMessage'))
    await expect(f.pages.page(f.metadata, () => { if (++checks > 5) throw Error('revoked') })).rejects.toThrow('revoked')
    expect(ids(await f.pages.page(f.metadata, f.live)).at(-1)).toBe('later')
  })
  it('retains valid renderer field types rather than recursively nulling nested values', () => {
    expect(historyItem({ type: 'UserMessage', content: [{ type: 'text', text: 'hi' }, { type: 'Image', url: 'do not embed' }] }, 'id').value).toEqual({ id: 'id', type: 'userMessage', content: [{ type: 'text', text: 'hi' }, { type: 'image' }] })
    expect(historyItem({ type: 'AgentMessage', content: [{ type: 'Text', text: 'Việt 😀' }] }, 'native').value).toMatchObject({ id: 'native', text: 'Việt 😀' })
    expect(historyItem({ type: 'FileChange', changes: [{ path: 'x', diff: 'x'.repeat(100000) }] }, 'file').value).toMatchObject({ id: 'file', changes: [] })
  })
})

it('bounds UTF-8 ranges, preserves tool records between messages and requires signed detail scope', async () => {
  const f = await fixture(25, 5), page = await f.pages.page(f.metadata, f.live)
  const summary = page.turns[0].items.find(i => i.type === 'historyTools')!
  let next: number | null = 0, count = 0
  while (next !== null) {
    const result = await f.pages.detail(f.metadata, String(summary.historyDetail), next, f.live)
    expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(32768)
    const parsed = JSON.parse(result.text)
    expect(parsed.payload.item.type).toBe('commandExecution')
    expect(result.next === null || result.next > result.offset).toBe(true)
    count++; next = result.next
  }
  expect(count).toBe(100) // 60 displayed + 40 summarized; no tool record lost.
  await appendFile(f.metadata.path, item('unicode', 'agentMessage', 'Việt 😀'.repeat(12000)))
  const changed = await f.pages.page(f.metadata, f.live), unicode = changed.turns.flatMap(t => t.items).find(i => String(i.text).startsWith('Việt'))!
  const first = await f.pages.detail(f.metadata, String(unicode.historyDetail), 0, f.live)
  const second = await f.pages.detail(f.metadata, String(unicode.historyDetail), first.next!, f.live)
  expect(first.text + second.text).not.toContain('\uFFFD')
  await expect(f.pages.detail(f.metadata, String(unicode.historyDetail), 1, f.live)).rejects.toThrow('position')
  await expect(f.pages.detail(f.metadata, page.older!, 0, f.live)).rejects.toThrow('item cursor')
})

it('rejects parent replacement after FD acquisition, then rebuilds from the new verified identity', async () => {
  const f = await fixture(), first = await f.pages.page(f.metadata, f.live)
  await expect(f.source.use(f.metadata, f.live, async view => {
    await rename(join(f.dir, 'sessions'), join(f.dir, 'sessions-original'))
    await mkdir(join(f.dir, 'sessions'))
    await writeFile(f.metadata.path, f.header + item('new-file', 'agentMessage'))
    return view.page()
  })).rejects.toThrow(/rotated|changed/)
  await expect(f.pages.page(f.metadata, f.live, first.older!)).rejects.toThrow('rewritten')
  expect(ids(await f.pages.page(f.metadata, f.live))).toEqual(['new-file'])
})
it('rebuilds safely after truncation and retains progress after cancellation, without writing native data', async () => {
  const f = await fixture(1000, 2)
  let checks = 0
  await expect(f.pages.page(f.metadata, () => { if (++checks === 30) throw Error('cancel') })).rejects.toThrow('cancel')
  expect(ids(await f.pages.page(f.metadata, f.live))).toHaveLength(20)
  const sourceBefore = await readFile(f.metadata.path)
  await expect(f.pages.page(f.metadata, () => { throw Error('expired') })).rejects.toThrow('expired')
  expect(await readFile(f.metadata.path)).toEqual(sourceBefore)
  await writeFile(f.metadata.path, f.header + item('only', 'agentMessage'))
  expect(ids(await f.pages.page(f.metadata, f.live))).toEqual(['only'])
})
it('does not mistake a persisted mid-scan cancellation checkpoint for an unchanged incomplete tail', async () => {
  const f = await fixture(4000, 4)
  await expect(f.pages.page(f.metadata, () => { if (f.source.metrics.indexBytes > 1500000) throw Error('cancel after checkpoint') })).rejects.toThrow('cancel after checkpoint')
  const restarted = new RolloutHistory(f.dir, join(f.dir, 'index'))
  const page = await new HistoryPages('FAKE'.repeat(16), restarted).page(f.metadata, f.live)
  expect(ids(page).at(-1)).toBe('m3999')
  expect(restarted.metrics.indexBytes).toBeGreaterThan(0)
  expect(restarted.metrics.rebuilds).toBe(0)
}, 90000)

// No production payloads: replay exactly the observed *structural* bootstrap.
// These assertions are pending execution via codex-heavy, not native parity proof.
it('maps bootstrap before turn_context/task_started without guessing a turn or counting context copies', async () => {
  const { bootstrapRecords, serializeRecords, rawUser, nativeStart, nativeUser, nativeAnswer, nativeComplete } = await import('./fixtures/native-history-order.mjs')
  const f = await fixture(0, 0), rows = bootstrapRecords(f.metadata.id, f.metadata.cwd)
  await writeFile(f.metadata.path, serializeRecords(rows.slice(0, 5)))
  const beforeStart = await f.pages.page(f.metadata, f.live)
  expect(beforeStart.turns).toEqual([]); expect(beforeStart.latestTurn).toBeUndefined()
  await appendFile(f.metadata.path, serializeRecords(rows.slice(5, 13)))
  // Persist across a process-style restart between context/canonical copy and
  // dedicated display event. No deferred raw text is held in RAM or checkpoint.
  const restarted = new HistoryPages('FAKE'.repeat(16), new RolloutHistory(f.dir, join(f.dir, 'index')))
  expect(ids(await restarted.page(f.metadata, f.live))).toEqual([])
  await appendFile(f.metadata.path, serializeRecords(rows.slice(13)))
  const first = await restarted.page(f.metadata, f.live)
  expect(first.turns.map(t => t.id)).toEqual(['first'])
  expect(ids(first)).toEqual(['First visible input', 'First visible answer'])
  expect(first.turns[0].items.map(i => i.id)).toEqual(['item-1', 'item-2'])
  await appendFile(f.metadata.path, serializeRecords([rawUser('Second visible input'), nativeStart('second'), nativeUser('Second visible input'), nativeAnswer('Second answer'), nativeComplete('second')]))
  const next = await restarted.page(f.metadata, f.live)
  expect(next.turns.map(t => [t.id, t.items.map(i => i.id)])).toEqual([['first', ['item-1', 'item-2']], ['second', ['item-3', 'item-4']]])
  // A fresh index and incrementally persisted index produce the same projection.
  const cold = await new HistoryPages('FAKE'.repeat(16), new RolloutHistory(f.dir, join(f.dir, 'cold-index'))).page(f.metadata, f.live)
  const values = (page: Awaited<ReturnType<HistoryPages['page']>>) => page.turns.map(t => ({ ...t, items: t.items.map(item => { const value = { ...item }; delete value.historyDetail; return value }) }))
  expect(values(cold)).toEqual(values(next))
})

it('keeps legacy implicit identities, compaction and cancelled/empty turns across restart', async () => {
  const f = await fixture(0, 0)
  await writeFile(f.metadata.path, row('session_meta', { id: f.metadata.id, cwd: f.metadata.cwd }) +
    row('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Imported model context' }] }) +
    event('user_message', { message: 'Imported visible input' }) + event('agent_message', { message: 'Imported answer' }) +
    row('compacted', { message: 'Model summary', replacement_history: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Do not inject summary as UI' }] }] }))
  const first = await f.pages.page(f.metadata, f.live)
  expect(first.turns[0].id).toBe('rollout-2')
  await appendFile(f.metadata.path, event('user_message', { message: 'Next imported input' }) +
    event('task_started', { turn_id: 'empty' }) + event('turn_aborted', { turn_id: 'empty' }) + event('task_complete', { turn_id: 'empty' }))
  const restarted = await new HistoryPages('FAKE'.repeat(16), new RolloutHistory(f.dir, join(f.dir, 'index'))).page(f.metadata, f.live)
  expect(restarted.turns.map(t => t.id)).toEqual(['rollout-2', 'rollout-5'])
  expect(ids(restarted)).toEqual(['Imported visible input', 'Imported answer', 'Next imported input'])
  expect(restarted.latestTurn).toEqual({ id: 'empty', status: 'interrupted' })
  await appendFile(f.metadata.path, row('compacted', { message: 'Only compaction' }))
  await f.pages.page(f.metadata, f.live)
  await appendFile(f.metadata.path, event('user_message', { message: 'Reuses compaction-only implicit turn' }))
  const compacted = await f.pages.page(f.metadata, f.live)
  expect(compacted.turns.at(-1)?.id).toBe('rollout-9')
})

it('excludes internal channels and reasoning without shifting native IDs across checkpoints', async () => {
  const f = await fixture(0, 0)
  await writeFile(f.metadata.path, f.header + event('user_message', { message: 'Visible' }) +
    row('response_item', { type: 'message', role: 'assistant', channel: 'analysis', content: [{ type: 'output_text', text: 'RAW INTERNAL' }] }) +
    event('agent_reasoning', { text: 'PRIVATE REASONING' }) + event('agent_reasoning_raw_content', { text: 'MORE PRIVATE' }))
  expect(ids(await f.pages.page(f.metadata, f.live))).toEqual(['Visible'])
  await appendFile(f.metadata.path, event('agent_message', { message: 'Visible final', phase: 'final_answer' }) +
    event('agent_message', { message: 'INTERNAL MESSAGE', channel: 'analysis' }) + event('agent_message', { message: 'Final after hidden', phase: 'final_answer' }))
  const page = await new HistoryPages('FAKE'.repeat(16), new RolloutHistory(f.dir, join(f.dir, 'index'))).page(f.metadata, f.live)
  expect(page.messages).toBe(3)
  expect(page.turns[0].items.map(i => i.id)).toEqual(['item-1', 'item-3', 'item-5'])
  expect(JSON.stringify(page)).not.toMatch(/PRIVATE|INTERNAL/)
})

it('applies native rollback to derived turns only, invalidates cursors, and ignores late orphan tool replies', async () => {
  const f = await fixture(21, 0), original = await f.pages.page(f.metadata, f.live)
  await appendFile(f.metadata.path, event('task_started', { turn_id: 'removed' }) + item('remove', 'agentMessage') + event('task_complete', { turn_id: 'removed' }))
  const beforeRollback = await readFile(f.metadata.path)
  await appendFile(f.metadata.path, event('thread_rolled_back', { num_turns: 1 }) + item('late-tool', 'commandExecution', 'late', 'removed'))
  await expect(f.pages.page(f.metadata, f.live, original.older!)).rejects.toThrow('rewritten')
  const page = await f.pages.page(f.metadata, f.live)
  expect(ids(page)).toEqual(ids(original)); expect(page.latestTurn?.id).toBe('t')
  expect(JSON.stringify(page)).not.toContain('late-tool')
  expect((await readFile(f.metadata.path)).subarray(0, beforeRollback.length)).toEqual(beforeRollback)
  await appendFile(f.metadata.path, event('task_started', { turn_id: 'fresh' }) + item('after rollback', 'agentMessage'))
  const fresh = await new HistoryPages('FAKE'.repeat(16), new RolloutHistory(f.dir, join(f.dir, 'index'))).page(f.metadata, f.live)
  expect(fresh.turns.at(-1)?.items.at(-1)?.id).toBe('item-22')
})

it('does not return incomplete child/fork history when metadata requires an unresolved source prefix', async () => {
  const f = await fixture(0, 0)
  await writeFile(f.metadata.path, row('session_meta', { id: f.metadata.id, cwd: f.metadata.cwd, history_base: { thread_id: 'parent', ordinal: 20 } }) + event('user_message', { message: 'Only child suffix' }))
  await expect(f.pages.page(f.metadata, f.live)).rejects.toThrow('no partial history')
  await writeFile(f.metadata.path, row('session_meta', { id: f.metadata.id, cwd: f.metadata.cwd, subagent_history_start_ordinal: 20 }) + event('user_message', { message: 'Inherited model context must not leak into child display' }))
  await expect(f.pages.page(f.metadata, f.live)).rejects.toThrow('no partial history')
})

it('keeps pre-turn native hook prompts as tools rather than fabricated user inputs', async () => {
  const f = await fixture(0, 0)
  await writeFile(f.metadata.path, row('session_meta', { id: f.metadata.id, cwd: f.metadata.cwd }) +
    row('response_item', { type: 'message', role: 'user', id: 'hook-1', content: [{ type: 'input_text', text: '<hook_prompt hook_run_id="owned-hook">Fixture hook</hook_prompt>' }] }) + event('task_started', { turn_id: 'real' }) + item('Real input', 'userMessage'))
  const page = await f.pages.page(f.metadata, f.live)
  expect(page.messages).toBe(1); expect(ids(page)).toEqual(['Real input'])
  expect(page.turns[0].id).toBe('rollout-1')
  expect(page.turns[0].items[0]).toMatchObject({ id: 'hook-1', type: 'historyTool' })
  expect(page.turns[1].items[0].id).toBe('item-1')
})
