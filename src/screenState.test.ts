import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearScreenState, flushScreenState, readScreenState, writeScreenState } from './screenState'

describe('persistent screen metadata', () => {
  beforeEach(() => {
    vi.useRealTimers()
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    })
    clearScreenState()
  })

  it('keeps independent drafts, preview, scroll and zoom without raw file data', () => {
    writeScreenState('drafts', { A: 'Draft A', B: 'Draft B' })
    writeScreenState('file-viewer', { path: '/workspace/contract.docx' })
    writeScreenState('docx:/workspace/contract.docx:zoom', 1.4)
    writeScreenState('docx:/workspace/contract.docx:scroll', { top: 1500, left: 20 })
    flushScreenState()
    expect(readScreenState('drafts', {})).toEqual({ A: 'Draft A', B: 'Draft B' })
    expect(readScreenState('file-viewer', null)).toEqual({ path: '/workspace/contract.docx' })
    expect(localStorage.getItem('codex-remote:screen:v1')).toContain('1500')
  })

  it('flushes the latest change immediately before leaving and removes pending writes on logout', () => {
    vi.useFakeTimers()
    writeScreenState('drafts', { A: 'First' })
    writeScreenState('drafts', { A: 'Latest' })
    flushScreenState()
    expect(localStorage.getItem('codex-remote:screen:v1')).toContain('Latest')
    writeScreenState('file-viewer', { path: '/private.docx' })
    clearScreenState()
    vi.runAllTimers()
    expect(readScreenState('file-viewer', null)).toBeNull()
    expect(localStorage.getItem('codex-remote:screen:v1')).toBeNull()
  })

  it('expires old state and tolerates unavailable device storage', () => {
    vi.useFakeTimers()
    writeScreenState('draft', 'Private')
    vi.advanceTimersByTime(8 * 24 * 60 * 60_000)
    expect(readScreenState('draft', '')).toBe('')
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('Quota exceeded') } })
    expect(() => { writeScreenState('draft', 'Still in memory'); flushScreenState() }).not.toThrow()
    expect(readScreenState('draft', '')).toBe('Still in memory')
  })

  it('ignores corrupt drafts and preview state instead of crashing the app', () => {
    writeScreenState('drafts', null)
    writeScreenState('file-viewer', { path: null })
    writeScreenState('command-notice', { title: 'Bad cache', lines: [null] })
    writeScreenState('drawer', 'true')
    expect(readScreenState('drafts', {})).toEqual({})
    expect(readScreenState('file-viewer', null)).toBeNull()
    expect(readScreenState('command-notice', null)).toBeNull()
    expect(readScreenState('drawer', false)).toBe(false)
  })
})
