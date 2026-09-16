import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ReadStateStore } from './read-state.js'

it('shares receipts, survives restart, and does not revive read replies on replay', () => {
  const directory = mkdtempSync(join(tmpdir(), 'reply-read-test-'))
  try {
    const file = join(directory, 'state.json')
    const changed: number[] = []
    const store = new ReadStateStore(file, () => changed.push(1))
    expect(store.observe('chat', ['reply:old']).unread).toEqual({})
    store.observe('chat', ['reply:new'], true)
    const deviceA = store.snapshot(), deviceB = store.snapshot()
    expect(deviceA.unread).toEqual(deviceB.unread)
    store.acknowledge('chat', deviceA.unread.chat)
    const restored = new ReadStateStore(file)
    expect(restored.snapshot().unread).toEqual({})
    expect(restored.observe('chat', ['reply:new'], true).unread).toEqual({})
    expect(restored.observe('chat', ['reply:old', 'reply:new', 'reply:offline']).unread).toEqual({ chat: ['reply:offline'] })
    expect(changed).toHaveLength(3)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

it('an old device receipt cannot clear a newer reply or another conversation', () => {
  const store = new ReadStateStore()
  store.observe('a', [], false)
  store.observe('a', ['reply:first'], true)
  const stale = store.snapshot()
  store.observe('a', ['reply:second'], true)
  store.observe('b', ['reply:other'], true)
  expect(store.acknowledge('a', stale.unread.a).unread).toEqual({ a: ['reply:second'], b: ['reply:other'] })
  expect(store.acknowledge('a', stale.unread.a).unread.a).toEqual(['reply:second'])
})

it('keeps a live reply received before the initial history scan', () => {
  const store = new ReadStateStore()
  store.observe('a', ['reply:new'], true)
  expect(store.observe('a', ['reply:old', 'reply:new']).unread).toEqual({ a: ['reply:new'] })
})
