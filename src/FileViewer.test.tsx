import { describe, expect, it } from 'vitest'
import { formatFileSize, formatFileType, resolveMarkdownFileReference, supportsNativeFileShare } from './FileViewer'

describe('FileViewer helpers', () => {
  it('formats server file sizes for compact metadata', () => {
    expect(formatFileSize(42)).toBe('42 B')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB')
  })

  it('labels familiar formats in metadata', () => {
    expect(formatFileType({ contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', extension: '.pptx', kind: 'pptx' })).toBe('Microsoft PowerPoint presentation')
    expect(formatFileType({
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: '.docx',
      kind: 'download',
    })).toBe('Microsoft Word document')
    expect(formatFileType({ contentType: 'text/plain; charset=utf-8', extension: '.md', kind: 'text' })).toBe('Markdown document')
  })

  it('falls back safely when native file sharing is unavailable', () => {
    expect(supportsNativeFileShare({ name: 'contract.docx', size: 18_000, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBe(false)
  })

  it('resolves sibling Markdown links inside the workspace', () => {
    expect(resolveMarkdownFileReference('02-QUOTE.md', '/root/contracts/01-CONTRACT.md')).toEqual({ path: '/root/contracts/02-QUOTE.md' })
    expect(resolveMarkdownFileReference('../README.md#L12', '/root/contracts/01-CONTRACT.md')).toEqual({ path: '/root/README.md', line: 12 })
    expect(resolveMarkdownFileReference('https://example.com', '/root/contracts/01-CONTRACT.md')).toBeNull()
  })
})
