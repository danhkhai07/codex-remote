// Baseline design controls, not acceptance of a not-yet-integrated share feature.
import { afterEach, expect, it, vi } from 'vitest'
import { ServicesStore } from '../server/services.js'

afterEach(() => vi.useRealTimers())
const service = { port: 5210, name: 'Fixture', summary: 'Isolated fixture', prLabel: 'No PR', path: '/' }

it('demonstrates that updatedAt plus metadata cannot identify a service incarnation', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-27T00:00:00.000Z'))
  const store = new ServicesStore()
  const first = store.upsert(service)
  store.remove('port:5210')
  const recreated = store.upsert(service)
  expect(recreated).toEqual(first)
  expect(store.list()).toEqual([first])
})

it('demonstrates that registry validity is broader than the configured public-host inventory', () => {
  const store = new ServicesStore(undefined, undefined, [5174])
  expect(store.upsert({ ...service, port: 65000 }).port).toBe(65000)
  expect(() => store.upsert({ ...service, port: 5174 })).toThrow('Codex Remote')
  expect(store.upsert({ ...service, port: null, path: '/files' }).port).toBeNull()
  // Public-share eligibility must be a separate intersection, not store.list().
})

it('demonstrates that a probed snapshot can become stale while awaiting listeners', async () => {
  let release!: (value: boolean) => void
  const store = new ServicesStore(undefined, () => new Promise<boolean>(resolve => { release = resolve }))
  store.upsert(service)
  const pending = store.snapshot()
  store.remove('port:5210'); release(true)
  expect((await pending).services).toHaveLength(1)
  expect(store.list()).toEqual([])
  // A create-share operation must re-read identity after any await and before save.
})
