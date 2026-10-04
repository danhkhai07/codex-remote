import http from 'node:http'
import { spawn } from 'node:child_process'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile, writeFile, mkdir, rename, stat, chmod } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const stateDir = process.env.FB_SESSION_STATE_DIR ?? '/root/.local/state/facebook-session-console'
const accessFile = path.join(stateDir, 'access-code')
const configFile = path.join(stateDir, 'account.json')
const sessionFile = path.join(stateDir, 'storage-state.json')
const port = Number(process.env.FB_SESSION_PORT ?? 5217)
const host = '127.0.0.1'
const contentSecurityPolicy = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors https://remote.danhkhai.io.vn"
let accessCode = ''
let active = null
let jobReserved = false
let phase = 'Not started'
let lastResult = ''
let updatedAt = null
let manualAvailable = false
let manualFrame = null
let manualStage = null

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

async function body(req) {
  if (req.headers['content-type'] !== 'application/json') throw new Error('JSON required')
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > 8192) throw new Error('Request too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function authorized(req) {
  const supplied = req.headers['x-session-console-key']
  if (typeof supplied !== 'string' || supplied.length !== accessCode.length) return false
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(accessCode))
}

async function exists(file) {
  try { await stat(file); return true } catch { return false }
}

async function atomicJson(file, value) {
  const temp = `${file}.${randomBytes(8).toString('hex')}.tmp`
  await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
  await rename(temp, file)
}

function safeAccount(value) {
  if (typeof value !== 'string' || value.length > 120 || !/^[\w@.+-]+$/.test(value)) throw new Error('Invalid account ID or email')
  return value
}

function safeConfig(value) {
  if (!value || typeof value !== 'object') throw new Error('Invalid config')
  const account = safeAccount(value.account)
  for (const key of ['password', 'totpSecret']) {
    if (typeof value[key] !== 'string' || value[key].length < 6 || value[key].length > 300) throw new Error(`Invalid ${key}`)
  }
  if (typeof value.captchaKey !== 'string' || value.captchaKey.length > 300 || (value.captchaKey.length > 0 && value.captchaKey.length < 6)) {
    throw new Error('Invalid captchaKey')
  }
  const totpSecret = value.totpSecret.toUpperCase().replace(/\s/g, '')
  if (!/^[A-Z2-7]{16,}$/.test(totpSecret)) throw new Error('Invalid TOTP secret')
  return { account, password: value.password, totpSecret, captchaKey: value.captchaKey }
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

async function status() {
  let config = null
  try { config = JSON.parse(await readFile(configFile, 'utf8')) } catch {}
  return {
    configured: Boolean(config), account: masked(config?.account),
    sessionSaved: await exists(sessionFile), running: Boolean(active || jobReserved),
    phase, lastResult, updatedAt, manualAvailable: Boolean(active && manualAvailable),
    manualStage: active && manualAvailable ? manualStage : null,
  }
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
  }
}

async function startJob(action, options = {}) {
  if (active || jobReserved) throw new Error('A job is already running')
  jobReserved = true
  try {
    const config = action === 'login' ? JSON.parse(await readFile(configFile, 'utf8')) : null
    if (action === 'login' && options.manualCaptcha === false && !config.captchaKey) throw new Error('2Captcha key required')
    if (action === 'check' && !await exists(sessionFile)) throw new Error('No saved session')
    phase = action === 'login' ? 'Opening Facebook' : 'Checking saved session'
    lastResult = ''
    updatedAt = new Date().toISOString()
    manualAvailable = false
    manualFrame = null
    manualStage = null
    const child = spawn(process.env.FB_SESSION_PYTHON ?? '/root/.local/share/facebook-undetected-chromedriver/venv/bin/python', [process.env.FB_SESSION_WORKER ?? path.join(here, 'worker_uc.py'), action], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: workerEnvironment(),
    })
    active = child
    child.stdin.on('error', () => {}) // A browser exit can race an owner click.
    child.stdin.write(`${JSON.stringify(action === 'login' ? { ...config, manualCaptcha: options.manualCaptcha !== false } : {})}\n`)
    let lines = ''
    child.stdout.on('data', chunk => {
      lines += chunk.toString('utf8')
      while (lines.includes('\n')) {
        const index = lines.indexOf('\n')
        const line = lines.slice(0, index)
        lines = lines.slice(index + 1)
        if (line.length > 2_000_000 || active !== child) continue
        try {
          const event = JSON.parse(line)
          if (typeof event.phase === 'string') phase = event.phase.slice(0, 160)
          if (typeof event.result === 'string') lastResult = event.result.slice(0, 160)
          if (typeof event.manual === 'boolean') {
            manualAvailable = event.manual
            manualStage = manualAvailable && typeof event.manualStage === 'string' ? event.manualStage : null
            if (!manualAvailable) manualFrame = null
          }
          if (manualAvailable && typeof event.frame === 'string' && event.frame.length <= 1_800_000) {
            const frame = Buffer.from(event.frame, 'base64')
            if (frame.length >= 3 && frame[0] === 0xff && frame[1] === 0xd8 && frame[2] === 0xff) manualFrame = frame
          }
          updatedAt = new Date().toISOString()
        } catch {}
      }
      if (lines.length > 2_000_000) child.kill('SIGTERM')
    })
    child.stderr.on('data', () => {}) // Never log browser output or secrets.
    child.on('error', () => {
      if (active !== child) return
      phase = 'Browser could not start'
      lastResult = 'Browser task failed to start'
      active = null
      manualAvailable = false
      manualFrame = null
      manualStage = null
      updatedAt = new Date().toISOString()
    })
    child.on('exit', code => {
      if (active !== child) return
      if (!lastResult) lastResult = code === 0 ? 'Finished' : 'Login or check did not complete'
      if (code !== 0 && phase === 'Checking saved session') phase = 'Check failed'
      active = null
      manualAvailable = false
      manualFrame = null
      manualStage = null
      updatedAt = new Date().toISOString()
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
    if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, await status())
    if (req.method === 'GET' && url.pathname === '/api/frame') {
      if (!active || !manualAvailable || !manualFrame) return send(res, 404, { error: 'No browser frame available' })
      return sendFrame(res, manualFrame)
    }
    if (req.method === 'GET' && url.pathname === '/api/totp') {
      if (!active || !manualAvailable || manualStage !== 'two-factor') return send(res, 404, { error: '2FA code is not needed now' })
      const config = JSON.parse(await readFile(configFile, 'utf8'))
      const now = Date.now()
      return send(res, 200, { ...currentTotp(config.totpSecret, now), serverNow: now })
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' })
    if (req.headers.origin && ![`http://${host}:${port}`, 'https://p5217.danhkhai.io.vn'].includes(req.headers.origin)) {
      return send(res, 403, { error: 'Invalid origin' })
    }
    if (url.pathname === '/api/config') {
      if (active || jobReserved) return send(res, 409, { error: 'Wait for the current job' })
      const next = safeConfig(await body(req))
      let previous = null
      try { previous = JSON.parse(await readFile(configFile, 'utf8')) } catch {}
      if (previous && previous.account !== next.account && await exists(sessionFile)) {
        return send(res, 409, { error: 'A saved session belongs to the previous account; this one-account version cannot replace it' })
      }
      await atomicJson(configFile, next)
      return send(res, 200, await status())
    }
    if (url.pathname === '/api/manual') {
      if (!active || !manualAvailable || !active.stdin.writable) return send(res, 409, { error: 'Manual CAPTCHA is not active' })
      const action = safeManualAction(await body(req))
      if (!active.stdin.write(`${JSON.stringify(action)}\n`)) return send(res, 503, { error: 'Browser is busy' })
      return send(res, 202, { accepted: true })
    }
    if (url.pathname === '/api/stop') {
      await body(req)
      if (!active) return send(res, 409, { error: 'No browser job is running' })
      phase = 'Stopped by owner'
      lastResult = 'Browser task stopped'
      manualAvailable = false
      manualFrame = null
      manualStage = null
      active.kill('SIGINT')
      return send(res, 202, await status())
    }
    if (url.pathname === '/api/login' || url.pathname === '/api/check') {
      const options = await body(req)
      if (url.pathname === '/api/login' && options.manualCaptcha !== undefined && typeof options.manualCaptcha !== 'boolean') {
        return send(res, 400, { error: 'Invalid CAPTCHA mode' })
      }
      await startJob(url.pathname.slice(5), options)
      return send(res, 202, await status())
    }
    return send(res, 404, { error: 'Not found' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    const expected = /Invalid|JSON required|Request too large|No saved session|already running|2Captcha key required|ENOENT/.test(message)
    return send(res, expected ? 400 : 500, { error: expected ? message : 'Unexpected server error' })
  }
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
  http.createServer(handler).listen(port, host)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(() => { process.exitCode = 1 })
export { safeConfig, masked, safeManualAction, currentTotp, handler, workerEnvironment }
