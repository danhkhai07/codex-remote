import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, appendFile, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { HistoryPages } from './history-pages.js'
import { RolloutHistory } from './rollout-history.js'

const owned: string[] = []
afterEach(async () => { for (const root of owned.splice(0)) await rm(root, { recursive: true, force: true }) })
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'independent-history-')); owned.push(root)
  await mkdir(join(root, 'sessions'))
  const metadata = { id: 'owned-review', cwd: '/owned-fixture', path: join(root, 'sessions', 'owned.jsonl') }
  let ordinal = 0
  const row = (type: string, payload: object) => JSON.stringify({ ordinal: ordinal++, type, payload }) + '\n'
  await writeFile(metadata.path, row('session_meta', { id: metadata.id, cwd: metadata.cwd, history_mode: 'paginated', history_base: null, subagent_history_start_ordinal: null }))
  const add = async (turn: string, id: string, text = id, type = 'AgentMessage') => appendFile(metadata.path, row('event_msg', {
    type: 'item_completed', thread_id: metadata.id, turn_id: turn, item: { id, type, phase: 'final_answer', content: [{ type: 'Text', text }] },
  }))
  const event = async (type: string, payload: object) => appendFile(metadata.path, row('event_msg', { type, ...payload }))
  const source = new RolloutHistory(root, join(root, 'index')), pages = new HistoryPages('independent-fake-secret', source)
  return { root, metadata, add, event, source, pages }
}
const ids = (page: Awaited<ReturnType<HistoryPages['page']>>) => page.turns.flatMap(t => t.items).filter(i => i.type === 'agentMessage').map(i => i.id)

it('independent: partitions an odd message count across one native turn with tool overflow and no lost IDs', async () => {
  const f = await fixture()
  await f.event('task_started', { turn_id: 'same-turn' })
  for (let n = 0; n < 43; n++) {
    await f.add('same-turn', 'm' + n)
    for (let k = 0; k < 4; k++) await f.add('same-turn', `tool-${n}-${k}`, 'output', 'CommandExecution')
  }
  await f.event('task_complete', { turn_id: 'same-turn' })
  const original = digest(await readFile(f.metadata.path))
  let page = await f.pages.page(f.metadata, () => {})
  const all: string[] = [], counts: number[] = []
  while (true) {
    counts.push(page.messages); all.unshift(...ids(page))
    expect(page.turns[0].id).toBe('same-turn')
    expect(page.turns[0].status).toBe('completed')
    if (!page.older) break
    page = await f.pages.page(f.metadata, () => {}, page.older)
  }
  expect(counts).toEqual([20, 20, 3]); expect(all).toEqual(Array.from({ length: 43 }, (_, n) => 'm' + n))
  expect(digest(await readFile(f.metadata.path))).toBe(original)
})

it('independent: a completed duplicate keeps its ID/position, invalidates cursors and persists through checkpoint reopen', async () => {
  const f = await fixture()
  for (let n = 0; n < 25; n++) await f.add('explicit-orphan', 'm' + n)
  const before = await f.pages.page(f.metadata, () => {})
  expect(before.turns[0].status).toBe('unknown')
  await f.event('task_started', { turn_id: 'explicit-orphan' })
  await f.event('turn_aborted', { turn_id: 'explicit-orphan' })
  await f.event('task_complete', { turn_id: 'explicit-orphan' })
  await f.add('explicit-orphan', 'm24', 'updated completed snapshot')
  const reopened = new HistoryPages('independent-fake-secret', new RolloutHistory(f.root, join(f.root, 'index')))
  await expect(reopened.page(f.metadata, () => {}, before.older!)).rejects.toThrow('rewritten')
  const after = await reopened.page(f.metadata, () => {})
  expect(after.turns[0].status).toBe('interrupted')
  expect(ids(after)).toEqual(ids(before)); expect(after.turns[0].items.at(-1)?.text).toBe('updated completed snapshot')
  const original = digest(await readFile(f.metadata.path))
  await expect(reopened.page({ ...f.metadata, id: 'other' }, () => {})).rejects.toThrow('identity')
  expect(digest(await readFile(f.metadata.path))).toBe(original)
})

it('independent: withdrawn authority rejects queued and completed read results, without persisting source changes', async () => {
  const f = await fixture(); await f.add('t', 'm')
  let release!: () => void, entered!: () => void, allowed = true
  const begun = new Promise<void>(resolve => { entered = resolve }), blocked = new Promise<void>(resolve => { release = resolve })
  const first = f.source.use(f.metadata, () => {}, async () => { entered(); await blocked; return 1 })
  await begun
  const denied = f.pages.page(f.metadata, () => { if (!allowed) throw Error('withdrawn') })
  const assertion = expect(denied).rejects.toThrow('withdrawn')
  allowed = false; release(); await first; await assertion
  const original = digest(await readFile(f.metadata.path))
  await expect(f.source.use(f.metadata, () => { if (!allowed) throw Error('withdrawn') }, () => 1)).rejects.toThrow('withdrawn')
  allowed = true
  await expect(f.source.use(f.metadata, () => { if (!allowed) throw Error('withdrawn') }, () => { allowed = false; return 'must not escape' })).rejects.toThrow('withdrawn')
  expect(digest(await readFile(f.metadata.path))).toBe(original)
})
