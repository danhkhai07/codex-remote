import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WorkPresence } from './work-presence.js'
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'screen-time-')); dirs.push(dir)
  const file = join(dir, 'events.jsonl'); let now = 100_000
  const tracker = new WorkPresence(file, () => now)
  return { tracker, advance: (ms: number) => { now += ms }, records: () => readFileSync(file, 'utf8').trim().split('\n').map(s => JSON.parse(s)) }
}
it('records visible reading without interaction, flushes on hide, and never fills a suspended gap', () => {
  const f = fixture(), body = { clientId: 'tab-1', visible: true, processing: false }
  f.tracker.report('owner', body); f.advance(15_000); f.tracker.report('owner', body)
  f.advance(5000); f.tracker.report('owner', { ...body, visible: false })
  f.advance(60_000); f.tracker.report('owner', body)
  expect(f.records().filter(r => r.kind === 'screen')).toEqual([
    { kind: 'screen', start: 100_000, end: 115_000, visible: true, processing: false },
    { kind: 'screen', start: 115_000, end: 120_000, visible: true, processing: false },
  ])
})
it('keeps overlapping Codex turns processing until all finish', () => {
  const f = fixture()
  f.tracker.processing('a', '1', true); f.tracker.processing('b', '2', true)
  f.tracker.processing('a', '1', false); f.tracker.processing('b', '2', false)
  expect(f.records().filter(r => r.kind === 'processing').map(r => r.active)).toEqual([true, true, true, false])
})
it('isolates clients and rejects malformed input without accepting browser timestamps', () => {
  const f = fixture(), body = { clientId: 'same-id', visible: true, processing: false }
  f.tracker.report('one', body); f.advance(1000); f.tracker.report('two', body)
  expect(f.records()).toHaveLength(1)
  expect(() => f.tracker.report('one', { ...body, visible: 'true' })).toThrow('Invalid screen presence')
  f.advance(1000); f.tracker.report('one', { ...body, start: 0, end: 99999999 })
  expect(f.records()[1].start).toBe(100000)
})
