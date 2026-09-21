import type { IncomingMessage } from 'node:http'
/** Explicit request context; never inherits into scheduler/background jobs. */
const guards = new WeakMap<IncomingMessage, () => void>()
export const requestLifetime = (req: IncomingMessage) => guards.get(req)
export const bindRequestLifetime = (req: IncomingMessage, guard: () => void) => { guards.set(req, guard) }
export const assertRequestLive = (req: IncomingMessage) => guards.get(req)?.()
