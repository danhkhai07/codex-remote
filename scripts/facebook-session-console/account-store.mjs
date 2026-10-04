import { randomUUID, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const accountPattern = /^[\w@.+-]{1,120}$/
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function safeAccount(value) {
  if (typeof value !== 'string' || !accountPattern.test(value)) throw new Error('Invalid account ID or email')
  return value
}

export function safeLabel(value) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 80 || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error('Invalid label')
  return value.trim()
}

export function safeSecret(value, name, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return null
  if (typeof value !== 'string' || value.length < 6 || value.length > 300) throw new Error(`Invalid ${name}`)
  if (name === 'totpSecret') {
    const secret = value.toUpperCase().replace(/\s/g, '')
    if (!/^[A-Z2-7]{16,}$/.test(secret)) throw new Error('Invalid TOTP secret')
    return secret
  }
  return value
}

async function exists(file) {
  try { await stat(file); return true } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function atomicJson(file, value) {
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
  await rename(temporary, file)
  await chmod(file, 0o600)
}

export class AccountStore {
  constructor(stateDir) {
    this.stateDir = stateDir
    this.registryFile = path.join(stateDir, 'accounts.json')
    this.records = []
    this.pending = Promise.resolve()
  }

  async initialize() {
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 })
    await chmod(this.stateDir, 0o700)
    try {
      const parsed = JSON.parse(await readFile(this.registryFile, 'utf8'))
      if (!Array.isArray(parsed.accounts)) throw new Error('Invalid account registry')
      this.records = parsed.accounts.map(record => {
        if (!record || !idPattern.test(record.id) || typeof record.label !== 'string' || !['legacy', 'managed'].includes(record.location)) throw new Error('Invalid account registry')
        return { id: record.id, label: safeLabel(record.label), location: record.location }
      })
      if (new Set(this.records.map(record => record.id)).size !== this.records.length || this.records.filter(record => record.location === 'legacy').length > 1) throw new Error('Invalid account registry')
      await chmod(this.registryFile, 0o600)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    // A crash may happen after creating the legacy record but before writing the
    // registry. Reconciliation never moves or rewrites the original config/profile.
    const legacyFile = path.join(this.stateDir, 'account.json')
    if (await exists(legacyFile) && !this.records.some(record => record.location === 'legacy')) {
      const config = JSON.parse(await readFile(legacyFile, 'utf8'))
      safeAccount(config.account)
      this.records.unshift({ id: randomUUID(), label: 'Existing account', location: 'legacy' })
      await this.save()
    }
  }

  async save(records = this.records) { await atomicJson(this.registryFile, { version: 1, accounts: records }) }

  serialize(operation) {
    const next = this.pending.then(operation)
    this.pending = next.catch(() => {})
    return next
  }

  get(id) { return this.records.find(record => record.id === id) ?? null }

  directory(record) {
    if (record.location === 'legacy') return this.stateDir
    return path.join(this.stateDir, 'accounts', record.id)
  }

  configFile(record) { return path.join(this.directory(record), 'account.json') }
  sessionFile(record) { return path.join(this.directory(record), 'storage-state.json') }

  async config(record) { return JSON.parse(await readFile(this.configFile(record), 'utf8')) }
  async sessionSaved(record) { return exists(this.sessionFile(record)) }

  async create(value) {
    return this.serialize(async () => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid config')
      if (Object.keys(value).some(key => !['label', 'account', 'password', 'totpSecret'].includes(key))) throw new Error('Invalid config field')
      const account = safeAccount(value.account)
      const label = safeLabel(value.label)
      const password = safeSecret(value.password, 'password')
      const totpSecret = safeSecret(value.totpSecret, 'totpSecret', true)
      for (const record of this.records) {
        const existing = await this.config(record)
        if (existing.account.toLowerCase() === account.toLowerCase()) throw new Error('Account already exists')
      }
      const record = { id: randomUUID(), label, location: 'managed' }
      const directory = this.directory(record)
      await mkdir(path.dirname(directory), { recursive: true, mode: 0o700 })
      await chmod(path.dirname(directory), 0o700)
      await mkdir(directory, { mode: 0o700 })
      await atomicJson(this.configFile(record), { account, password, ...(totpSecret ? { totpSecret } : {}) })
      const nextRecords = [...this.records, record]
      try { await this.save(nextRecords) } catch (error) {
        await rm(directory, { recursive: true, force: true })
        throw error
      }
      this.records = nextRecords
      return record
    })
  }

  async update(id, value) {
    return this.serialize(async () => {
      const record = this.get(id)
      if (!record) return null
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid config')
      if (value.account !== undefined) throw new Error('Account identifier is immutable')
      if (Object.keys(value).some(key => !['label', 'password', 'totpSecret'].includes(key))) throw new Error('Invalid config field')
      const current = await this.config(record)
      const next = { ...current }
      if (value.password !== undefined && value.password !== '') next.password = safeSecret(value.password, 'password')
      if (value.totpSecret !== undefined && value.totpSecret !== '') next.totpSecret = safeSecret(value.totpSecret, 'totpSecret')
      const label = value.label === undefined ? record.label : safeLabel(value.label)
      if (JSON.stringify(next) !== JSON.stringify(current)) await atomicJson(this.configFile(record), next)
      if (label !== record.label) {
        const nextRecords = this.records.map(item => item.id === record.id ? { ...item, label } : item)
        await this.save(nextRecords)
        this.records = nextRecords
      }
      return record
    })
  }
}
