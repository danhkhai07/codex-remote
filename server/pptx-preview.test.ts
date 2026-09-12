import { describe, expect, it, vi } from 'vitest'
import { PptxPreviewCache } from './pptx-preview.js'
import type { ServerFileInfo } from './server-files.js'

const file: ServerFileInfo = { path: '/workspace/slides.pptx', name: 'slides.pptx', extension: '.pptx', kind: 'pptx', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', size: 42, previewable: true, createdAt: '2026-09-12', modifiedAt: '2026-09-12' }
describe('PPTX preview cache', () => {
  it('coalesces requests and reuses results until the source changes', async () => {
    const convert = vi.fn(async () => Buffer.from('%PDF-test'))
    const cache = new PptxPreviewCache(convert)
    const results = await Promise.all([cache.get(file), cache.get(file)])
    expect(results[0]).toEqual(results[1])
    await cache.get(file)
    expect(convert).toHaveBeenCalledTimes(1)
    await cache.get({ ...file, modifiedAt: '2026-09-13' })
    expect(convert).toHaveBeenCalledTimes(2)
  })
  it('limits concurrent conversion and allows retry after failure', async () => {
    let reject!: (error: Error) => void
    const convert = vi.fn(() => new Promise<Buffer>((_resolve, fail) => { reject = fail }))
    const cache = new PptxPreviewCache(convert)
    const pending = cache.get(file)
    await expect(cache.get({ ...file, path: '/workspace/other.pptx' })).rejects.toMatchObject({ status: 429 })
    reject(new Error('failed'))
    await expect(pending).rejects.toThrow('failed')
    convert.mockResolvedValueOnce(Buffer.from('%PDF-ok'))
    await expect(cache.get(file)).resolves.toEqual(Buffer.from('%PDF-ok'))
  })
  it('rejects oversized and wrong-format inputs without invoking conversion', async () => {
    const convert = vi.fn()
    const cache = new PptxPreviewCache(convert)
    await expect(cache.get({ ...file, size: 21 * 1024 * 1024 })).rejects.toMatchObject({ status: 413 })
    await expect(cache.get({ ...file, kind: 'download' })).rejects.toMatchObject({ status: 415 })
    expect(convert).not.toHaveBeenCalled()
  })
  it('evicts older previews after three entries', async () => {
    const convert = vi.fn(async () => Buffer.from('%PDF-test'))
    const cache = new PptxPreviewCache(convert)
    for (let n = 0; n < 4; n++) await cache.get({ ...file, path: `/workspace/${n}.pptx` })
    await cache.get({ ...file, path: '/workspace/0.pptx' })
    expect(convert).toHaveBeenCalledTimes(5)
  })
})
