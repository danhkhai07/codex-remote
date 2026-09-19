import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { request, type ClientRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'

const LAUNCH_PATH = '/__codex_preview__/launch'
const HTTP_COOKIE = 'codex_preview_session'
const HTTPS_COOKIE = '__Host-codex_preview_session'
const HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-connection', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'])
type Headers = Record<string, string | string[]>
type Ticket = { port: number; path: string; expiresAt: number; cookieExpiresAt: number }

export class LocalhostPreviewError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function parsedTemplate(template: string): URL {
  try {
    if ((template.match(/\{port\}/g) ?? []).length !== 1 || template.includes('preview-port-placeholder')) throw new Error()
    const url = new URL(template.replace('{port}', 'preview-port-placeholder'))
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      !url.hostname.includes('preview-port-placeholder')) throw new Error()
    return url
  } catch {
    throw new LocalhostPreviewError(400, 'Preview origin must be an HTTP(S) origin with exactly one {port} in its hostname')
  }
}

export function validatePreviewOriginTemplate(template: string): string {
  return parsedTemplate(template).origin.replace('preview-port-placeholder', '{port}')
}

function cleanHeaders(headers: IncomingMessage['headers']): Headers {
  const connectionHeaders = new Set((headers.connection ?? '').toLowerCase().split(',').map(value => value.trim()))
  return Object.fromEntries(Object.entries(headers).filter(([name, value]) => value !== undefined && !HOP_HEADERS.has(name) && !connectionHeaders.has(name))) as Headers
}

function reservedCookie(name: string): boolean {
  const normalized = name.toLowerCase()
  return normalized.startsWith('codex_remote_') || normalized.startsWith('codex_preview_') || normalized.startsWith('__host-codex_')
}

function applicationCookies(header: string | undefined): string {
  return (header ?? '').split(';').map(part => part.trim()).filter(part => {
    const separator = part.indexOf('=')
    return separator > 0 && !reservedCookie(part.slice(0, separator))
  }).join('; ')
}

function applicationSetCookies(values: string[]): string[] {
  return values.flatMap(value => {
    const parts = value.split(';')
    const separator = parts[0].indexOf('=')
    if (separator < 1 || reservedCookie(parts[0].slice(0, separator).trim())) return []
    return [parts.filter((part, index) => index === 0 || !/^\s*domain\s*=/i.test(part)).join(';')]
  })
}

function unsafePathCharacters(value: string): boolean {
  return value.includes('\\') || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
}

function relativePath(value: unknown): string {
  if (value === undefined) return '/'
  if (typeof value !== 'string' || value.length > 8192 || !value.startsWith('/') || value.startsWith('//') || unsafePathCharacters(value)) {
    throw new LocalhostPreviewError(400, 'Preview path must be a relative path beginning with /')
  }
  const url = new URL(value, 'http://preview.invalid')
  if (url.origin !== 'http://preview.invalid' || url.pathname.startsWith('/__codex_preview__/')) {
    throw new LocalhostPreviewError(400, 'Invalid preview path')
  }
  return `${url.pathname}${url.search}${url.hash}`
}

function httpError(res: ServerResponse, error: unknown): void {
  if (res.destroyed || res.writableEnded) return
  if (res.headersSent) { res.destroy(); return }
  const status = error instanceof LocalhostPreviewError ? error.status : 502
  const message = error instanceof LocalhostPreviewError ? error.message : 'Could not reach the app on localhost. Check that its server is running.'
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(message)
}

function socketError(socket: Duplex, status: number, message: string): void {
  if (socket.destroyed) return
  socket.end(`HTTP/1.1 ${status} Preview unavailable\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`)
}

export class LocalhostPreview {
  readonly #template: string
  readonly #hostPattern: RegExp
  readonly #secret: string
  readonly #blockedPorts: Set<number>
  readonly #tickets = new Map<string, Ticket>()
  readonly #requests = new Set<ClientRequest>()
  readonly #sockets = new Set<Duplex>()
  readonly #secure: boolean

  constructor(options: { originTemplate: string; sessionSecret: string; blockedPorts: number[] }) {
    this.#template = validatePreviewOriginTemplate(options.originTemplate)
    const template = parsedTemplate(this.#template)
    const escapedHost = template.host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('preview-port-placeholder', '([1-9][0-9]{3,4})')
    this.#hostPattern = new RegExp(`^${escapedHost}$`, 'i')
    this.#secret = options.sessionSecret
    this.#blockedPorts = new Set(options.blockedPorts)
    this.#secure = template.protocol === 'https:'
  }

  matchesHost(host: string | undefined): boolean {
    return typeof host === 'string' && this.#hostPattern.test(host)
  }

  #port(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1024 || value > 65535) {
      throw new LocalhostPreviewError(400, 'Use a localhost port between 1024 and 65535')
    }
    if (this.#blockedPorts.has(value)) throw new LocalhostPreviewError(400, 'This port is reserved for the Codex Remote gateway')
    return value
  }

  #origin(port: number): string { return this.#template.replace('{port}', String(port)) }

  createLaunch(portValue: unknown, pathValue: unknown, sessionExpiresAt: number): { url: string; viewUrl: string; port: number; expiresAt: number } {
    const port = this.#port(portValue), path = relativePath(pathValue), now = Math.floor(Date.now() / 1000)
    if (!Number.isFinite(sessionExpiresAt) || sessionExpiresAt <= now) throw new LocalhostPreviewError(401, 'Your Codex Remote session has expired')
    for (const [key, ticket] of this.#tickets) if (ticket.expiresAt <= now) this.#tickets.delete(key)
    if (this.#tickets.size >= 1024) throw new LocalhostPreviewError(429, 'Too many pending previews. Try again in a minute.')
    const ticket = randomBytes(32).toString('base64url')
    const expiresAt = Math.min(Math.floor(sessionExpiresAt), now + 60)
    this.#tickets.set(ticket, { port, path, expiresAt, cookieExpiresAt: Math.min(Math.floor(sessionExpiresAt), now + 4 * 60 * 60) })
    const url = new URL(LAUNCH_PATH, this.#origin(port))
    url.searchParams.set('ticket', ticket)
    return { url: url.href, viewUrl: `${this.#origin(port)}${path}`, port, expiresAt }
  }

  #signature(value: string): Buffer {
    return createHmac('sha256', this.#secret).update(`codex-remote-preview-v1:${value}`).digest()
  }

  #cookie(port: number, expiresAt: number): string {
    const encoded = Buffer.from(JSON.stringify({ port, expiresAt, nonce: randomBytes(16).toString('hex') })).toString('base64url')
    return `${encoded}.${this.#signature(encoded).toString('base64url')}`
  }

  #authenticated(req: IncomingMessage, port: number): boolean {
    const name = this.#secure ? HTTPS_COOKIE : HTTP_COOKIE
    const entries = (req.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`))
    if (entries.length !== 1) return false
    const [encoded, signature, extra] = entries[0].slice(name.length + 1).split('.')
    if (!encoded || !signature || extra !== undefined) return false
    try {
      const supplied = Buffer.from(signature, 'base64url'), expected = this.#signature(encoded)
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
      return payload.port === port && Number.isInteger(payload.expiresAt) && payload.expiresAt > Date.now() / 1000
    } catch { return false }
  }

  #route(req: IncomingMessage): { port: number; url: URL; origin: string } {
    const match = (req.headers.host ?? '').match(this.#hostPattern)
    if (!match) throw new LocalhostPreviewError(400, 'Unrecognized preview host')
    const port = this.#port(Number(match[1])), origin = this.#origin(port)
    if (req.headers.origin !== undefined && req.headers.origin !== origin) throw new LocalhostPreviewError(403, 'Preview origin is not allowed')
    if (!req.url?.startsWith('/') || req.url.startsWith('//') || unsafePathCharacters(req.url)) throw new LocalhostPreviewError(400, 'Invalid preview request path')
    return { port, origin, url: new URL(req.url, origin) }
  }

  #requestHeaders(req: IncomingMessage, port: number, origin: string): Headers {
    const headers = cleanHeaders(req.headers)
    for (const name of Object.keys(headers)) {
      if (name === 'forwarded' || name.startsWith('x-forwarded-')) delete headers[name]
    }
    const cookie = applicationCookies(typeof headers.cookie === 'string' ? headers.cookie : undefined)
    if (cookie) headers.cookie = cookie
    else delete headers.cookie
    headers.host = `127.0.0.1:${port}`
    headers['x-forwarded-host'] = new URL(origin).host
    headers['x-forwarded-proto'] = this.#secure ? 'https' : 'http'
    if (req.headers.origin) headers.origin = `http://127.0.0.1:${port}`
    return headers
  }

  #responseHeaders(response: IncomingMessage, port: number, origin: string): Headers {
    const headers = cleanHeaders(response.headers)
    if (Array.isArray(headers['set-cookie'])) {
      const cookies = applicationSetCookies(headers['set-cookie'])
      if (cookies.length) headers['set-cookie'] = cookies
      else delete headers['set-cookie']
    }
    if (typeof headers.location === 'string') {
      try {
        const location = new URL(headers.location, `http://127.0.0.1:${port}`)
        const locationPort = Number(location.port || (location.protocol === 'https:' ? 443 : 80))
        if (['http:', 'https:'].includes(location.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && locationPort === port) {
          headers.location = `${origin}${location.pathname}${location.search}${location.hash}`
        }
      } catch { /* Preserve upstream redirects that are not URLs. */ }
    }
    return headers
  }

  #track(upstream: ClientRequest): void {
    this.#requests.add(upstream)
    upstream.once('close', () => this.#requests.delete(upstream))
  }

  handle(req: IncomingMessage, res: ServerResponse): void {
    try {
      const { port, url, origin } = this.#route(req)
      if (req.method === 'CONNECT' || req.headers.upgrade) throw new LocalhostPreviewError(405, 'Use HTTP or a WebSocket upgrade for this preview')
      if (url.pathname === LAUNCH_PATH) {
        if (req.method !== 'GET') throw new LocalhostPreviewError(405, 'Open preview links with GET')
        const key = url.searchParams.get('ticket') ?? '', ticket = this.#tickets.get(key)
        if (!ticket || ticket.expiresAt <= Date.now() / 1000) {
          this.#tickets.delete(key)
          throw new LocalhostPreviewError(401, 'This preview link has expired or was already used. Open it again from Codex Remote.')
        }
        if (ticket.port !== port) throw new LocalhostPreviewError(403, 'This preview link belongs to another port')
        this.#tickets.delete(key)
        const cookieName = this.#secure ? HTTPS_COOKIE : HTTP_COOKIE
        res.writeHead(303, {
          Location: ticket.path,
          'Set-Cookie': `${cookieName}=${this.#cookie(port, ticket.cookieExpiresAt)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, ticket.cookieExpiresAt - Math.floor(Date.now() / 1000))}${this.#secure ? '; Secure' : ''}`,
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        })
        res.end()
        return
      }
      if (!this.#authenticated(req, port)) throw new LocalhostPreviewError(401, 'Open this localhost preview from Codex Remote to sign in.')
      if (url.pathname.startsWith('/__codex_preview__/')) throw new LocalhostPreviewError(404, 'Unknown preview endpoint')
      const upstream = request({ hostname: '127.0.0.1', port, path: `${url.pathname}${url.search}`, method: req.method, headers: this.#requestHeaders(req, port, origin), agent: false })
      this.#track(upstream)
      const timeout = setTimeout(() => upstream.destroy(new LocalhostPreviewError(504, 'The localhost app took too long to respond.')), 30_000)
      timeout.unref()
      upstream.once('response', response => {
        clearTimeout(timeout)
        res.writeHead(response.statusCode ?? 502, this.#responseHeaders(response, port, origin))
        response.on('error', () => res.destroy())
        response.pipe(res)
      })
      upstream.once('error', error => { clearTimeout(timeout); httpError(res, error) })
      upstream.once('close', () => clearTimeout(timeout))
      req.once('aborted', () => upstream.destroy())
      res.once('close', () => upstream.destroy())
      req.pipe(upstream)
    } catch (error) { httpError(res, error) }
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    try {
      const { port, url, origin } = this.#route(req)
      if (req.method !== 'GET' || req.headers.upgrade?.toLowerCase() !== 'websocket') throw new LocalhostPreviewError(400, 'Only WebSocket upgrades are supported')
      if (!this.#authenticated(req, port)) throw new LocalhostPreviewError(401, 'Open this localhost preview from Codex Remote to sign in.')
      if (url.pathname.startsWith('/__codex_preview__/')) throw new LocalhostPreviewError(404, 'Unknown preview endpoint')
      const headers = this.#requestHeaders(req, port, origin)
      headers.connection = 'Upgrade'
      headers.upgrade = 'websocket'
      const upstream = request({ hostname: '127.0.0.1', port, path: `${url.pathname}${url.search}`, headers, agent: false })
      this.#track(upstream)
      const timeout = setTimeout(() => upstream.destroy(new LocalhostPreviewError(504, 'The localhost app took too long to upgrade.')), 30_000)
      timeout.unref()
      upstream.once('upgrade', (response, upstreamSocket, upstreamHead) => {
        clearTimeout(timeout)
        const responseHeaders = this.#responseHeaders(response, port, origin)
        responseHeaders.connection = 'Upgrade'
        responseHeaders.upgrade = 'websocket'
        const lines = Object.entries(responseHeaders).flatMap(([name, value]) => (Array.isArray(value) ? value : [value]).map(entry => `${name}: ${entry}`))
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join('\r\n')}\r\n\r\n`)
        if (upstreamHead.length) socket.write(upstreamHead)
        if (head.length) upstreamSocket.write(head)
        for (const connected of [socket, upstreamSocket]) {
          this.#sockets.add(connected)
          connected.once('close', () => this.#sockets.delete(connected))
        }
        socket.once('error', () => upstreamSocket.destroy())
        upstreamSocket.once('error', () => socket.destroy())
        socket.once('close', () => upstreamSocket.destroy())
        upstreamSocket.once('close', () => socket.destroy())
        upstreamSocket.pipe(socket).pipe(upstreamSocket)
      })
      upstream.once('response', response => {
        clearTimeout(timeout)
        response.resume()
        socketError(socket, 502, 'The localhost app did not accept the WebSocket connection.')
      })
      upstream.once('error', error => {
        clearTimeout(timeout)
        socketError(socket, error instanceof LocalhostPreviewError ? error.status : 502, error instanceof LocalhostPreviewError ? error.message : 'Could not reach the localhost WebSocket server.')
      })
      upstream.once('close', () => clearTimeout(timeout))
      socket.once('close', () => upstream.destroy())
      socket.once('error', () => upstream.destroy())
      upstream.end()
    } catch (error) {
      socketError(socket, error instanceof LocalhostPreviewError ? error.status : 502, error instanceof Error ? error.message : 'Preview unavailable')
    }
  }

  close(): void {
    this.#tickets.clear()
    for (const upstream of this.#requests) upstream.destroy()
    for (const socket of this.#sockets) socket.destroy()
  }
}
