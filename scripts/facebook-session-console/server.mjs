import http from 'node:http'
import { spawn } from 'node:child_process'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { AccountStore } from './account-store.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const stateDir = process.env.FB_SESSION_STATE_DIR ?? '/root/.local/state/facebook-session-console'
const accessFile = path.join(stateDir, 'access-code')
const port = Number(process.env.FB_SESSION_PORT ?? 5217)
const host = '127.0.0.1'
const contentSecurityPolicy = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors https://remote.danhkhai.io.vn"
let accessCode = ''
const accounts = new AccountStore(stateDir)
let active = null
let jobReserved = false
let accountMutationPending = 0
const runtime = new Map()

function state(id) {
  if (!runtime.has(id)) runtime.set(id, {
    phase: 'Not started', lastResult: '', updatedAt: null,
    manualAvailable: false, manualFrame: null, manualStage: null,
  })
  return runtime.get(id)
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'Content-Security-Policy': contentSecurityPolicy,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  })
  res.end(data)
}

function sendFrame(res, frame) {
  res.writeHead(200, {
    'Content-Type': 'image/jpeg',
    'Content-Length': frame.length,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': contentSecurityPolicy,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  })
  res.end(frame)
}

function sendAvatar(res, avatar) {
  res.writeHead(200, {
    'Content-Type': avatar.type,
    'Content-Length': avatar.bytes.length,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': contentSecurityPolicy,
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  })
  res.end(avatar.bytes)
}

async function body(req) {
  if (req.headers['content-type'] !== 'application/json') throw new Error('JSON required')
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > 8192) throw new Error('Request too large')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('Invalid JSON') }
}

async function binaryBody(req, limit = 2 * 1024 * 1024) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('Avatar image is too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function authorized(req) {
  const supplied = req.headers['x-session-console-key']
  if (typeof supplied !== 'string') return false
  const suppliedBytes = Buffer.from(supplied)
  const expectedBytes = Buffer.from(accessCode)
  if (suppliedBytes.length !== expectedBytes.length) return false
  return timingSafeEqual(suppliedBytes, expectedBytes)
}

function masked(account) {
  if (!account) return null
  if (account.length < 6) return '••••'
  return `${account.slice(0, 3)}•••${account.slice(-2)}`
}

function safeManualAction(value) {
  if (!value || typeof value !== 'object') throw new Error('Invalid browser action')
  const coordinate = item => Number.isInteger(item) && item >= 0 && item < 1280
  const vertical = item => Number.isInteger(item) && item >= 0 && item < 800
  if (value.type === 'click' && coordinate(value.x) && vertical(value.y)) {
    return { type: 'click', x: value.x, y: value.y }
  }
  if (value.type === 'drag' && coordinate(value.x) && vertical(value.y) && coordinate(value.toX) && vertical(value.toY)) {
    return { type: 'drag', x: value.x, y: value.y, toX: value.toX, toY: value.toY }
  }
  if (value.type === 'scroll' && Number.isInteger(value.deltaY) && value.deltaY !== 0 && Math.abs(value.deltaY) <= 600) {
    return { type: 'scroll', deltaY: value.deltaY }
  }
  if (value.type === 'text' && typeof value.text === 'string' && value.text.length >= 1 && value.text.length <= 80 && ![...value.text].some(character => {
    const code = character.codePointAt(0)
    return code < 32 || code === 127
  })) {
    return { type: 'text', text: value.text }
  }
  if (value.type === 'key' && ['Enter', 'Backspace', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(value.key)) {
    return { type: 'key', key: value.key }
  }
  throw new Error('Invalid browser action')
}

function currentTotp(secret, now = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bytes = []
  let value = 0, bits = 0
  for (const letter of secret) {
    const digit = alphabet.indexOf(letter)
    if (digit < 0) throw new Error('Invalid TOTP secret')
    value = (value << 5) | digit
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((value >>> bits) & 255)
      value &= (1 << bits) - 1
    }
  }
  const step = Math.floor(now / 30_000)
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest()
  const offset = digest[digest.length - 1] & 15
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return { code: String(number).padStart(6, '0'), expiresAt: (step + 1) * 30_000 }
}

async function status(record) {
  const config = await accounts.config(record)
  const current = state(record.id)
  const running = Boolean((active && active.id === record.id) || (jobReserved && jobReserved === record.id))
  const sessionSaved = await accounts.sessionSaved(record)
  const avatar = await accounts.avatarInfo(record)
  return {
    id: record.id, label: record.label, configured: true, account: masked(config.account),
    locked: record.locked, sessionSaved, running,
    sessionStatus: record.locked ? 'locked' : sessionSaved ? 'logged-in' : 'logged-out',
    activity: running ? current.phase : 'Idle',
    avatarVersion: avatar?.version ?? null,
    phase: current.phase === 'Not started' && sessionSaved ? 'Session ready' : current.phase,
    lastResult: current.lastResult, updatedAt: current.updatedAt,
    manualAvailable: Boolean(running && current.manualAvailable),
    manualStage: running && current.manualAvailable ? current.manualStage : null,
  }
}

async function list() {
  return { accounts: await Promise.all(accounts.records.map(status)), activeAccountId: active?.id ?? (jobReserved || null), capacity: 1 }
}

function workerEnvironment(directory = stateDir) {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    DISPLAY: process.env.DISPLAY ?? '',
    XAUTHORITY: process.env.XAUTHORITY ?? '',
    HOME: process.env.HOME ?? '/root',
    FB_SESSION_STATE_DIR: directory,
    FB_CHROME_PATH: process.env.FB_CHROME_PATH ?? '',
    FB_SESSION_DRY_RUN: process.env.FB_SESSION_DRY_RUN ?? '',
    FB_PLAYWRIGHT_MODULE: process.env.FB_PLAYWRIGHT_MODULE ?? '',
  }
}

async function startJob(record, action) {
  if (active || jobReserved || accountMutationPending) throw new Error('A job is already running')
  if (record.locked) throw new Error('Account is locked')
  jobReserved = record.id
  const current = state(record.id)
  try {
    const config = await accounts.config(record)
    if (action === 'check' && !await accounts.sessionSaved(record)) throw new Error('No saved session')
    current.phase = action === 'login' ? 'Opening Facebook' : 'Checking saved session'
    current.lastResult = ''
    current.updatedAt = new Date().toISOString()
    current.manualAvailable = false
    current.manualFrame = null
    current.manualStage = null
    const child = spawn(process.execPath, [process.env.FB_SESSION_WORKER ?? path.join(here, 'worker_manual.mjs'), action], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: workerEnvironment(accounts.directory(record)),
    })
    active = { id: record.id, child }
    child.stdin.on('error', () => {}) // A browser exit can race an owner click.
    child.stdin.write(`${JSON.stringify(action === 'login' ? { account: config.account, password: config.password, ...(config.totpSecret ? { totpSecret: config.totpSecret } : {}) } : { account: config.account })}\n`)
    let lines = ''
    child.stdout.on('data', chunk => {
      lines += chunk.toString('utf8')
      while (lines.includes('\n')) {
        const index = lines.indexOf('\n')
        const line = lines.slice(0, index)
        lines = lines.slice(index + 1)
        if (line.length > 2_000_000 || active?.child !== child || active.id !== record.id) continue
        try {
          const event = JSON.parse(line)
          if (typeof event.phase === 'string') current.phase = event.phase.slice(0, 160)
          if (typeof event.result === 'string') current.lastResult = event.result.slice(0, 160)
          if (typeof event.manual === 'boolean') {
            current.manualAvailable = event.manual
            current.manualStage = current.manualAvailable && typeof event.manualStage === 'string' ? event.manualStage : null
            if (!current.manualAvailable) current.manualFrame = null
          }
          if (current.manualAvailable && typeof event.frame === 'string' && event.frame.length <= 1_800_000) {
            const frame = Buffer.from(event.frame, 'base64')
            if (frame.length >= 3 && frame[0] === 0xff && frame[1] === 0xd8 && frame[2] === 0xff) current.manualFrame = frame
          }
          current.updatedAt = new Date().toISOString()
        } catch {}
      }
      if (lines.length > 2_000_000) child.kill('SIGTERM')
    })
    child.stderr.on('data', () => {}) // Never log browser output or secrets.
    child.on('error', () => {
      if (active?.child !== child) return
      current.phase = 'Browser could not start'
      current.lastResult = 'Browser task failed to start'
      active = null
      current.manualAvailable = false
      current.manualFrame = null
      current.manualStage = null
      current.updatedAt = new Date().toISOString()
    })
    child.on('exit', code => {
      if (active?.child !== child) return
      if (!current.lastResult) current.lastResult = code === 0 ? 'Finished' : 'Login or check did not complete'
      if (code !== 0 && current.phase === 'Checking saved session') current.phase = 'Check failed'
      active = null
      current.manualAvailable = false
      current.manualFrame = null
      current.manualStage = null
      current.updatedAt = new Date().toISOString()
    })
  } finally { jobReserved = false }
}

async function handler(req, res) {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/app.js' || url.pathname === '/app.css')) {
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
      const type = name.endsWith('.js') ? 'text/javascript; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8'
      return send(res, 200, await readFile(path.join(here, name), 'utf8'), type)
    }
    if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' })
    if (!authorized(req)) return send(res, 401, { error: 'Access code required' })
    if (url.pathname === '/api/accounts') {
      if (req.method === 'GET') return send(res, 200, await list())
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' })
      if (!validOrigin(req)) return send(res, 403, { error: 'Invalid origin' })
      if (active || jobReserved) return send(res, 409, { error: 'Wait for the current job' })
      const value = await body(req)
      if (active || jobReserved) return send(res, 409, { error: 'Wait for the current job' })
      accountMutationPending++
      try { await accounts.create(value) } finally { accountMutationPending-- }
      return send(res, 201, await list())
    }
    const match = /^\/api\/accounts\/([0-9a-f-]+)\/(status|config|avatar|login|check|stop|frame|totp|manual)$/.exec(url.pathname)
    if (!match) return send(res, 404, { error: 'Not found' })
    const record = accounts.get(match[1])
    if (!record) return send(res, 404, { error: 'Unknown account' })
    const endpoint = match[2]
    const current = state(record.id)
    if (req.method === 'GET') {
      if (endpoint === 'status') return send(res, 200, await status(record))
      if (endpoint === 'avatar') {
        const avatar = await accounts.avatar(record)
        return avatar ? sendAvatar(res, avatar) : send(res, 404, { error: 'No avatar saved' })
      }
      if (endpoint === 'frame') {
        if (active?.id !== record.id || !current.manualAvailable || !current.manualFrame) return send(res, 404, { error: 'No browser frame available' })
        return sendFrame(res, current.manualFrame)
      }
      if (endpoint === 'totp') {
        const job = active
        if (job?.id !== record.id || !current.manualAvailable || current.manualStage !== 'two-factor') return send(res, 404, { error: '2FA code is not needed now' })
        const config = await accounts.config(record)
        if (active !== job || !current.manualAvailable || current.manualStage !== 'two-factor') return send(res, 404, { error: '2FA code is not needed now' })
        if (!config.totpSecret) return send(res, 404, { error: 'No 2FA secret configured' })
        const now = Date.now()
        return send(res, 200, { ...currentTotp(config.totpSecret, now), serverNow: now })
      }
      return send(res, 405, { error: 'Method not allowed' })
    }
    if (endpoint === 'avatar' && req.method === 'DELETE') {
      if (!validOrigin(req)) return send(res, 403, { error: 'Invalid origin' })
      if (active || jobReserved) return send(res, 409, { error: 'Wait for the current job' })
      accountMutationPending++
      try { await accounts.removeAvatar(record.id) } finally { accountMutationPending-- }
      return send(res, 200, await list())
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' })
    if (!validOrigin(req)) return send(res, 403, { error: 'Invalid origin' })
    if (endpoint === 'avatar') {
      if (active || jobReserved) return send(res, 409, { error: 'Wait for the current job' })
      const type = req.headers['content-type']
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) return send(res, 400, { error: 'Use a JPEG, PNG, or WebP image' })
      const image = await binaryBody(req)
      if (active || jobReserved) return send(res, 409, { error: 'Wait for the current job' })
      accountMutationPending++
      try { await accounts.setAvatar(record.id, image, type) } finally { accountMutationPending-- }
      return send(res, 200, await list())
    }
    if (endpoint === 'config') {
      if (active || jobReserved) return send(res, 409, { error: 'Wait for the current job' })
      const value = await body(req)
      if (active || jobReserved) return send(res, 409, { error: 'Wait for the current job' })
      accountMutationPending++
      try { await accounts.update(record.id, value) } finally { accountMutationPending-- }
      return send(res, 200, await list())
    }
    if (endpoint === 'manual') {
      const job = active
      if (job?.id !== record.id || !current.manualAvailable || !job.child.stdin.writable) return send(res, 409, { error: 'Manual browser is not active for this account' })
      const action = safeManualAction(await body(req))
      if (active !== job || !current.manualAvailable || !job.child.stdin.writable) return send(res, 409, { error: 'Manual browser is not active for this account' })
      if (!job.child.stdin.write(`${JSON.stringify(action)}\n`)) return send(res, 503, { error: 'Browser is busy' })
      return send(res, 202, { accepted: true })
    }
    if (!['login', 'check', 'stop'].includes(endpoint)) return send(res, 405, { error: 'Method not allowed' })
    const target = endpoint === 'stop' ? active : null
    const options = await body(req)
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).length) return send(res, 400, { error: 'Invalid job options' })
    if (endpoint === 'stop') {
      if (!target || active !== target || target.id !== record.id) return send(res, 409, { error: 'No browser job is running for this account' })
      current.phase = 'Stopped by owner'
      current.lastResult = 'Browser task stopped'
      current.manualAvailable = false
      current.manualFrame = null
      current.manualStage = null
      target.child.kill('SIGINT')
      return send(res, 202, await list())
    }
    if (active || jobReserved || accountMutationPending) return send(res, 409, { error: 'A job is already running' })
    await startJob(record, endpoint)
    return send(res, 202, await list())
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    const conflict = /Account already exists|already running|Account is locked/.test(message)
    const expected = /Invalid|immutable|JSON required|Request too large|Avatar image is too large|No saved session|Account is locked/.test(message)
    return send(res, conflict ? 409 : expected ? 400 : 500, { error: conflict || expected ? message : 'Unexpected server error' })
  }
}

function validOrigin(req) {
  return !req.headers.origin || [`http://${host}:${port}`, 'https://p5217.danhkhai.io.vn'].includes(req.headers.origin)
}

async function main() {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port')
  await mkdir(stateDir, { recursive: true, mode: 0o700 })
  await chmod(stateDir, 0o700)
  try { accessCode = (await readFile(accessFile, 'utf8')).trim() } catch {
    accessCode = randomBytes(24).toString('base64url')
    await writeFile(accessFile, `${accessCode}\n`, { flag: 'wx', mode: 0o600 })
  }
  await chmod(accessFile, 0o600)
  if (accessCode.length < 30) throw new Error('Invalid access code')
  await accounts.initialize()
  http.createServer(handler).listen(port, host)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(() => { process.exitCode = 1 })
export { masked, safeManualAction, currentTotp, handler, workerEnvironment }
