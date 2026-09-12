import { describe, expect, it } from 'vitest'
import { observeMessages, restoreUnread } from './unread'

describe('unread messages', () => {
  it('establishes a baseline without marking old history unread', () => {
    expect(observeMessages(undefined, ['t:a', 't:b'], false, 1).unread).toEqual([])
  })
  it('counts distinct new replies and deduplicates live events against history', () => {
    let entry = observeMessages(undefined, ['t:a'], false, 1)
    entry = observeMessages(entry, ['t:b'], false)
    entry = observeMessages(entry, ['t:b'], false)
    entry = observeMessages(entry, ['t:a', 't:b', 't:c'], false, 2)
    expect(entry.unread).toEqual(['t:b', 't:c'])
  })
  it('keeps a live message that arrives during the baseline scan', () => {
    const entry = observeMessages(undefined, ['t:new'], false)
    expect(observeMessages(entry, ['t:old', 't:new'], false, 1).unread).toEqual(['t:new'])
  })
  it('clears on reading and does not restore the badge after a replay', () => {
    let entry = observeMessages(undefined, ['t:a'], false, 1)
    entry = observeMessages(entry, ['t:b'], false)
    entry = observeMessages(entry, [], true)
    expect(entry.unread).toEqual([])
    expect(observeMessages(entry, ['t:a', 't:b'], false, 2).unread).toEqual([])
    expect(observeMessages(entry, ['t:c'], true).unread).toEqual([])
  })
  it('recovers replies received while the app was closed from persisted IDs', () => {
    const entry = observeMessages(undefined, ['t:a'], false, 1)
    const restored = restoreUnread(JSON.parse(JSON.stringify({ chat: entry })))
    expect(observeMessages(restored.chat, ['t:a', 't:b', 't:c', 't:d'], false, 2).unread).toHaveLength(3)
  })
  it('ignores malformed device state', () => {
    expect(restoreUnread({ chat: { known: 42, unread: null }, other: null })).toEqual({})
    expect(restoreUnread(null)).toEqual({})
  })
})
