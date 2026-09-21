import type { IncomingMessage } from 'node:http'
import { expect, it } from 'vitest'
import { requestIp } from './request-ip.js'
const req = (peer: string, headers: Record<string, string>) => ({ socket: { remoteAddress: peer }, headers }) as IncomingMessage
it('only trusts a single valid IP from an exact configured proxy peer', () => {
  const spoof = { 'x-real-ip': '192.0.2.99', 'x-forwarded-for': '192.0.2.66', 'cf-connecting-ip': '192.0.2.88' }
  expect(requestIp(req('198.51.100.4', spoof), ['127.0.0.1'])).toBe('198.51.100.4')
  expect(requestIp(req('127.0.0.1', spoof))).toBe('127.0.0.1')
  expect(requestIp(req('::ffff:127.0.0.1', spoof), ['127.0.0.1'])).toBe('192.0.2.99')
  for (const bad of ['192.0.2.1, 192.0.2.2', 'garbage', ' 192.0.2.1', '192.0.2.1:123']) expect(requestIp(req('127.0.0.1', { ...spoof, 'x-real-ip': bad }), ['127.0.0.1'])).toBe('127.0.0.1')
})
