import { randomUUID, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const accountPattern = /^[\w@.+-]{1,120}$/
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const avatarTypes = new Map([
  ['image/jpeg', { extension: 'jpg', signature: bytes => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff }],
  ['image/png', { extension: 'png', signature: bytes => bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) }],
  ['image/webp', { extension: 'webp', signature: bytes => bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP' }],
])

export function safeAccount(value) {
  if (typeof value !== 'string' || !accountPattern.test(value)) throw new Error('Invalid account ID or email')
  return value
}

export function safeLabel(value) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 80 || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error('Invalid label')
  return value.trim()
}

export function safeLocked(value) {
  if (value === undefined) return false
  if (typeof value !== 'boolean') throw new Error('Invalid locked status')
  return value
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
    this.avatarDir = path.join(stateDir, 'avatars')
    this.records = []
    this.pending = Promise.resolve()
  }

  async initialize() {
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 })
    await chmod(this.stateDir, 0o700)
    await mkdir(this.avatarDir, { recursive: true, mode: 0o700 })
    await chmod(this.avatarDir, 0o700)
    try {
      const parsed = JSON.parse(await readFile(this.registryFile, 'utf8'))
      if (!Array.isArray(parsed.accounts)) throw new Error('Invalid account registry')
      this.records = parsed.accounts.map(record => {
        if (!record || !idPattern.test(record.id) || typeof record.label !== 'string' || !['legacy', 'managed'].includes(record.location)) throw new Error('Invalid account registry')
        return { id: record.id, label: safeLabel(record.label), location: record.location, locked: safeLocked(record.locked) }
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
      this.records.unshift({ id: randomUUID(), label: 'Existing account', location: 'legacy', locked: false })
      await this.save()
    }
  }

  async save(records = this.records) { await atomicJson(this.registryFile, { version: 2, accounts: records }) }

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
  facebookProfileFile(record) { return path.join(this.directory(record), 'facebook-profile.json') }
  facebookAvatarFile(record) { return path.join(this.directory(record), 'facebook-profile-avatar.png') }

  async facebookProfile(record) {
    try {
      const [profile, marker] = await Promise.all([
        readFile(this.facebookProfileFile(record), 'utf8').then(JSON.parse),
        readFile(this.sessionFile(record), 'utf8').then(JSON.parse),
      ])
      const name = safeLabel(profile.name)
      if (!profile.accountId || profile.accountId !== marker.accountId) return null
      let avatar = null
      try {
        const details = await stat(this.facebookAvatarFile(record))
        avatar = { file: this.facebookAvatarFile(record), type: 'image/png', version: `${Math.floor(details.mtimeMs)}-${details.size}` }
      } catch (error) { if (error.code !== 'ENOENT') throw error }
      return { name, avatar }
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return null
      throw error
    }
  }

  avatarFile(record, extension) { return path.join(this.avatarDir, `${record.id}.${extension}`) }

  async avatarInfo(record) {
    const profile = await this.facebookProfile(record)
    if (profile?.avatar) return profile.avatar
    for (const [type, descriptor] of avatarTypes) {
      const file = this.avatarFile(record, descriptor.extension)
      try {
        const details = await stat(file)
        return { file, type, version: `${Math.floor(details.mtimeMs)}-${details.size}` }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
    return null
  }

  async avatar(record) {
    const info = await this.avatarInfo(record)
    return info ? { ...info, bytes: await readFile(info.file) } : null
  }

  async config(record) { return JSON.parse(await readFile(this.configFile(record), 'utf8')) }
  async sessionSaved(record) { return exists(this.sessionFile(record)) }

  async create(value) {
    return this.serialize(async () => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid config')
      if (Object.keys(value).some(key => !['label', 'account', 'password', 'totpSecret', 'locked'].includes(key))) throw new Error('Invalid config field')
      const account = safeAccount(value.account)
      const label = safeLabel(value.label)
      const password = safeSecret(value.password, 'password')
      const totpSecret = safeSecret(value.totpSecret, 'totpSecret', true)
      const locked = safeLocked(value.locked)
      for (const record of this.records) {
        const existing = await this.config(record)
        if (existing.account.toLowerCase() === account.toLowerCase()) throw new Error('Account already exists')
      }
      const record = { id: randomUUID(), label, location: 'managed', locked }
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
      if (Object.keys(value).some(key => !['label', 'password', 'totpSecret', 'locked'].includes(key))) throw new Error('Invalid config field')
      const current = await this.config(record)
      const next = { ...current }
      if (value.password !== undefined && value.password !== '') next.password = safeSecret(value.password, 'password')
      if (value.totpSecret !== undefined && value.totpSecret !== '') next.totpSecret = safeSecret(value.totpSecret, 'totpSecret')
      const label = value.label === undefined ? record.label : safeLabel(value.label)
      const locked = value.locked === undefined ? record.locked : safeLocked(value.locked)
      if (JSON.stringify(next) !== JSON.stringify(current)) await atomicJson(this.configFile(record), next)
      if (label !== record.label || locked !== record.locked) {
        const nextRecords = this.records.map(item => item.id === record.id ? { ...item, label, locked } : item)
        await this.save(nextRecords)
        this.records = nextRecords
      }
      return this.get(record.id)
    })
  }

  async setAvatar(id, bytes, type) {
    return this.serialize(async () => {
      const record = this.get(id)
      if (!record) return null
      const descriptor = avatarTypes.get(type)
      if (!descriptor || !Buffer.isBuffer(bytes) || bytes.length < 32 || bytes.length > 2 * 1024 * 1024 || !descriptor.signature(bytes)) throw new Error('Invalid avatar image')
      const target = this.avatarFile(record, descriptor.extension)
      const temporary = `${target}.${randomBytes(8).toString('hex')}.tmp`
      try {
        await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' })
        await rename(temporary, target)
        await chmod(target, 0o600)
      } finally {
        await rm(temporary, { force: true })
      }
      for (const candidate of avatarTypes.values()) {
        if (candidate.extension !== descriptor.extension) await rm(this.avatarFile(record, candidate.extension), { force: true })
      }
      return this.avatarInfo(record)
    })
  }

  async removeAvatar(id) {
    return this.serialize(async () => {
      const record = this.get(id)
      if (!record) return null
      for (const descriptor of avatarTypes.values()) await rm(this.avatarFile(record, descriptor.extension), { force: true })
      return record
    })
  }
}
