import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, stat, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { safeConfig, masked, safeManualAction, currentTotp } from './server.mjs'
import { totp, selectCodeInputs } from './worker.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

test('validates account secrets without exposing them', () => {
  const config = safeConfig({ account: '1234567890', password: 'secret-pass', totpSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', captchaKey: 'captcha-key-value' })
  assert.equal(config.account, '1234567890')
  assert.equal(masked(config.account), '123•••90')
  assert.throws(() => safeConfig({ ...config, account: 'bad account' }))
  assert.throws(() => safeConfig({ ...config, totpSecret: 'not-base32' }))
  assert.equal(safeConfig({ ...config, captchaKey: '' }).captchaKey, '')
})

test('manual browser commands are bounded and exclude arbitrary operations', () => {
  assert.deepEqual(safeManualAction({ type: 'click', x: 100, y: 200, extra: 'ignored' }), { type: 'click', x: 100, y: 200 })
  assert.deepEqual(safeManualAction({ type: 'drag', x: 1, y: 2, toX: 3, toY: 4 }), { type: 'drag', x: 1, y: 2, toX: 3, toY: 4 })
  assert.deepEqual(safeManualAction({ type: 'scroll', deltaY: -500 }), { type: 'scroll', deltaY: -500 })
  assert.throws(() => safeManualAction({ type: 'click', x: 1280, y: 2 }))
  assert.throws(() => safeManualAction({ type: 'scroll', deltaY: 100000 }))
  assert.throws(() => safeManualAction({ type: 'text', text: 'a\nother command' }))
  assert.throws(() => safeManualAction({ type: 'key', key: 'F12' }))
})

test('TOTP matches the RFC 6238 SHA1 vector', () => {
  assert.equal(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000), '287082')
  assert.deepEqual(currentTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000), { code: '287082', expiresAt: 60000 })
})

test('2FA selection ignores login/search fields and supports six code boxes', () => {
  const field = (overrides = {}) => ({ type: 'text', name: '', id: '', placeholder: '', ariaLabel: '', autocomplete: '', inputMode: '', maxLength: -1, disabled: false, readOnly: false, ...overrides })
  assert.deepEqual(selectCodeInputs([field({ name: 'email' }), field()]), { kind: 'single', indexes: [1] })
  assert.deepEqual(selectCodeInputs([field({ type: 'search' }), field({ name: 'approvals_code', maxLength: 6 }), field()]), { kind: 'single', indexes: [1] })
  assert.deepEqual(selectCodeInputs(Array.from({ length: 6 }, () => field({ maxLength: 1 }))), { kind: 'segmented', indexes: [0, 1, 2, 3, 4, 5] })
  assert.equal(selectCodeInputs([field(), field()]), null)
})

test('HTTP API requires access code and does not return stored secrets', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fb-session-test-'))
  const listener = net.createServer()
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port
  await new Promise(resolve => listener.close(resolve))
  const child = spawn(process.execPath, [path.join(here, 'server.mjs')], {
    env: { ...process.env, FB_SESSION_STATE_DIR: dir, FB_SESSION_PORT: String(port) },
    stdio: 'ignore',
  })
  try {
    const root = `http://127.0.0.1:${port}`
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(root)).ok) break } catch {}
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    const code = (await readFile(path.join(dir, 'access-code'), 'utf8')).trim()
    assert.equal((await stat(dir)).mode & 0o777, 0o700)
    assert.equal((await stat(path.join(dir, 'access-code'))).mode & 0o777, 0o600)
    assert.equal((await fetch(`${root}/api/status`)).status, 401)
    const headers = { 'X-Session-Console-Key': code, 'Content-Type': 'application/json' }
    const secrets = { account: '1234567890', password: 'secret-pass', totpSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', captchaKey: 'captcha-key-value' }
    const response = await fetch(`${root}/api/config`, { method: 'POST', headers, body: JSON.stringify(secrets) })
    assert.equal(response.status, 200)
    const returned = await response.text()
    assert.equal(returned.includes(secrets.password), false)
    assert.equal(returned.includes(secrets.captchaKey), false)
    assert.equal(returned.includes(secrets.totpSecret), false)
    assert.equal((await stat(path.join(dir, 'account.json'))).mode & 0o777, 0o600)
    assert.equal((await fetch(`${root}/api/config`, { method: 'POST', headers: { ...headers, Origin: 'https://other.example' }, body: JSON.stringify(secrets) })).status, 403)
    assert.equal((await fetch(`${root}/api/check`, { method: 'POST', headers, body: '{}' })).status, 400)
    await writeFile(path.join(dir, 'storage-state.json'), '{}', { mode: 0o600 })
    assert.equal((await fetch(`${root}/api/config`, { method: 'POST', headers, body: JSON.stringify({ ...secrets, account: '9999999999' }) })).status, 409)
  } finally {
    child.kill('SIGTERM')
    await new Promise(resolve => child.once('exit', resolve))
    await rm(dir, { recursive: true, force: true })
  }
})

test('manual browser stays open through CAPTCHA, 2FA and another verification step', { timeout: 15000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fb-manual-api-'))
  const worker = path.join(dir, 'stub-worker.mjs')
  await writeFile(worker, String.raw`
let buffer = ''
let started = false, stage = 0
process.stdin.on('data', chunk => {
  buffer += chunk.toString('utf8')
  while (buffer.includes('\n')) {
    const index = buffer.indexOf('\n')
    const line = JSON.parse(buffer.slice(0, index))
    buffer = buffer.slice(index + 1)
    if (!started) {
      started = true
      process.stdout.write(JSON.stringify({ phase: 'Continue in browser: CAPTCHA detected', manual: true, manualStage: 'captcha' }) + '\n')
      process.stdout.write(JSON.stringify({ frame: Buffer.from([255, 216, 255, 217]).toString('base64') }) + '\n')
    } else if (stage === 0 && line.type === 'click') {
      stage = 1
      process.stdout.write(JSON.stringify({ phase: 'Continue in browser: 2FA code form detected', manual: true, manualStage: 'two-factor' }) + '\n')
    } else if (stage === 1 && line.type === 'text') {
      stage = 2
      process.stdout.write(JSON.stringify({ phase: 'Continue in browser: Email or SMS verification required', manual: true, manualStage: 'other-code' }) + '\n')
    } else if (stage === 2 && line.type === 'click') {
      process.stdout.write(JSON.stringify({ phase: 'Checking saved session', manual: false }) + '\n')
      setTimeout(() => process.exit(0), 30)
    }
  }
})
`, { mode: 0o600 })
  const listener = net.createServer()
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port
  await new Promise(resolve => listener.close(resolve))
  const child = spawn(process.execPath, [path.join(here, 'server.mjs')], {
    env: { ...process.env, FB_SESSION_STATE_DIR: dir, FB_SESSION_PORT: String(port),
      FB_SESSION_PYTHON: process.execPath, FB_SESSION_WORKER: worker },
    stdio: 'ignore',
  })
  try {
    const root = `http://127.0.0.1:${port}`
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(root)).ok) break } catch {}
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    const code = (await readFile(path.join(dir, 'access-code'), 'utf8')).trim()
    const headers = { 'X-Session-Console-Key': code, 'Content-Type': 'application/json' }
    const config = { account: '1234567890', password: 'secret-pass', totpSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', captchaKey: '' }
    assert.equal((await fetch(`${root}/api/config`, { method: 'POST', headers, body: JSON.stringify(config) })).status, 200)
    assert.equal((await fetch(`${root}/api/frame`)).status, 401)
    assert.equal((await fetch(`${root}/api/totp`)).status, 401)
    assert.equal((await fetch(`${root}/api/login`, { method: 'POST', headers, body: JSON.stringify({ manualCaptcha: false }) })).status, 400)
    assert.equal((await fetch(`${root}/api/login`, { method: 'POST', headers, body: JSON.stringify({ manualCaptcha: true }) })).status, 202)
    let status
    for (let i = 0; i < 100; i++) {
      status = await fetch(`${root}/api/status`, { headers }).then(response => response.json())
      if (status.manualAvailable) break
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    assert.equal(status.manualAvailable, true)
    assert.equal(status.manualStage, 'captcha')
    assert.equal((await fetch(`${root}/api/totp`, { headers })).status, 404)
    const frame = await fetch(`${root}/api/frame`, { headers })
    assert.equal(frame.status, 200)
    assert.equal(frame.headers.get('content-type'), 'image/jpeg')
    assert.equal(frame.headers.get('cache-control'), 'no-store')
    assert.deepEqual([...new Uint8Array(await frame.arrayBuffer())], [255, 216, 255, 217])
    assert.equal((await fetch(`${root}/api/manual`, { method: 'POST', headers: { ...headers, Origin: 'https://other.example' }, body: JSON.stringify({ type: 'click', x: 1, y: 1 }) })).status, 403)
    assert.equal((await fetch(`${root}/api/manual`, { method: 'POST', headers, body: JSON.stringify({ type: 'click', x: 1280, y: 1 }) })).status, 400)
    assert.equal((await fetch(`${root}/api/manual`, { method: 'POST', headers, body: JSON.stringify({ type: 'click', x: 100, y: 100 }) })).status, 202)
    for (let i = 0; i < 100; i++) {
      status = await fetch(`${root}/api/status`, { headers }).then(response => response.json())
      if (status.manualStage === 'two-factor') break
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    assert.equal(status.running, true)
    assert.equal(status.manualAvailable, true)
    assert.equal(status.manualStage, 'two-factor')
    const codeResponse = await fetch(`${root}/api/totp`, { headers })
    assert.equal(codeResponse.status, 200)
    assert.equal(codeResponse.headers.get('cache-control'), 'no-store')
    const oneTime = await codeResponse.json()
    assert.match(oneTime.code, /^\d{6}$/)
    assert.ok(oneTime.expiresAt > oneTime.serverNow)
    assert.ok(oneTime.expiresAt - oneTime.serverNow <= 30000)
    assert.equal(oneTime.code, currentTotp(config.totpSecret, oneTime.serverNow).code)
    assert.equal((await fetch(`${root}/api/manual`, { method: 'POST', headers, body: JSON.stringify({ type: 'text', text: oneTime.code }) })).status, 202)
    for (let i = 0; i < 100; i++) {
      status = await fetch(`${root}/api/status`, { headers }).then(response => response.json())
      if (status.manualStage === 'other-code') break
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    assert.equal(status.manualAvailable, true)
    assert.equal(status.manualStage, 'other-code')
    assert.equal((await fetch(`${root}/api/totp`, { headers })).status, 404)
    assert.equal((await fetch(`${root}/api/manual`, { method: 'POST', headers, body: JSON.stringify({ type: 'click', x: 100, y: 100 }) })).status, 202)
    for (let i = 0; i < 100; i++) {
      status = await fetch(`${root}/api/status`, { headers }).then(response => response.json())
      if (!status.running) break
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    assert.equal(status.running, false)
    assert.equal(status.manualAvailable, false)
    assert.equal((await fetch(`${root}/api/frame`, { headers })).status, 404)
    assert.equal((await fetch(`${root}/api/stop`, { method: 'POST', headers, body: '{}' })).status, 409)
    assert.equal((await fetch(`${root}/api/login`, { method: 'POST', headers, body: JSON.stringify({ manualCaptcha: true }) })).status, 202)
    for (let i = 0; i < 100; i++) {
      status = await fetch(`${root}/api/status`, { headers }).then(response => response.json())
      if (status.manualAvailable) break
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    assert.equal(status.manualAvailable, true)
    assert.equal((await fetch(`${root}/api/stop`, { method: 'POST', headers, body: '{}' })).status, 202)
    for (let i = 0; i < 100; i++) {
      status = await fetch(`${root}/api/status`, { headers }).then(response => response.json())
      if (!status.running) break
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    assert.equal(status.running, false)
    assert.equal(status.phase, 'Stopped by owner')
  } finally {
    child.kill('SIGTERM')
    await new Promise(resolve => child.once('exit', resolve))
    await rm(dir, { recursive: true, force: true })
  }
})
