import { describe, expect, it } from 'vitest'
import { parseBrowserAddress } from './browserAddress'

describe('Browser address', () => {
  const origin = 'https://codex.example.test'
  it('resolves internal pages, explicit websites and VPS localhost independently', () => {
    expect(parseBrowserAddress('/working-hours', origin)).toEqual({ kind: 'web', url: origin + '/working-hours' })
    expect(parseBrowserAddress('/services?q=kiot#review', origin)).toEqual({ kind: 'web', url: origin + '/services?q=kiot#review' })
    for (const url of ['https://example.com/app', 'http://example.com/app']) expect(parseBrowserAddress(url, origin)).toEqual({ kind: 'web', url })
    expect(parseBrowserAddress('5183', origin)).toEqual({ kind: 'localhost', local: { port: 5183, path: '/' } })
    expect(parseBrowserAddress('http://localhost:5194/editor?a=1', origin)).toEqual({ kind: 'localhost', local: { port: 5194, path: '/editor?a=1' } })
  })
  it('rejects executable schemes, protocol-relative URLs and embedded credentials', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,hi', '//evil.test', '/\\evil.test', 'file:///etc/passwd', 'https://user:secret@example.com', '/a\nb', 'hello', '']) expect(parseBrowserAddress(value, origin)).toBeNull()
  })
})
