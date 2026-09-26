import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'

export type HostedService = {
  port: number | null
  name: string
  summary: string
  prLabel: string
  prUrl: string
  branch: string
  directory: string
  path: string
  kind: 'app' | 'prototype' | 'api'
  updatedAt: string
}
export type ServiceInput = Omit<HostedService, 'updatedAt'>
export type ServicesSnapshot = {
  services: (HostedService & { running: boolean | null })[]
  checkedAt: string
}
export function serviceKey(service: Pick<HostedService, 'port' | 'path'>): string {
  return service.port === null ? `path:${service.path}` : `port:${service.port}`
}
export class ServiceError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
const serviceIdentity = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)

function text(value: unknown, name: string, max: number, required = false): string {
  if (value === undefined && !required) return ''
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new ServiceError(400, `${name} không hợp lệ`)
  }
  return value.trim()
}

export function validateService(value: unknown): ServiceInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError(400, 'Dịch vụ không hợp lệ')
  const v = value as Record<string, unknown>
  if (v.port !== null && (!Number.isInteger(v.port) || Number(v.port) < 1024 || Number(v.port) > 65535)) throw new ServiceError(400, 'Port phải từ 1024 đến 65535')
  const prUrl = text(v.prUrl, 'Link PR', 1000)
  if (prUrl) {
    let url: URL
    try { url = new URL(prUrl) } catch { throw new ServiceError(400, 'Link PR không hợp lệ') }
    if (url.protocol !== 'https:' || url.username || url.password) throw new ServiceError(400, 'Link PR phải dùng HTTPS')
  }
  const path = text(v.path ?? '/', 'Đường dẫn', 2000, true)
  if (!path.startsWith('/') || path.startsWith('//') || [...path].some(character => character.charCodeAt(0) <= 32 || character === '\\')) throw new ServiceError(400, 'Đường dẫn phải bắt đầu bằng một dấu /')
  const kind = v.kind ?? 'app'
  if (!['app', 'prototype', 'api'].includes(String(kind))) throw new ServiceError(400, 'Loại dịch vụ không hợp lệ')
  return {
    port: v.port === null ? null : Number(v.port), name: text(v.name, 'Tên dịch vụ', 120, true),
    summary: text(v.summary, 'Nội dung', 2000, true), prLabel: text(v.prLabel, 'PR / công việc', 200, true),
    prUrl, branch: text(v.branch, 'Branch', 300), directory: text(v.directory, 'Thư mục', 1000),
    path, kind: kind as ServiceInput['kind'],
  }
}

/** Probe only registered loopback ports; never send requests or follow redirects. */
export function isPortListening(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const finish = (running: boolean) => { socket.destroy(); resolve(running) }
    socket.setTimeout(800)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('timeout', () => finish(false))
  })
}

export class ServicesStore {
  private entries: (HostedService & { identity: string })[] = []
  private listeners = new Set<() => void>()
  private identityHealthy = true
  constructor(private file?: string, private probe = isPortListening, private blockedPorts: number[] = []) {
    if (file && existsSync(file)) {
      const stored = JSON.parse(readFileSync(file, 'utf8'))
      if (stored.version !== 1 || !Array.isArray(stored.services) || stored.services.length > 100) throw Error('Invalid services registry')
      if (stored.services.some((entry: { identity?: unknown }) => entry.identity !== undefined && !serviceIdentity(entry.identity))) throw Error('Invalid service identity')
      this.entries = stored.services.map((entry: HostedService & { identity?: string }) => ({ ...validateService(entry), updatedAt: text(entry.updatedAt, 'Ngày cập nhật', 40, true),
        identity: serviceIdentity(entry.identity) ? entry.identity : randomUUID() }))
      if (new Set(this.entries.map(serviceKey)).size !== this.entries.length) throw Error('Duplicate service port')
      // Persist a generation for legacy entries before any share can bind to them.
      if (stored.services.some((entry: { identity?: string }) => !entry.identity)) this.save(this.entries)
    }
  }
  private save(entries: (HostedService & { identity: string })[]) {
    if (this.file) {
      const temporary = `${this.file}.${randomUUID()}.tmp`
      let fd: number | undefined
      try {
        mkdirSync(dirname(this.file), { recursive: true })
        fd = openSync(temporary, 'wx', 0o600); writeFileSync(fd, JSON.stringify({ version: 1, services: entries }, null, 2) + '\n')
        fsyncSync(fd); closeSync(fd); fd = undefined; renameSync(temporary, this.file)
        fd = openSync(dirname(this.file), 'r'); fsyncSync(fd)
      } catch (error) {
        this.identityHealthy = false
        for (const changed of this.listeners) changed()
        throw error
      } finally { if (fd !== undefined) closeSync(fd); try { unlinkSync(temporary) } catch { /* renamed */ } }
    }
    this.entries = entries
    for (const changed of this.listeners) changed()
  }
  list(): HostedService[] { return this.entries.map(({ identity: _identity, ...entry }) => ({ ...entry })).sort((a, b) => (a.port ?? 0) - (b.port ?? 0) || a.path.localeCompare(b.path)) }
  identity(port: number): string | undefined { return this.identityHealthy ? this.entries.find(entry => entry.port === port)?.identity : undefined }
  watch(changed: () => void): () => void { this.listeners.add(changed); return () => { this.listeners.delete(changed) } }
  upsert(value: unknown): HostedService {
    const input = validateService(value)
    if (input.port !== null && this.blockedPorts.includes(input.port)) throw new ServiceError(400, 'Port này dành cho Codex Remote')
    if (this.entries.length >= 100 && !this.entries.some(entry => serviceKey(entry) === serviceKey(input))) throw new ServiceError(400, 'Tối đa 100 dịch vụ')
    const previous = this.entries.find(entry => serviceKey(entry) === serviceKey(input))
    const unchanged = previous && JSON.stringify(validateService(previous)) === JSON.stringify(input)
    const service = { ...input, updatedAt: new Date().toISOString(), identity: unchanged ? previous.identity : randomUUID() }
    this.save([...this.entries.filter(entry => serviceKey(entry) !== serviceKey(input)), service])
    const { identity: _identity, ...publicService } = service
    return publicService
  }
  remove(key: string) {
    if (!this.entries.some(entry => serviceKey(entry) === key)) throw new ServiceError(404, 'Không tìm thấy dịch vụ')
    this.save(this.entries.filter(entry => serviceKey(entry) !== key))
  }
  async snapshot(): Promise<ServicesSnapshot> {
    const services = await Promise.all(this.list().map(async entry => ({ ...entry, running: entry.port === null ? null : await this.probe(entry.port) })))
    return { services, checkedAt: new Date().toISOString() }
  }
}
