import { describe, expect, it } from 'vitest'
import type { PreviewShare } from './api'
import { PREVIEW_SHARE_PATH_MAX_BYTES, clockNow, previewShareIsActive, previewShareStatusLabel, previewShareTimeLeft, serverClock, utf8ByteLength } from './previewShares'

const link = (overrides: Partial<PreviewShare> = {}): PreviewShare => ({
  id: 'share', label: 'Demo', serviceName: 'Preview', port: 4173, path: '/',
  createdAt: '2026-09-27T00:00:00.000Z', expiresAt: '2026-09-27T01:00:00.000Z',
  revokedAt: null, status: 'active', url: 'https://share.invalid/#token', ...overrides,
})

describe('preview share presentation', () => {
  it('uses server time and advances it without network polling', () => {
    const clock = serverClock('2026-09-27T00:00:00.000Z', 10_000)
    expect(clockNow(clock, 40_000)).toBe(Date.parse('2026-09-27T00:00:30.000Z'))
    expect(previewShareTimeLeft('2026-09-27T01:00:00.000Z', clockNow(clock, 40_000))).toBe('Còn 1 giờ')
  })

  it('moves elapsed active links to closed history and keeps explicit states', () => {
    const before = Date.parse('2026-09-27T00:59:00.000Z'), after = Date.parse('2026-09-27T01:00:00.000Z')
    expect(previewShareIsActive(link(), before)).toBe(true)
    expect(previewShareIsActive(link(), after)).toBe(false)
    expect(previewShareStatusLabel(link(), after)).toBe('Đã hết hạn')
    expect(previewShareStatusLabel(link({ status: 'revoked' }), before)).toBe('Đã ngắt')
    expect(previewShareStatusLabel(link({ status: 'unavailable' }), before)).toBe('Dịch vụ không khả dụng')
  })

  it('reports short and mixed remaining durations without rounding to zero', () => {
    const now = Date.parse('2026-09-27T00:00:00.000Z')
    expect(previewShareTimeLeft('2026-09-27T00:00:01.000Z', now)).toBe('Còn 1 phút')
    expect(previewShareTimeLeft('2026-09-27T02:15:00.000Z', now)).toBe('Còn 2 giờ 15 phút')
  })

  it('counts the backend path limit in UTF-8 bytes without truncating text', () => {
    expect(utf8ByteLength('/demo')).toBe(5)
    expect(utf8ByteLength('/' + 'đ'.repeat(512))).toBe(PREVIEW_SHARE_PATH_MAX_BYTES + 1)
  })
})
