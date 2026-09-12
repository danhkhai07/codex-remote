import { createReadStream, promises as fs } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import type { ViteDevServer } from 'vite'
import {
  clearSessionCookie,
  createSession,
  getSession,
  passwordMatches,
  setSessionCookie,
} from './auth.js'
import type { RemoteConfig } from './config.js'
import type { RemoteController } from './controller.js'
import { LoginRateLimiter } from './login-rate-limit.js'
import { validateSubscription, type PushService } from './push.js'
import { AttachmentError, AttachmentStore, MAX_IMAGE_BYTES } from './attachments.js'

const MAX_BODY_BYTES = 128 * 1024
const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
}

class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const encoded = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(encoded),
    'Cache-Control': 'no-store',
  })
  res.end(encoded)
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Content-Type must be application/json')
  }
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body is too large')
    chunks.push(buffer)
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required')
    return parsed as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'Request body must be a JSON object')
  }
}

async function readBytes(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, 'Image exceeds the 10 MB limit')
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > limit) throw new HttpError(413, 'Image exceeds the 10 MB limit')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

function routeThread(pathname: string, suffix: string): string | null {
  const match = pathname.match(new RegExp(`^/api/threads/([^/]+)${suffix}$`))
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    throw new HttpError(400, 'Malformed thread id')
  }
}

function requestIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown'
}

function securityHeaders(config: RemoteConfig): Record<string, string> {
  const script = config.production ? "script-src 'self'" : "script-src 'self' 'unsafe-eval'"
  return {
    'Content-Security-Policy': `default-src 'self'; ${script}; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  }
}

function isAllowedOrigin(req: IncomingMessage, config: RemoteConfig): boolean {
  const origin = req.headers.origin
  if (!origin) return false
  const localOrigins = new Set([
    config.publicOrigin.origin,
    `http://${config.host}:${config.port}`,
    `http://127.0.0.1:${config.port}`,
    `http://localhost:${config.port}`,
  ])
  return localOrigins.has(origin)
}

function isAllowedHost(req: IncomingMessage, config: RemoteConfig): boolean {
  const host = req.headers.host?.toLowerCase()
  if (!host) return false
  return new Set([
    config.publicOrigin.host.toLowerCase(),
    `${config.host}:${config.port}`.toLowerCase(),
    `127.0.0.1:${config.port}`,
    `localhost:${config.port}`,
  ]).has(host)
}

async function serveStatic(res: ServerResponse, distRoot: string, pathname: string): Promise<boolean> {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    throw new HttpError(400, 'Malformed path')
  }

  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '')
  let candidate = resolve(distRoot, relative)
  if (candidate !== distRoot && !candidate.startsWith(`${distRoot}${sep}`)) throw new HttpError(404, 'Not found')

  try {
    const metadata = await fs.stat(candidate)
    if (metadata.isDirectory()) candidate = resolve(candidate, 'index.html')
    const finalMetadata = await fs.stat(candidate)
    const filename = candidate.split(sep).at(-1)
    const cacheControl = ['index.html', 'sw.js', 'manifest.webmanifest'].includes(filename ?? '')
      ? 'no-cache'
      : candidate.includes(`${sep}assets${sep}`)
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600'
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(candidate)] ?? 'application/octet-stream',
      'Content-Length': finalMetadata.size,
      'Cache-Control': cacheControl,
    })
    createReadStream(candidate).pipe(res)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  if (!extname(relative)) return serveStatic(res, distRoot, '/index.html')
  return false
}

export function createRemoteHttpServer(
  config: RemoteConfig,
  controller: RemoteController,
  distRoot: string,
  vite: ViteDevServer | null,
  push?: PushService,
  attachments?: AttachmentStore,
) {
  const loginRateLimiter = new LoginRateLimiter()
  const headers = securityHeaders(config)
  const secureCookie = config.publicOrigin.protocol === 'https:'

  return createServer(async (req, res) => {
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value)
    if (secureCookie) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')

    try {
      if (!isAllowedHost(req, config)) throw new HttpError(400, 'Unrecognized host')
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
      const method = req.method ?? 'GET'

      if (url.pathname === '/api/healthz' && method === 'GET') {
        json(res, controller.appServer.state === 'ready' ? 200 : 503, {
          status: controller.appServer.state === 'ready' ? 'ok' : 'unavailable',
          codex: controller.appServer.state,
        })
        return
      }

      if (url.pathname === '/api/session/login' && method === 'POST') {
        if (!isAllowedOrigin(req, config)) throw new HttpError(403, 'Origin is not allowed')
        const ip = requestIp(req)
        if (loginRateLimiter.isBlocked(ip)) {
          throw new HttpError(429, 'Too many login attempts. Try again later.')
        }
        const body = await readJson(req)
        if (!passwordMatches(body.password, config.password)) {
          loginRateLimiter.recordFailure(ip)
          throw new HttpError(401, 'Incorrect password')
        }
        loginRateLimiter.clear(ip)
        const session = createSession(config.sessionSecret, config.sessionTtlSeconds)
        setSessionCookie(res, session.token, config.sessionTtlSeconds, secureCookie)
        json(res, 200, {
          csrf: session.payload.csrf,
          expiresAt: session.payload.expiresAt,
          workspaces: controller.workspaces,
        })
        return
      }

      if (!url.pathname.startsWith('/api/')) {
        if (vite) {
          vite.middlewares(req, res, (error?: unknown) => {
            if (error) json(res, 500, { error: error instanceof Error ? error.message : 'Vite error' })
            else if (!res.writableEnded) json(res, 404, { error: 'Not found' })
          })
          return
        }
        if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Method not allowed')
        if (await serveStatic(res, distRoot, url.pathname)) return
        throw new HttpError(404, 'Not found')
      }

      const session = getSession(req, config.sessionSecret)
      if (!session) throw new HttpError(401, 'Authentication required')

      if (method !== 'GET' && method !== 'HEAD') {
        if (!isAllowedOrigin(req, config)) throw new HttpError(403, 'Origin is not allowed')
        if (req.headers['x-csrf-token'] !== session.csrf) throw new HttpError(403, 'Invalid CSRF token')
      }

      if (url.pathname === '/api/session' && method === 'GET') {
        json(res, 200, {
          csrf: session.csrf,
          expiresAt: session.expiresAt,
          workspaces: controller.workspaces,
        })
        return
      }
      if (url.pathname === '/api/session/logout' && method === 'POST') {
        push?.unsubscribe(session)
        attachments?.clear(session)
        clearSessionCookie(res, secureCookie)
        json(res, 200, { ok: true })
        return
      }
      if (url.pathname === '/api/attachments' && method === 'POST') {
        if (!attachments) throw new HttpError(503, 'Image attachments are unavailable')
        const contentType = (req.headers['content-type'] ?? '').toLowerCase().split(';', 1)[0].trim()
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) throw new HttpError(415, 'Use a JPEG, PNG, or WebP image')
        json(res, 201, attachments.add(await readBytes(req, MAX_IMAGE_BYTES), contentType, session))
        return
      }
      const attachmentMatch = url.pathname.match(/^\/api\/attachments\/([^/]+)$/)
      if (attachmentMatch && method === 'DELETE') {
        if (!attachments) throw new HttpError(503, 'Image attachments are unavailable')
        attachments.remove(decodeURIComponent(attachmentMatch[1]), session)
        json(res, 200, { ok: true })
        return
      }
      if (url.pathname.startsWith('/api/push/')) {
        if (!push) throw new HttpError(503, 'Push notifications are unavailable')
        if (url.pathname === '/api/push/key' && method === 'GET') {
          json(res, 200, { publicKey: push.publicKey })
          return
        }
        if (url.pathname === '/api/push/status' && method === 'POST') {
          const body = await readJson(req)
          json(res, 200, { enabled: push.enabled(body.endpoint, session) })
          return
        }
        if (url.pathname === '/api/push/subscription' && method === 'POST') {
          const body = await readJson(req)
          let subscription
          try { subscription = validateSubscription(body) }
          catch { throw new HttpError(400, 'Invalid or unsupported push subscription') }
          push.subscribe(subscription, session)
          json(res, 201, { ok: true })
          return
        }
        if (url.pathname === '/api/push/subscription' && method === 'DELETE') {
          push.unsubscribe(session)
          json(res, 200, { ok: true })
          return
        }
      }
      if (url.pathname === '/api/events' && method === 'GET') {
        const lastId = Number(req.headers['last-event-id'] ?? url.searchParams.get('after') ?? 0)
        const unsubscribe = controller.events.subscribe(res, Number.isFinite(lastId) ? lastId : 0, url.searchParams.get('epoch') ?? undefined)
        res.on('close', unsubscribe)
        return
      }
      if (url.pathname === '/api/pending' && method === 'GET') {
        json(res, 200, { data: controller.listPending() })
        return
      }
      if (url.pathname === '/api/models' && method === 'GET') {
        json(res, 200, await controller.listModels())
        return
      }
      if (url.pathname === '/api/account/rate-limits' && method === 'GET') {
        json(res, 200, await controller.readRateLimits())
        return
      }
      if (url.pathname === '/api/threads' && method === 'GET') {
        json(res, 200, await controller.listThreads())
        return
      }
      if (url.pathname === '/api/threads' && method === 'POST') {
        const body = await readJson(req)
        json(res, 201, await controller.createThread(body.workspaceId, body.fullAccess ?? false))
        return
      }

      const readThreadId = routeThread(url.pathname, '')
      if (readThreadId && method === 'GET') {
        json(res, 200, await controller.readThread(readThreadId))
        return
      }
      const resumeThreadId = routeThread(url.pathname, '/resume')
      if (resumeThreadId && method === 'POST') {
        json(res, 200, await controller.resumeThread(resumeThreadId))
        return
      }
      const archiveThreadId = routeThread(url.pathname, '/archive')
      if (archiveThreadId && method === 'POST') {
        json(res, 200, await controller.archiveThread(archiveThreadId))
        return
      }
      const turnThreadId = routeThread(url.pathname, '/turns')
      if (turnThreadId && method === 'POST') {
        const body = await readJson(req)
        if (!attachments && body.attachmentIds !== undefined) throw new HttpError(503, 'Image attachments are unavailable')
        const operation = (paths: string[]) => controller.startTurn(turnThreadId, body.text ?? '', body.model, body.effort, body.fullAccess ?? false, paths)
        json(res, 202, attachments
          ? await attachments.use(body.attachmentIds, session, operation)
          : await operation([]))
        return
      }
      const interruptThreadId = routeThread(url.pathname, '/interrupt')
      if (interruptThreadId && method === 'POST') {
        const body = await readJson(req)
        json(res, 200, await controller.interruptTurn(interruptThreadId, body.turnId))
        return
      }

      const requestMatch = url.pathname.match(/^\/api\/requests\/([^/]+)\/respond$/)
      if (requestMatch && method === 'POST') {
        const body = await readJson(req)
        controller.respondToRequest(decodeURIComponent(requestMatch[1]), body)
        json(res, 200, { ok: true })
        return
      }

      throw new HttpError(404, 'API route not found')
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : undefined)
        return
      }
      const status = error instanceof HttpError || error instanceof AttachmentError ? error.status : 500
      const message = error instanceof Error ? error.message : 'Unexpected server error'
      json(res, status, { error: status === 500 ? 'Unexpected server error' : message })
      if (status === 500) {
        controller.events.publish('server-log', { line: message })
        console.error(`Codex Remote request failed: ${message}`)
      }
    }
  })
}
