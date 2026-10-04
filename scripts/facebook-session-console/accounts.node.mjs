import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { currentTotp } from './server.mjs'
import { AccountStore } from './account-store.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const secretA = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const secretB = 'JBSWY3DPEHPK3PXP'

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'fb-accounts-'))
  const profile = path.join(directory, 'browser-profile')
  await mkdir(profile, { mode: 0o700 })
  await writeFile(path.join(profile, 'cookies'), 'legacy-profile-bytes', { mode: 0o600 })
  await writeFile(path.join(directory, 'storage-state.json'), 'legacy-marker-bytes', { mode: 0o600 })
  const legacyConfig = JSON.stringify({ account: 'legacy@example.com', password: 'dummy-secret', totpSecret: secretA, captchaKey: 'old-solver-key' })
  await writeFile(path.join(directory, 'account.json'), legacyConfig, { mode: 0o600 })
  const worker = path.join(directory, 'stub-worker.mjs')
  await writeFile(worker, `
let buffer = '', initialized = false
process.stdin.on('data', chunk => {
  buffer += chunk.toString('utf8')
  while (buffer.includes('\\n')) {
    const index = buffer.indexOf('\\n')
    const line = JSON.parse(buffer.slice(0, index))
    buffer = buffer.slice(index + 1)
    if (!initialized) {
      initialized = true
      if (Object.hasOwn(line, 'captchaKey') || Object.hasOwn(line, 'manualCaptcha')) process.stdout.write(JSON.stringify({ result: 'Unexpected solver input' }) + '\\n')
      process.stdout.write(JSON.stringify({ phase: 'Manual verification', manual: true, manualStage: 'two-factor', frame: Buffer.from([255,216,255,217]).toString('base64') }) + '\\n')
    } else if (line.type === 'key' && line.key === 'Enter') {
      process.exit(7)
    }
  }
})
process.on('SIGINT', () => process.exit(0))
`, { mode: 0o600 })
  const listener = net.createServer()
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port
  await new Promise(resolve => listener.close(resolve))
  const server = spawn(process.execPath, [path.join(here, 'server.mjs')], {
    env: { ...process.env, FB_SESSION_STATE_DIR: directory, FB_SESSION_PORT: String(port), FB_SESSION_WORKER: worker },
    stdio: 'ignore',
  })
  const root = `http://127.0.0.1:${port}`
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(root)).ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  const code = (await readFile(path.join(directory, 'access-code'), 'utf8')).trim()
  const headers = { 'X-Session-Console-Key': code, 'Content-Type': 'application/json' }
  async function close() {
    server.kill('SIGTERM')
    await new Promise(resolve => server.once('exit', resolve))
    await rm(directory, { recursive: true, force: true })
  }
  return { directory, root, headers, close, legacyConfig }
}

async function request(f, route, method = 'GET', value) {
  return fetch(`${f.root}${route}`, { method, headers: f.headers, ...(value === undefined ? {} : { body: JSON.stringify(value) }) })
}
async function waitFor(f, id, predicate) {
  for (let i = 0; i < 100; i++) {
    const row = await request(f, `/api/accounts/${id}/status`).then(response => response.json())
    if (predicate(row)) return row
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  throw new Error('Timed out waiting for account state')
}

test('migrates legacy state without touching profile, marker, or configuration; scopes manual job access', { timeout: 15000 }, async () => {
  const f = await fixture()
  try {
    const before = await Promise.all(['account.json', 'storage-state.json', 'browser-profile/cookies'].map(async name => ({ name, bytes: await readFile(path.join(f.directory, name)), inode: (await stat(path.join(f.directory, name))).ino })))
    assert.equal((await fetch(`${f.root}/api/accounts`)).status, 401)
    const initial = await request(f, '/api/accounts').then(response => response.json())
    assert.equal(initial.accounts.length, 1)
    assert.equal(initial.activeAccountId, null)
    assert.equal(initial.capacity, 1)
    const legacy = initial.accounts[0]
    assert.equal(legacy.sessionSaved, true)
    assert.equal(legacy.phase, 'Session ready')
    assert.equal(legacy.account, 'leg•••om')
    const restartedStore = new AccountStore(f.directory)
    await restartedStore.initialize()
    assert.equal(restartedStore.records[0].id, legacy.id)
    assert.equal(JSON.stringify(initial).includes('dummy-secret'), false)
    assert.equal(JSON.stringify(initial).includes('old-solver-key'), false)
    assert.equal((await fetch(`${f.root}/api/accounts/${legacy.id}/frame`)).status, 401)
    assert.equal((await fetch(`${f.root}/api/accounts`, { method: 'POST', headers: { ...f.headers, Origin: 'https://other.example' }, body: '{}' })).status, 403)
    for (const item of before) {
      assert.deepEqual(await readFile(path.join(f.directory, item.name)), item.bytes)
      assert.equal((await stat(path.join(f.directory, item.name))).ino, item.inode)
    }
    const candidate = { label: 'Second account', account: 'second@example.com', password: 'second-secret', totpSecret: secretB }
    const created = await Promise.all([request(f, '/api/accounts', 'POST', candidate), request(f, '/api/accounts', 'POST', candidate)])
    assert.deepEqual(created.map(response => response.status).sort(), [201, 409])
    const listing = await request(f, '/api/accounts').then(response => response.json())
    assert.equal(listing.accounts.length, 2)
    const second = listing.accounts.find(row => row.id !== legacy.id)
    assert.equal((await stat(path.join(f.directory, 'accounts', second.id))).mode & 0o777, 0o700)
    assert.equal((await stat(path.join(f.directory, 'accounts', second.id, 'account.json'))).mode & 0o777, 0o600)
    assert.equal((await stat(path.join(f.directory, 'accounts.json'))).mode & 0o777, 0o600)
    assert.equal((await request(f, '/api/accounts', 'POST', { ...candidate, account: 'SECOND@example.com' })).status, 409)
    assert.equal((await request(f, '/api/accounts', 'POST', { ...candidate, captchaKey: 'old-solver-key' })).status, 400)
    assert.equal((await request(f, `/api/accounts/${second.id}/config`, 'POST', { account: 'changed@example.com' })).status, 400)
    assert.equal((await request(f, `/api/accounts/${second.id}/config`, 'POST', { captchaKey: 'old-solver-key' })).status, 400)
    assert.equal((await request(f, `/api/accounts/${second.id}/config`, 'POST', { label: 'Renamed', password: '', totpSecret: '' })).status, 200)
    assert.equal((await request(f, `/api/accounts/${second.id}/status`).then(response => response.json())).label, 'Renamed')
    assert.equal((await request(f, '/api/accounts/../../account.json/status')).status, 404)
    assert.equal((await request(f, `/api/accounts/${legacy.id}/login`, 'POST', { manualCaptcha: false })).status, 400)
    assert.equal((await request(f, `/api/accounts/${legacy.id}/login`, 'POST', {})).status, 202)
    const active = await waitFor(f, legacy.id, row => row.manualAvailable)
    assert.equal(active.manualStage, 'two-factor')
    assert.equal(active.lastResult, '')
    assert.equal((await request(f, '/api/accounts').then(response => response.json())).activeAccountId, legacy.id)
    assert.equal((await request(f, `/api/accounts/${second.id}/login`, 'POST', {})).status, 409)
    assert.equal((await request(f, `/api/accounts/${second.id}/frame`)).status, 404)
    assert.equal((await request(f, `/api/accounts/${second.id}/totp`)).status, 404)
    assert.equal((await request(f, `/api/accounts/${second.id}/manual`, 'POST', { type: 'click', x: 1, y: 1 })).status, 409)
    assert.equal((await request(f, `/api/accounts/${second.id}/stop`, 'POST', {})).status, 409)
    const frame = await request(f, `/api/accounts/${legacy.id}/frame`)
    assert.equal(frame.status, 200)
    assert.deepEqual([...new Uint8Array(await frame.arrayBuffer())], [255, 216, 255, 217])
    const otp = await request(f, `/api/accounts/${legacy.id}/totp`).then(response => response.json())
    assert.equal(otp.code, currentTotp(secretA, otp.serverNow).code)
    assert.equal((await request(f, `/api/accounts/${legacy.id}/manual`, 'POST', { type: 'click', x: 1, y: 1 })).status, 202)
    assert.equal((await request(f, `/api/accounts/${legacy.id}/stop`, 'POST', {})).status, 202)
    await waitFor(f, legacy.id, row => !row.running)
    assert.equal((await request(f, '/api/accounts').then(response => response.json())).activeAccountId, null)
    assert.equal((await request(f, `/api/accounts/${second.id}/login`, 'POST', {})).status, 202)
    await waitFor(f, second.id, row => row.manualAvailable)
    const otherOtp = await request(f, `/api/accounts/${second.id}/totp`).then(response => response.json())
    assert.equal(otherOtp.code, currentTotp(secretB, otherOtp.serverNow).code)
    assert.equal((await request(f, `/api/accounts/${second.id}/manual`, 'POST', { type: 'key', key: 'Enter' })).status, 202)
    const exited = await waitFor(f, second.id, row => !row.running)
    assert.equal(exited.manualAvailable, false)
    assert.equal(exited.lastResult, 'Login or check did not complete')
    assert.equal((await request(f, `/api/accounts/${second.id}/frame`)).status, 404)
    for (const item of before) {
      assert.deepEqual(await readFile(path.join(f.directory, item.name)), item.bytes)
      assert.equal((await stat(path.join(f.directory, item.name))).ino, item.inode)
    }
  } finally { await f.close() }
})

test('failed registry write does not publish a partial account', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fb-account-failure-'))
  try {
    const store = new AccountStore(directory)
    await store.initialize()
    await mkdir(store.registryFile)
    await assert.rejects(store.create({ label: 'Temporary', account: 'temporary@example.com', password: 'dummy-secret' }))
    assert.equal(store.records.length, 0)
    assert.deepEqual(await readdir(path.join(directory, 'accounts')), [])
  } finally { await rm(directory, { recursive: true, force: true }) }
})
