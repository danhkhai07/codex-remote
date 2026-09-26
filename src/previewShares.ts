import type { PreviewShare } from './api'

export const PREVIEW_SHARE_LIFETIMES = [
  { seconds: 15 * 60, label: '15 minutes' },
  { seconds: 60 * 60, label: '1 hour' },
  { seconds: 6 * 60 * 60, label: '6 hours' },
  { seconds: 24 * 60 * 60, label: '24 hours' },
] as const
export const PREVIEW_SHARE_PATH_MAX_BYTES = 1024

export function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength
}

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
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 'Expired'
  const minutes = Math.max(1, Math.ceil(milliseconds / 60_000))
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left`
  const hours = Math.floor(minutes / 60), remainder = minutes % 60
  const hoursLabel = `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  const minutesLabel = `${remainder} ${remainder === 1 ? 'minute' : 'minutes'}`
  return remainder ? `${hoursLabel} ${minutesLabel} left` : `${hoursLabel} left`
}

export function previewShareStatusLabel(link: PreviewShare, now: number) {
  if (link.status === 'revoked') return 'Revoked'
  if (link.status === 'unavailable') return 'Service unavailable'
  if (!previewShareIsActive(link, now)) return 'Expired'
  return previewShareTimeLeft(link.expiresAt, now)
}
