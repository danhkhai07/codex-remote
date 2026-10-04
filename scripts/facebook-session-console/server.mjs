import http from 'node:http'
import { spawn } from 'node:child_process'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
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
const contentSecurityPolicy = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors https://remote.danhkhai.io.vn"
let accessCode = ''
let active = null
let jobReserved = false
let phase = 'Not started'
let lastResult = ''
let updatedAt = null

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
  for (const key of ['password', 'totpSecret', 'captchaKey']) {
    if (typeof value[key] !== 'string' || value[key].length < 6 || value[key].length > 300) throw new Error(`Invalid ${key}`)
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

async function status() {
  let config = null
  try { config = JSON.parse(await readFile(configFile, 'utf8')) } catch {}
  return {
    configured: Boolean(config), account: masked(config?.account),
    sessionSaved: await exists(sessionFile), running: Boolean(active || jobReserved),
    phase, lastResult, updatedAt,
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

async function startJob(action) {
  if (active || jobReserved) throw new Error('A job is already running')
  jobReserved = true
  try {
    const config = action === 'login' ? JSON.parse(await readFile(configFile, 'utf8')) : null
    if (action === 'check' && !await exists(sessionFile)) throw new Error('No saved session')
    phase = action === 'login' ? 'Opening Facebook' : 'Checking saved session'
    lastResult = ''
    updatedAt = new Date().toISOString()
    const child = spawn(process.env.FB_SESSION_PYTHON ?? '/root/.local/share/facebook-undetected-chromedriver/venv/bin/python', [path.join(here, 'worker_uc.py'), action], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: workerEnvironment(),
    })
    active = child
    child.stdin.end(JSON.stringify(config ?? {}))
    let lines = ''
    child.stdout.on('data', chunk => {
      lines += chunk.toString('utf8')
      while (lines.includes('\n')) {
        const index = lines.indexOf('\n')
        const line = lines.slice(0, index)
        lines = lines.slice(index + 1)
        try {
          const event = JSON.parse(line)
          if (typeof event.phase === 'string') phase = event.phase.slice(0, 160)
          if (typeof event.result === 'string') lastResult = event.result.slice(0, 160)
          updatedAt = new Date().toISOString()
        } catch {}
      }
    })
    child.stderr.on('data', () => {}) // Never log browser output or secrets.
    child.on('error', () => {
      phase = 'Browser could not start'
      lastResult = 'Browser task failed to start'
      active = null
      updatedAt = new Date().toISOString()
    })
    child.on('exit', code => {
      if (!lastResult) lastResult = code === 0 ? 'Finished' : 'Login or check did not complete'
      if (code !== 0 && phase === 'Checking saved session') phase = 'Check failed'
      active = null
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
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' })
    if (req.headers.origin && !['http://127.0.0.1:5217', 'https://p5217.danhkhai.io.vn'].includes(req.headers.origin)) {
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
    if (url.pathname === '/api/login' || url.pathname === '/api/check') {
      await body(req)
      await startJob(url.pathname.slice(5))
      return send(res, 202, await status())
    }
    return send(res, 404, { error: 'Not found' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    const expected = /Invalid|JSON required|Request too large|No saved session|already running|ENOENT/.test(message)
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
export { safeConfig, masked, handler, workerEnvironment }
