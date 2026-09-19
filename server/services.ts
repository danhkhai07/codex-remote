import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
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
  private entries: HostedService[] = []
  constructor(private file?: string, private probe = isPortListening, private blockedPorts: number[] = []) {
    if (file && existsSync(file)) {
      const stored = JSON.parse(readFileSync(file, 'utf8'))
      if (stored.version !== 1 || !Array.isArray(stored.services) || stored.services.length > 100) throw Error('Invalid services registry')
      this.entries = stored.services.map((entry: HostedService) => ({ ...validateService(entry), updatedAt: text(entry.updatedAt, 'Ngày cập nhật', 40, true) }))
      if (new Set(this.entries.map(serviceKey)).size !== this.entries.length) throw Error('Duplicate service port')
    }
  }
  private save(entries: HostedService[]) {
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true })
      const temporary = `${this.file}.${randomUUID()}.tmp`
      writeFileSync(temporary, JSON.stringify({ version: 1, services: entries }, null, 2) + '\n', { mode: 0o600 })
      renameSync(temporary, this.file)
    }
    this.entries = entries
  }
  list(): HostedService[] { return this.entries.map(entry => ({ ...entry })).sort((a, b) => (a.port ?? 0) - (b.port ?? 0) || a.path.localeCompare(b.path)) }
  upsert(value: unknown): HostedService {
    const input = validateService(value)
    if (input.port !== null && this.blockedPorts.includes(input.port)) throw new ServiceError(400, 'Port này dành cho Codex Remote')
    if (this.entries.length >= 100 && !this.entries.some(entry => serviceKey(entry) === serviceKey(input))) throw new ServiceError(400, 'Tối đa 100 dịch vụ')
    const service = { ...input, updatedAt: new Date().toISOString() }
    this.save([...this.entries.filter(entry => serviceKey(entry) !== serviceKey(input)), service])
    return service
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
