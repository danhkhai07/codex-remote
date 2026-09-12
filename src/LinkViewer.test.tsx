import { describe, expect, it } from 'vitest'
import { safeWebUrl } from './LinkViewer'

describe('LinkViewer helpers', () => {
  it('accepts web links and rejects unsafe or malformed protocols', () => {
    expect(safeWebUrl('https://example.com/path')?.hostname).toBe('example.com')
    expect(safeWebUrl('http://localhost:5173/docs')?.protocol).toBe('http:')
    expect(safeWebUrl('javascript:alert(1)')).toBeNull()
    expect(safeWebUrl('not a url')).toBeNull()
  })
})
