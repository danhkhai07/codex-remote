import { describe, expect, it } from 'vitest'
import { shouldKeepEventStream } from './eventStream'

describe('background event stream policy', () => {
  it('stays live while visible or working and sleeps only when hidden and idle', () => {
    expect(shouldKeepEventStream(true, null)).toBe(true)
    expect(shouldKeepEventStream(false, 'turn-active')).toBe(true)
    expect(shouldKeepEventStream(false, null)).toBe(false)
  })
})
