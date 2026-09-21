import { SECURE_VIEWER_CSP, SECURE_VIEWER_HTML } from './secure-viewer.js'
import { SecureApi } from './secure-api.js'
import { requestIp } from './request-ip.js'
import { SessionRegistry } from './session-registry.js'
import { LocalhostPreview, LocalhostPreviewError } from './localhost-preview.js'
import { ServiceError, type ServicesStore } from './services.js'
import { ContextVaultError } from './context-vault.js'
import { KnowledgeError } from './vault-files.js'
import { MAX_NOTE_BYTES, noteDiff } from './knowledge-store.js'
import { ReadStateStore } from './read-state.js'
import { HoursError, type WorkHoursStore } from './work-hours.js'
import type { WorkPresence } from './work-presence.js'
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
import { ThreadNameError, type RemoteController } from './controller.js'
import { LoginRateLimiter } from './login-rate-limit.js'
import { validateSubscription, type PushService } from './push.js'
import { AttachmentError, AttachmentStore, MAX_ATTACHMENT_BYTES, type UploadedFile } from './attachments.js'
import { inspectServerFile, MAX_TEXT_PREVIEW_BYTES, ServerFileError, readInspectedFile, serveServerFile } from './server-files.js'
import { PptxPreviewCache } from './pptx-preview.js'
import { DOCX_FRAME_CSP, DOCX_FRAME_HTML } from './docx-frame.js'
import { listDirectory } from './directory-listing.js'

const MAX_BODY_BYTES = 128 * 1024
const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
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

async function readJson(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Content-Type must be application/json')
  }
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > limit) throw new HttpError(413, 'Request body is too large')
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
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, 'File exceeds the 25 MB limit')
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > limit) throw new HttpError(413, 'File exceeds the 25 MB limit')
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


function securityHeaders(config: RemoteConfig): Record<string, string> {
  const script = config.production ? "script-src 'self'" : "script-src 'self' 'unsafe-eval'"
  return {
    'Content-Security-Policy': `default-src 'self'; ${script}; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; frame-src 'self' https: http:; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'`,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Origin-Agent-Cluster': '?1',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
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
    const cacheControl = ['index.html', 'sw.js', 'migration-check-sw.js', 'manifest.webmanifest'].includes(filename ?? '')
      ? 'no-cache'
      : candidate.includes(`${sep}assets${sep}`)
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600'
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(candidate)] ?? 'application/octet-stream',
      'Content-Length': finalMetadata.size,
      'Cache-Control': cacheControl,
      ...(cacheControl === 'no-cache' ? { 'CDN-Cache-Control': 'no-store' } : {}),
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
  workPresence?: WorkPresence,
  workHours?: WorkHoursStore,
  readState = new ReadStateStore(),
  services?: ServicesStore,
) {
  const fileRoots = [...new Set([...(config.fileRoots ?? config.workspaceRoots), ...(controller.contextVault ? [controller.contextVault.root] : [])])]
  const pptxPreviews = new PptxPreviewCache()
  const loginRateLimiter = new LoginRateLimiter()
  const headers = securityHeaders(config)
  const sessions = new SessionRegistry(config.sessionSecret, config.sessionStateFile, config.password)
  const secureCookie = config.publicOrigin.protocol === 'https:'

  const preview = new LocalhostPreview({
    publicOrigin: config.publicOrigin.origin,
    originTemplate: config.previewOriginTemplate,
    sessionSecret: config.sessionSecret,
    sessions,
    blockedPorts: [config.port, Number(config.publicOrigin.port || (secureCookie ? 443 : 80))],
  })
  if (preview?.matchesHost(config.publicOrigin.host)) throw new Error('Preview apps must use a separate origin from Codex Remote')
  if (secureCookie && config.previewOriginTemplate?.startsWith('http:')) throw new Error('HTTPS Codex Remote requires HTTPS preview origins')

  const secure = config.secureApiRequired ? new SecureApi(config, sessions, fileRoots) : undefined
  const dispatch = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Preview apps own their isolated origin. Never apply the Codex app CSP or routing there.
    if (preview?.matchesHost(req.headers.host)) { preview.handle(req, res); return }
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value)
    if (secureCookie) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')

    try {
      if (!isAllowedHost(req, config)) throw new HttpError(400, 'Unrecognized host')
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
      if (url.pathname.startsWith('/preview/')) {
        const match = url.pathname.match(/^\/preview\/([1-9][0-9]{3,4})(\/.*)?$/)
        if (!match) throw new HttpError(400, 'Invalid preview path')
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Open previews with GET')
        const session = getSession(req, config.sessionSecret, secureCookie, config.password)
        if (!session || !sessions.valid(session)) throw new HttpError(401, 'Authentication required')
        const launch = preview.createLaunch(Number(match[1]), (match[2] || '/') + url.search, session)
        res.writeHead(303, { Location: launch.url, 'Cache-Control': 'no-store' }); res.end(); return
      }
      const method = req.method ?? 'GET'

      if (url.pathname === '/api/healthz' && method === 'GET') {
        json(res, controller.appServer.state === 'ready' ? 200 : 503, {
          status: controller.appServer.state === 'ready' ? 'ok' : 'unavailable',
          ...(secure ? {} : { codex: controller.appServer.state }),
        })
        return
      }

      if (url.pathname === '/api/session/login' && method === 'POST') {
        if (!isAllowedOrigin(req, config)) throw new HttpError(403, 'Origin is not allowed')
        const ip = requestIp(req, config.trustedProxies)
        const admission = loginRateLimiter.beginAttempt(ip)
        if (!admission.allowed) {
          res.setHeader('Retry-After', String(admission.retryAfterSeconds))
          throw new HttpError(admission.reason === 'capacity' ? 503 : 429,
            admission.reason === 'capacity' ? 'Login is busy. Try again shortly.' : 'Too many login attempts. Try again later.')
        }
        let accepted = false
        try {
          const body = await readJson(req)
          accepted = passwordMatches(body.password, config.password)
          if (!accepted) throw new HttpError(401, 'Incorrect password')
        } finally { admission.finish(accepted) }
        const session = createSession(config.sessionSecret, config.sessionTtlSeconds, config.password)
        setSessionCookie(res, session.token, config.sessionTtlSeconds, secureCookie)
        json(res, 200, {
          csrf: session.payload.csrf,
          expiresAt: session.payload.expiresAt,
          ...(secure ? {} : { workspaces: controller.workspaces }),
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

      const session = getSession(req, config.sessionSecret, secureCookie, config.password)
      if (!session || !sessions.valid(session)) throw new HttpError(401, 'Authentication required')

      if (method !== 'GET' && method !== 'HEAD') {
        if (!isAllowedOrigin(req, config)) throw new HttpError(403, 'Origin is not allowed')
        if (req.headers['x-csrf-token'] !== session.csrf) throw new HttpError(403, 'Invalid CSRF token')
      }

      if (url.pathname.startsWith('/api/knowledge')) {
        const vault = controller.contextVault
        if (!vault) throw new HttpError(503, 'Knowledge vault is unavailable')
        const store = vault.knowledge, path = url.searchParams.get('path') ?? ''
        if (url.pathname === '/api/knowledge' && method === 'GET') { json(res, 200, store.snapshot()); return }
        if (url.pathname === '/api/knowledge/note' && method === 'GET') { json(res, 200, store.read(path)); return }
        if (url.pathname === '/api/knowledge/source' && method === 'GET') { json(res, 200, store.source(path)); return }
        if (url.pathname === '/api/knowledge/note' && method === 'PUT') {
          const body = await readJson(req, MAX_NOTE_BYTES * 6 + 2048)
          if (typeof body.path !== 'string') throw new HttpError(400, 'Provide a note path')
          json(res, 200, store.save(body.path, body.content, body.revision, typeof body.actor === 'string' ? body.actor : 'user')); return
        }
        if (url.pathname === '/api/knowledge/versions' && method === 'GET') { json(res, 200, { versions: store.versions(path) }); return }
        if (url.pathname === '/api/knowledge/version' && method === 'GET') {
          const saved = store.version(path, url.searchParams.get('id') ?? '')
          const current = store.files.read(store.notePath(path)) ?? ''
          json(res, 200, { ...saved, diff: noteDiff(saved.content, current) }); return
        }
        if (url.pathname === '/api/knowledge/restore' && method === 'POST') {
          const body = await readJson(req)
          if (typeof body.path !== 'string' || typeof body.versionId !== 'string') throw new HttpError(400, 'Provide path and versionId')
          json(res, 200, store.restore(body.path, body.versionId, body.revision, typeof body.actor === 'string' ? body.actor : 'user')); return
        }
        if (url.pathname === '/api/knowledge/traces' && method === 'GET') {
          const traces = store.traces(url.searchParams.get('threadId') ?? undefined)
          const id = url.searchParams.get('id')
          if (id) {
            const trace = traces.find(trace => trace.id === id)
            if (!trace) throw new HttpError(404, 'Context trace not found')
            json(res, 200, trace)
          } else json(res, 200, { traces: traces.map(({ snippets, omitted, ...trace }) => ({ ...trace, noteCount: snippets.length, omittedCount: omitted.length })) })
          return
        }
        if (url.pathname === '/api/knowledge/preview' && method === 'POST') {
          const body = await readJson(req)
          if (typeof body.threadId !== 'string' || typeof body.text !== 'string' || body.text.length > 8000) throw new HttpError(400, 'Provide a conversation ID and a query up to 8000 characters')
          await controller.assertThreadAccess(body.threadId)
          json(res, 200, vault.previewContext(body.threadId, { text: body.text })); return
        }
        throw new HttpError(404, 'Knowledge operation not found')
      }

      if (url.pathname === '/api/services' && ['GET', 'PUT', 'DELETE'].includes(method)) {
        if (!services) throw new HttpError(503, 'Danh sách dịch vụ đang chờ cập nhật máy chủ. Hãy thử lại sau.')
        try {
          if (method === 'DELETE') { services.remove(url.searchParams.get('key') ?? ''); json(res, 200, { ok: true }); return }
          json(res, 200, method === 'GET' ? await services.snapshot() : { service: services.upsert(await readJson(req)) })
        } catch (error) { if (error instanceof ServiceError) throw new HttpError(error.status, error.message); throw error }
        return
      }
      if (url.pathname === '/api/localhost-preview' && method === 'GET') {
        json(res, 200, { enabled: preview.enabled })
        return
      }
      if (url.pathname === '/api/localhost-preview' && method === 'POST') {
        if (!preview) throw new HttpError(503, 'Preview chưa được cấu hình domain trên server.')
        const body = await readJson(req)
        json(res, 201, preview.createLaunch(body.port, body.path ?? '/', session))
        return
      }

      if (url.pathname === '/api/working-hours' && ['GET', 'POST'].includes(method)) {
        if (!workHours) throw new HttpError(503, 'Shared working hours are not configured')
        try { json(res, 200, method === 'GET' ? workHours.read() : workHours.change(await readJson(req))) }
        catch (error) { if (error instanceof HoursError) throw new HttpError(error.status, error.message); throw error }
        return
      }
      if (url.pathname === '/api/work-presence' && method === 'POST') {
        if (!workPresence) throw new HttpError(503, 'Screen tracking is not configured')
        const body = await readJson(req)
        try { workPresence.report(session.nonce, body) }
        catch (error) {
          if (error instanceof Error && error.message === 'Invalid screen presence') throw new HttpError(400, error.message)
          throw error
        }
        json(res, 200, { ok: true })
        return
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
        sessions.revoke(session)
        push?.unsubscribe(session)
        attachments?.clear(session)
        clearSessionCookie(res, secureCookie)
        json(res, 200, { ok: true })
        return
      }
      if (url.pathname === '/api/files/docx-frame' && method === 'GET') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Cache-Control', 'private, no-store')
        res.setHeader('Content-Security-Policy', DOCX_FRAME_CSP)
        res.setHeader('X-Frame-Options', 'SAMEORIGIN')
        res.end(DOCX_FRAME_HTML)
        return
      }
      if (url.pathname === '/api/files/roots' && method === 'GET') { json(res, 200, { roots: fileRoots }); return }
      if (url.pathname === '/api/files/list' && method === 'GET') {
        json(res, 200, await listDirectory(url.searchParams, fileRoots))
        return
      }
      if (url.pathname === '/api/files/info' && method === 'GET') {
        json(res, 200, await inspectServerFile(url.searchParams.get('path'), fileRoots))
        return
      }
      if (url.pathname === '/api/files/html-preview' && method === 'GET') {
        const file = await inspectServerFile(url.searchParams.get('path'), fileRoots)
        if (file.kind !== 'text' || !['.html', '.htm'].includes(file.extension)) throw new HttpError(415, 'Use an HTML file for this preview')
        if (!file.previewable) throw new HttpError(413, `HTML preview is limited to ${MAX_TEXT_PREVIEW_BYTES / 1024 / 1024} MB; download the file instead`)
        const html = await readInspectedFile(file)
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Cache-Control', 'private, no-store')
        // Keep scripts interactive without granting the document access to the app origin.
        res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts")
        res.setHeader('X-Frame-Options', 'SAMEORIGIN')
        res.setHeader('Referrer-Policy', 'no-referrer')
        res.end(html)
        return
      }
      if (url.pathname === '/api/files/pptx-preview' && method === 'GET') {
        const file = await inspectServerFile(url.searchParams.get('path'), fileRoots)
        const pdf = await pptxPreviews.get(file)
        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader('Cache-Control', 'private, no-store')
        res.setHeader('Content-Length', pdf.length)
        res.setHeader('Content-Disposition', 'inline; filename="slides.pdf"')
        res.end(pdf)
        return
      }
      if (url.pathname === '/api/files/content' && (method === 'GET' || method === 'HEAD')) {
        const file = await inspectServerFile(url.searchParams.get('path'), fileRoots)
        await serveServerFile(req, res, file, url.searchParams.get('download') === '1')
        return
      }
      if (url.pathname === '/api/attachments' && method === 'POST') {
        if (!attachments) throw new HttpError(503, 'File attachments are unavailable')
        const contentType = (req.headers['content-type'] ?? '').toLowerCase().split(';', 1)[0].trim()
        json(res, 201, attachments.add(await readBytes(req, MAX_ATTACHMENT_BYTES), contentType, session, url.searchParams.get('name') ?? 'attachment'))
        return
      }
      const attachmentMatch = url.pathname.match(/^\/api\/attachments\/([^/]+)$/)
      if (attachmentMatch && method === 'DELETE') {
        if (!attachments) throw new HttpError(503, 'File attachments are unavailable')
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
        if (url.pathname === '/api/push/visibility' && method === 'POST') {
          const body = await readJson(req)
          let ok
          try { ok = push.visibility(body.endpoint, body.visible, session) }
          catch { throw new HttpError(400, 'Invalid push visibility') }
          json(res, 200, { ok })
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
        const unwatch = sessions.watch(session, () => { unsubscribe(); res.end() })
        res.once('close', unwatch)
        return
      }
      if (url.pathname === '/api/pending' && method === 'GET') {
        json(res, 200, { data: controller.listPending(), cursor: controller.events.cursor, epoch: controller.events.epoch })
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
      if (url.pathname === '/api/conversation-groups' && ['GET', 'POST'].includes(method)) {
        if (!controller.contextVault) throw new HttpError(503, 'Context vault is unavailable')
        json(res, method === 'POST' ? 201 : 200, method === 'GET'
          ? controller.contextVault.snapshot() : controller.contextVault.createGroup((await readJson(req)).name))
        return
      }
      const leaderMatch = url.pathname.match(/^\/api\/conversation-groups\/([^/]+)\/leader$/)
      if (leaderMatch && method === 'PUT') {
        if (!controller.contextVault) throw new HttpError(503, 'Context vault is unavailable')
        const body = await readJson(req)
        if (body.threadId !== null) {
          if (typeof body.threadId !== 'string') throw new HttpError(400, 'Provide a conversation ID or null')
          await controller.assertThreadAccess(body.threadId)
        }
        json(res, 200, controller.contextVault.setLeader(decodeURIComponent(leaderMatch[1]), body.threadId))
        controller.orchestration?.changed()
        return
      }
      const teamThreadId = routeThread(url.pathname, '/orchestration')
      if (teamThreadId && ['GET', 'POST'].includes(method)) {
        if (!controller.orchestration) throw new HttpError(503, 'Conversation orchestration is unavailable')
        await controller.assertThreadAccess(teamThreadId)
        if (method === 'POST') {
          const body = await readJson(req)
          if (body.action === 'release') controller.orchestration.release(teamThreadId)
          else if (body.action === 'cancel' && typeof body.taskId === 'string') {
            const task = controller.orchestration.snapshot(teamThreadId).tasks.find(task => task.id === body.taskId)
            if (!task) throw new HttpError(404, 'Task not found in this folder')
            controller.orchestration.userStop(task.threadId)
            await controller.orchestration.cancel(task.id)
          } else throw new HttpError(400, 'Unknown team action')
        }
        json(res, 200, controller.orchestration.snapshot(teamThreadId))
        return
      }
      const groupMatch = url.pathname.match(/^\/api\/conversation-groups\/([^/]+)$/)
      if (groupMatch && ['PATCH', 'DELETE'].includes(method)) {
        if (!controller.contextVault) throw new HttpError(503, 'Context vault is unavailable')
        let id: string
        try { id = decodeURIComponent(groupMatch[1]) } catch { throw new HttpError(400, 'Malformed folder ID') }
        json(res, 200, method === 'DELETE' ? controller.contextVault.deleteGroup(id)
          : controller.contextVault.renameGroup(id, (await readJson(req)).name))
        controller.orchestration?.changed()
        return
      }
      const groupThreadId = routeThread(url.pathname, '/group')
      if (groupThreadId && method === 'PUT') {
        if (!controller.contextVault) throw new HttpError(503, 'Context vault is unavailable')
        const body = await readJson(req)
        await controller.assertThreadAccess(groupThreadId)
        json(res, 200, controller.contextVault.assignThread(groupThreadId, body.groupId))
        controller.orchestration?.changed()
        return
      }
      if (url.pathname === '/api/threads' && method === 'GET') {
        json(res, 200, await controller.listThreads())
        return
      }
      if (url.pathname === '/api/threads' && method === 'POST') {
        const body = await readJson(req)
        json(res, 201, await controller.createThread(body.workspaceId, body.fullAccess ?? false, ...(body.groupId === undefined ? [] : [body.groupId])))
        return
      }

      if (url.pathname === '/api/read-state' && method === 'GET') {
        json(res, 200, readState.snapshot())
        return
      }
      const readStateThreadId = routeThread(url.pathname, '/read-state')
      if (readStateThreadId && method === 'POST') {
        const body = await readJson(req)
        if (!Array.isArray(body.ids) || body.ids.length > 1000 || body.ids.some(id => typeof id !== 'string' || id.length > 256)) {
          throw new HttpError(400, 'Invalid completed reply IDs')
        }
        // Validate access without requiring a full history to be available for a live reply.
        await controller.assertThreadAccess(readStateThreadId)
        json(res, 200, readState.acknowledge(readStateThreadId, body.ids as string[]))
        return
      }
      if (url.pathname === '/api/workspace-skills' && method === 'GET') {
        json(res, 200, await controller.listWorkspaceSkills(url.searchParams.get('workspaceId'), url.searchParams.get('refresh') === '1'))
        return
      }
      const skillsThreadId = routeThread(url.pathname, '/skills')
      if (skillsThreadId && method === 'GET') {
        json(res, 200, await controller.listSkills(skillsThreadId, url.searchParams.get('refresh') === '1'))
        return
      }
      const messageIdsThreadId = routeThread(url.pathname, '/message-ids')
      if (messageIdsThreadId && method === 'GET') {
        const result = await controller.readMessageIds(messageIdsThreadId)
        readState.observe(messageIdsThreadId, result.ids)
        json(res, 200, result)
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
      const renameThreadId = routeThread(url.pathname, '/name')
      if (renameThreadId && method === 'POST') {
        const body = await readJson(req)
        json(res, 200, await controller.renameThread(renameThreadId, body.name))
        return
      }
      if (archiveThreadId && method === 'POST') {
        json(res, 200, await controller.archiveThread(archiveThreadId))
        return
      }
      const turnThreadId = routeThread(url.pathname, '/turns')
      if (turnThreadId && method === 'POST') {
        const body = await readJson(req)
        if (body.collaborationMode !== undefined && body.collaborationMode !== 'plan' && body.collaborationMode !== 'default') throw new HttpError(400, 'Invalid collaboration mode')
        if (!attachments && body.attachmentIds !== undefined) throw new HttpError(503, 'File attachments are unavailable')
        const operation = (_paths: string[], files: UploadedFile[]) => controller.startTurn(turnThreadId, body.text ?? '', body.model, body.effort, body.fullAccess ?? false, files.filter(file => file.kind === 'image').map(file => file.path), files.filter(file => file.kind === 'file'), body.skills, body.collaborationMode)
        json(res, 202, attachments
          ? await attachments.use(body.attachmentIds, session, operation)
          : await operation([], []))
        return
      }
      const interruptThreadId = routeThread(url.pathname, '/interrupt')
      if (interruptThreadId && method === 'POST') {
        const body = await readJson(req)
        await controller.assertThreadAccess(interruptThreadId)
        controller.orchestration?.userStop(interruptThreadId)
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
      const status = error instanceof HttpError || error instanceof AttachmentError || error instanceof ServerFileError || error instanceof ThreadNameError || error instanceof ContextVaultError || error instanceof KnowledgeError || error instanceof LocalhostPreviewError ? error.status : 500
      const message = error instanceof Error ? error.message : 'Unexpected server error'
      json(res, status, { error: status === 500 ? 'Unexpected server error' : message })
      if (status === 500) {
        controller.events.publish('server-log', { line: message })
        console.error(`Codex Remote request failed: ${message}`)
      }
    }
  }
  const server = createServer(async (req, res) => {
    if (preview.matchesHost(req.headers.host)) { preview.handle(req, res); return }
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value)
    if (secureCookie) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    if (!isAllowedHost(req, config)) { json(res, 400, { error: 'Unrecognized host' }); return }
    const path = new URL(req.url ?? '/', config.publicOrigin).pathname
    if (req.method === 'GET' && ['/secure-viewer', '/secure-docx-frame'].includes(path)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': path === '/secure-viewer' ? SECURE_VIEWER_CSP : DOCX_FRAME_CSP, 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN' })
      res.end(path === '/secure-viewer' ? SECURE_VIEWER_HTML : DOCX_FRAME_HTML); return
    }
    if (secure && path.startsWith('/api/secure/')) { await secure.handle(req, res, dispatch); return }
    if (path === '/api/secure/setup' && req.method === 'GET') { json(res, 200, { required: false, version: 1 }); return }
    if (secure && ((path.startsWith('/api/') && !['/api/healthz', '/api/session/login'].includes(path)) || path.startsWith('/preview/'))) {
      json(res, 403, { error: 'Unlock the encrypted API first' }); return
    }
    await dispatch(req, res)
  })
  server.on('close', () => secure?.close())
  if (preview) {
    server.on('upgrade', (req, socket, head) => {
      if (preview.matchesHost(req.headers.host)) preview.handleUpgrade(req, socket, head)
      else socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
    })
    server.on('close', () => preview.close())
  }
  return server
}
