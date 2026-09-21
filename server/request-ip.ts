import type { IncomingMessage } from 'node:http'
import { isIP } from 'node:net'
const normalized = (value: string) => value.startsWith('::ffff:') && isIP(value.slice(7)) === 4 ? value.slice(7) : value.toLowerCase()
/** The named proxy must overwrite X-Real-IP. Never walk attacker-controlled forwarding chains. */
export function requestIp(req: IncomingMessage, trustedProxies: string[] = []): string {
  const peer = normalized(req.socket.remoteAddress ?? 'unknown')
  if (!trustedProxies.some(ip => normalized(ip) === peer)) return peer
  const forwarded = req.headers['x-real-ip']
  return typeof forwarded === 'string' && isIP(forwarded) ? normalized(forwarded) : peer
}
