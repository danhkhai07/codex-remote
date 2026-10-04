import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, stat, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { safeConfig, masked } from './server.mjs'
import { totp } from './worker.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

test('validates account secrets without exposing them', () => {
  const config = safeConfig({ account: '1234567890', password: 'secret-pass', totpSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', captchaKey: 'captcha-key-value' })
  assert.equal(config.account, '1234567890')
  assert.equal(masked(config.account), '123•••90')
  assert.throws(() => safeConfig({ ...config, account: 'bad account' }))
  assert.throws(() => safeConfig({ ...config, totpSecret: 'not-base32' }))
})

test('TOTP matches the RFC 6238 SHA1 vector', () => {
  assert.equal(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000), '287082')
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
