import { describe, expect, it, vi, afterEach } from 'vitest'
import { parsePinnedFiles } from './pinnedFiles'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('pinned files', () => {
  it('restores valid absolute paths and removes duplicate or malformed entries', () => {
    expect(parsePinnedFiles(JSON.stringify([
      { path: '/root/Working Hours', kind: 'directory' },
      { path: '/root/index.html', kind: 'file' },
      { path: '/root/index.html', kind: 'file' },
      { path: 'relative', kind: 'file' }, null, { path: '/root', kind: 'unavailable' },
    ]))).toEqual([{ path: '/root/Working Hours', kind: 'directory' }, { path: '/root/index.html', kind: 'file' }])
    expect(parsePinnedFiles('{broken')).toEqual([])
    expect(parsePinnedFiles('{}')).toEqual([])
  })

  it('persists pins, restores them after reload, and removes only the selected path', async () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
    const { togglePinnedFile } = await import('./pinnedFiles')
    togglePinnedFile({ path: '/root/folder', kind: 'directory' })
    togglePinnedFile({ path: '/root/file.html', kind: 'file' })
    vi.resetModules()
    const reloaded = await import('./pinnedFiles')
    reloaded.togglePinnedFile({ path: '/root/folder', kind: 'directory' })
    expect(parsePinnedFiles([...values.values()][0])).toEqual([{ path: '/root/file.html', kind: 'file' }])
  })
})
