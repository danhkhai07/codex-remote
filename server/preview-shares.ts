import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { previewPath, validatePreviewOriginTemplate } from './localhost-preview.js'
import type { ServicesStore } from './services.js'

export const SHARE_COOKIE = '__Host-codex_preview_share'
export const SHARE_REDEEM = '/__codex_preview__/share-redeem'
const MAX_RECORDS = 512, MAX_ACTIVE = 128, MAX_WATCHERS = 2048, MAX_HANDOFFS = 1024
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
type Grant = { id: string; label: string; serviceName: string; serviceIdentity: string; port: number; path: string; createdAt: number; expiresAt: number; revokedAt: number | null }
export type PreviewShare = { id: string; label: string; serviceName: string; port: number; path: string; createdAt: string; expiresAt: string; revokedAt: string | null; status: 'active' | 'expired' | 'revoked' | 'unavailable'; url?: string }
export type ShareAccess = { valid: () => boolean; watch: (close: () => void) => () => void }
export class PreviewShareError extends Error { constructor(readonly status: number, message: string) { super(message) } }
const iso = (value: number) => new Date(value).toISOString()

/** Single gateway writer. Stored grants contain no raw bearer capability or owner key. */
export class PreviewShares {
  private grants = new Map<string, Grant>()
  private handoffs = new Map<string, { id: string; port: number; expiresAt: number }>()
  private watchers = new Set<{ id: string; end: () => void }>()
  private healthy = true
  private unwatchServices: () => void
  private readonly template?: string
  private readonly ports: Set<number>
  private readonly publicOrigin: string
  private readonly signingSecret: string
  constructor(private options: { services: ServicesStore; secret: string; publicOrigin: string; originTemplate?: string; ports: number[]; blockedPorts: number[]; file?: string }) {
    this.publicOrigin = new URL(options.publicOrigin).origin
    this.signingSecret = options.secret
    this.template = options.originTemplate ? validatePreviewOriginTemplate(options.originTemplate) : undefined
    this.ports = new Set(options.ports.filter(port => Number.isInteger(port) && port >= 1024 && port <= 65535 && !options.blockedPorts.includes(port)))
    if (this.template && new URL(this.template.replace('{port}', '3000')).origin === this.publicOrigin) throw Error('Share origin must be isolated')
    if (options.file && existsSync(options.file)) {
      const stat = lstatSync(options.file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_000_000) throw Error('Invalid preview share store')
      const state = JSON.parse(readFileSync(options.file, 'utf8'))
      if (state.version !== 1 || !Array.isArray(state.grants) || state.grants.length > MAX_RECORDS) throw Error('Invalid preview share store')
      for (const grant of state.grants) {
        if (!uuid(grant.id) || !uuid(grant.serviceIdentity) || typeof grant.label !== 'string' || grant.label.length > 120 ||
          typeof grant.serviceName !== 'string' || grant.serviceName.length > 120 || !Number.isInteger(grant.port) || grant.port < 1024 || grant.port > 65535 ||
          typeof grant.path !== 'string' || Buffer.byteLength(grant.path) > 1024 || previewPath(grant.path) !== grant.path || !Number.isSafeInteger(grant.createdAt) || grant.createdAt < 0 ||
          grant.createdAt > Date.now() || !Number.isSafeInteger(grant.expiresAt) || grant.expiresAt > 8_640_000_000_000_000 || grant.expiresAt <= grant.createdAt || grant.expiresAt - grant.createdAt > 86400_000 ||
          (grant.revokedAt !== null && (!Number.isSafeInteger(grant.revokedAt) || grant.revokedAt < grant.createdAt)) || this.grants.has(grant.id)) throw Error('Invalid preview share record')
        this.grants.set(grant.id, grant)
      }
    }
    this.unwatchServices = options.services.watch(() => this.invalidate())
  }
  get enabled() { return Boolean(this.healthy && this.template?.startsWith('https:') && this.publicOrigin.startsWith('https:') && this.ports.size) }
  formOrigins() { return this.enabled ? [...this.ports].map(port => this.template!.replace('{port}', String(port))).join(' ') : "'none'" }
  private usable(grant: Grant): boolean {
    return this.enabled && this.ports.has(grant.port) && this.options.services.identity(grant.port) === grant.serviceIdentity
  }
  private status(grant: Grant): PreviewShare['status'] {
    return grant.revokedAt !== null ? 'revoked' : grant.expiresAt <= Date.now() ? 'expired' : !this.usable(grant) ? 'unavailable' : 'active'
  }
  private mac(domain: string, value: string) { return createHmac('sha256', this.signingSecret).update(`codex-preview-share-${domain}-v1\0${value}`).digest('base64url') }
  private token(grant: Grant) { return `${grant.id}.${this.mac('capability', JSON.stringify(grant))}` }
  private equal(left: string, right: string) { const a = Buffer.from(left), b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b) }
  private publicGrant(grant: Grant): PreviewShare {
    const status = this.status(grant)
    return { id: grant.id, label: grant.label, serviceName: grant.serviceName, port: grant.port, path: grant.path,
      createdAt: iso(grant.createdAt), expiresAt: iso(grant.expiresAt), revokedAt: grant.revokedAt === null ? null : iso(grant.revokedAt), status,
      ...(status === 'active' ? { url: `${this.publicOrigin}/preview/share#${this.token(grant)}` } : {}) }
  }
  private save(grants: Map<string, Grant>) {
    if (this.options.file) {
      const file = this.options.file, temp = `${file}.${randomUUID()}.tmp`
      let fd: number | undefined
      try {
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
        fd = openSync(temp, 'wx', 0o600); writeFileSync(fd, JSON.stringify({ version: 1, grants: [...grants.values()] }) + '\n')
        fsyncSync(fd); closeSync(fd); fd = undefined; renameSync(temp, file)
        fd = openSync(dirname(file), 'r'); fsyncSync(fd)
      } catch { this.healthy = false; this.invalidate(); throw Error('Unable to persist preview shares; sharing is disabled until storage is repaired') }
      finally { if (fd !== undefined) closeSync(fd); try { unlinkSync(temp) } catch { /* renamed */ } }
    }
    this.grants = grants
    this.invalidate()
  }
  private invalidate() {
    for (const [key, ticket] of this.handoffs) if (ticket.expiresAt <= Date.now() || !this.valid(ticket.id, ticket.port)) this.handoffs.delete(key)
    for (const watcher of this.watchers) if (!this.valid(watcher.id)) watcher.end()
  }
  async list(live: () => void = () => {}) {
    live()
    const identities = new Map(this.options.services.list().filter(service => service.port !== null)
      .map(service => [service.port!, this.options.services.identity(service.port!)]))
    const snapshot = await this.options.services.snapshot(); live()
    // Recheck current generations after probes; registry may have changed while awaiting them.
    const current = new Map(this.options.services.list().map(service => [service.port, service]))
    return { links: [...this.grants.values()].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)).map(grant => this.publicGrant(grant)),
      services: snapshot.services.filter(service => this.enabled && service.port !== null && this.ports.has(service.port) &&
        identities.get(service.port) !== undefined && identities.get(service.port) === this.options.services.identity(service.port) &&
        JSON.stringify(current.get(service.port)) === JSON.stringify((({ running: _running, ...entry }) => entry)(service)))
        .map(service => ({ port: service.port!, name: service.name, path: service.path, running: service.running })), serverNow: iso(Date.now()) }
  }
  create(value: Record<string, unknown>): PreviewShare {
    const port = value.port
    if (!this.enabled) throw new PreviewShareError(503, 'Preview sharing needs configured HTTPS preview ports')
    if (typeof port !== 'number' || !this.ports.has(port)) throw new PreviewShareError(400, 'Select an allowed preview service')
    const service = this.options.services.list().find(entry => entry.port === port), identity = this.options.services.identity(port)
    if (!service || !identity) throw new PreviewShareError(400, 'Select a registered preview service')
    if (!Number.isInteger(value.ttlSeconds) || Number(value.ttlSeconds) < 1 || Number(value.ttlSeconds) > 86400) throw new PreviewShareError(400, 'Link lifetime must be between 1 second and 24 hours')
    if (value.label !== undefined && (typeof value.label !== 'string' || value.label.length > 120 || [...value.label].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))) throw new PreviewShareError(400, 'Label must be at most 120 characters')
    const path = previewPath(value.path ?? service.path), now = Date.now()
    if (Buffer.byteLength(path) > 1024) throw new PreviewShareError(400, 'Share navigation path must be at most 1024 UTF-8 bytes')
    const active = [...this.grants.values()].filter(grant => this.status(grant) === 'active')
    if (active.length >= MAX_ACTIVE) throw new PreviewShareError(429, 'Too many active share links; revoke an existing link')
    // Never evict an active grant. Bounded closed history is newest-first.
    const closed = [...this.grants.values()].filter(grant => this.status(grant) !== 'active').sort((a, b) => b.createdAt - a.createdAt)
    const next = new Map([...active, ...closed.slice(0, MAX_RECORDS - active.length - 1)].map(grant => [grant.id, grant]))
    const grant: Grant = { id: randomUUID(), label: (value.label as string | undefined)?.trim() ?? '', serviceName: service.name,
      serviceIdentity: identity, port, path, createdAt: now, expiresAt: now + Number(value.ttlSeconds) * 1000, revokedAt: null }
    next.set(grant.id, grant); this.save(next)
    return this.publicGrant(grant)
  }
  revoke(id: string) {
    if (!uuid(id)) throw new PreviewShareError(400, 'Invalid share ID')
    const grant = this.grants.get(id)
    if (!grant || grant.revokedAt !== null) return
    this.save(new Map(this.grants).set(id, { ...grant, revokedAt: Date.now() }))
  }
  valid(id: string, port?: number): boolean {
    const grant = this.grants.get(id)
    return Boolean(grant && (port === undefined || port === grant.port) && this.status(grant) === 'active')
  }
  exchange(token: unknown): { url: string; ticket: string } {
    if (typeof token !== 'string' || token.length !== 80) throw new PreviewShareError(401, 'Share link is invalid or no longer available')
    const grant = this.grants.get(token.slice(0, 36))
    if (!grant || !this.valid(grant.id) || !this.equal(token, this.token(grant))) throw new PreviewShareError(401, 'Share link is invalid or no longer available')
    this.invalidate()
    if (this.handoffs.size >= MAX_HANDOFFS) throw new PreviewShareError(429, 'Too many pending share openings. Retry shortly.')
    const ticket = randomBytes(32).toString('base64url')
    this.handoffs.set(ticket, { id: grant.id, port: grant.port, expiresAt: Math.min(Date.now() + 60_000, grant.expiresAt) })
    return { url: this.template!.replace('{port}', String(grant.port)) + SHARE_REDEEM, ticket }
  }
  redeem(ticket: unknown, port: number): { path: string; cookie: string } {
    const grantTicket = typeof ticket === 'string' && ticket.length === 43 ? this.handoffs.get(ticket) : undefined
    if (!grantTicket || grantTicket.port !== port || grantTicket.expiresAt <= Date.now() || !this.valid(grantTicket.id, port)) throw new PreviewShareError(401, 'Share opening expired; open the original link again')
    this.handoffs.delete(ticket as string)
    const grant = this.grants.get(grantTicket.id)!
    const body = `${grant.id}.${port}.${grant.expiresAt}`
    const value = `${body}.${this.mac('cookie', body)}`
    return { path: grant.path, cookie: `${SHARE_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.ceil((grant.expiresAt - Date.now()) / 1000))}` }
  }
  access(cookie: string, port: number): ShareAccess | null {
    const entries = cookie.split(';').map(part => part.trim()).filter(part => part.startsWith(SHARE_COOKIE + '='))
    if (entries.length !== 1 || entries[0].length > 200) return null
    const value = entries[0].slice(SHARE_COOKIE.length + 1), [id, p, expiry, mac, extra] = value.split('.')
    if (extra !== undefined || !uuid(id) || p !== String(port) || !mac || !this.equal(mac, this.mac('cookie', `${id}.${p}.${expiry}`))) return null
    const grant = this.grants.get(id)
    if (!grant || expiry !== String(grant.expiresAt) || !this.valid(id, port)) return null
    return { valid: () => this.valid(id, port), watch: close => this.watch(id, port, close) }
  }
  private watch(id: string, port: number, close: () => void) {
    if (!this.valid(id, port)) { close(); return () => {} }
    if (this.watchers.size >= MAX_WATCHERS) throw new PreviewShareError(503, 'Too many active share connections')
    const watcher = { id, end: () => { cleanup(); close() } }
    const timer = setTimeout(watcher.end, Math.max(1, this.grants.get(id)!.expiresAt - Date.now())); timer.unref()
    const cleanup = () => { clearTimeout(timer); this.watchers.delete(watcher) }
    this.watchers.add(watcher)
    return cleanup
  }
  close() { this.unwatchServices(); this.handoffs.clear(); for (const watcher of this.watchers) watcher.end() }
}
