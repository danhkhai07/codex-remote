import type { PreviewShare } from './api'

export const PREVIEW_SHARE_LIFETIMES = [
  { seconds: 15 * 60, label: '15 phút' },
  { seconds: 60 * 60, label: '1 giờ' },
  { seconds: 6 * 60 * 60, label: '6 giờ' },
  { seconds: 24 * 60 * 60, label: '24 giờ' },
] as const

export type ServerClock = { serverAt: number; clientAt: number }

export function serverClock(serverNow: string, clientAt = Date.now()): ServerClock {
  const parsed = Date.parse(serverNow)
  return { serverAt: Number.isFinite(parsed) ? parsed : clientAt, clientAt }
}

export function clockNow(clock: ServerClock, clientNow = Date.now()) {
  return clock.serverAt + Math.max(0, clientNow - clock.clientAt)
}

export function previewShareIsActive(link: PreviewShare, now: number) {
  return link.status === 'active' && Date.parse(link.expiresAt) > now
}

export function previewShareTimeLeft(expiresAt: string, now: number) {
  const milliseconds = Date.parse(expiresAt) - now
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 'Đã hết hạn'
  const minutes = Math.max(1, Math.ceil(milliseconds / 60_000))
  if (minutes < 60) return `Còn ${minutes} phút`
  const hours = Math.floor(minutes / 60), remainder = minutes % 60
  return remainder ? `Còn ${hours} giờ ${remainder} phút` : `Còn ${hours} giờ`
}

export function previewShareStatusLabel(link: PreviewShare, now: number) {
  if (link.status === 'revoked') return 'Đã ngắt'
  if (link.status === 'unavailable') return 'Dịch vụ không khả dụng'
  if (!previewShareIsActive(link, now)) return 'Đã hết hạn'
  return previewShareTimeLeft(link.expiresAt, now)
}
