import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const here = path.dirname(fileURLToPath(import.meta.url))
const worker = path.join(here, 'worker_manual.mjs')
const playwrightPath = process.env.FB_PLAYWRIGHT_MODULE || '/root/.local/share/facebook-headless/node_modules/playwright-core/index.mjs'
const chromePath = process.env.FB_CHROME_PATH || '/root/.cache/ms-playwright/chromium-1187/chrome-linux/chrome'
const { chromium } = await import(pathToFileURL(playwrightPath).href)

function fixture() {
  let watchVisits = 0
  const server = createServer((request, response) => {
    let html = ''
    if (request.url === '/') html = `<input name="email"><input name="pass" type="password"><button id="login" onclick="location.href='/captcha'">Log in</button>`
    else if (request.url === '/captcha') html = `<p>Complete a challenge to verify</p><button id="solve" style="position:fixed;left:100px;top:100px;width:120px;height:80px" onclick="location.href='/two_step_verification/two_factor/'">Solve puzzle</button>`
    else if (request.url === '/two_step_verification/two_factor/') html = `<p>Enter your authenticator app code</p><input autocomplete="one-time-code" maxlength="6" style="position:fixed;left:100px;top:100px;width:150px;height:40px"><button style="position:fixed;left:100px;top:160px" onclick="if(document.querySelector('input').value==='123456')location.href='/checkpoint/email'">Continue</button>`
    else if (request.url === '/checkpoint/email') html = `<p>We sent a code to your email</p><input style="position:fixed;left:100px;top:100px;width:150px;height:40px"><button style="position:fixed;left:100px;top:160px" onclick="if(document.querySelector('input').value==='654321')location.href='/done'">Continue</button>`
    else if (request.url === '/done' || request.url === '/watch/') {
      if (request.url === '/watch/') watchVisits++
      const cookies = request.headers.cookie || ''
      if (request.url === '/watch/' && !cookies.includes('c_user=fixture')) html = `<input name="email"><input name="pass" type="password">`
      else html = `<button aria-label="Account">Account</button>`
      if (request.url === '/done') response.setHeader('Set-Cookie', ['c_user=fixture; Path=/; Max-Age=3600', 'xs=fixture; Path=/; Max-Age=3600'])
    } else { response.writeHead(404).end(); return }
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(html)
  })
  return { server, get watchVisits() { return watchVisits } }
}

function runner(state, origin, action) {
  const child = spawn(process.execPath, [worker, action], {
    env: { ...process.env, DISPLAY: '', FB_SESSION_STATE_DIR: state, FB_SESSION_TEST_ORIGIN: origin,
      FB_SESSION_TEST_URL: `${origin}/`, FB_PLAYWRIGHT_MODULE: playwrightPath, FB_CHROME_PATH: chromePath },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stdin.write(`${JSON.stringify(action === 'login' ? { account: 'fixture', password: 'fixture', totpSecret: 'SECRET', captchaKey: 'PAID-KEY', manualCaptcha: false } : {})}\n`)
  const events = []
  let buffer = ''
  let diagnostics = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    buffer += chunk
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      events.push(JSON.parse(line))
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => { diagnostics += chunk })
  return { child, events, diagnostic: () => diagnostics }
}

async function waitUntil(job, predicate, timeout = 45_000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (predicate(job.events)) return
    if (job.child.exitCode !== null) throw new Error(`Worker exited early: ${JSON.stringify(job.events)} ${job.diagnostic().slice(-500)}`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out: ${JSON.stringify(job.events.map(item => item.phase || (item.frame ? 'frame' : '?')))} ${job.diagnostic().slice(-500)}`)
}

async function stop(job) {
  if (job.child.exitCode === null) job.child.kill('SIGINT')
  await waitForExit(job).catch(async error => {
    job.child.kill('SIGKILL')
    throw error
  })
}

async function waitForExit(job) {
  if (job.child.exitCode !== null) return
  let timeout
  try {
    await Promise.race([once(job.child, 'exit'), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Worker did not exit')), 15_000) })])
  } finally { clearTimeout(timeout) }
}

async function tempFixture(run) {
  const state = await mkdtemp(path.join(os.tmpdir(), 'fb-manual-worker-'))
  const site = fixture()
  site.server.listen(0, '127.0.0.1')
  await once(site.server, 'listening')
  const origin = `http://127.0.0.1:${site.server.address().port}`
  try { await run({ state, origin, site }) }
  finally { site.server.close(); await rm(state, { recursive: true, force: true }) }
}

// The only network destination is the loopback fixture. The fake CAPTCHA, 2FA
// and email pages advance exclusively through manual pointer and text actions.
test('manual owner flow, fresh browser verification, and read-only check', { timeout: 120_000 }, async () => {
  await tempFixture(async ({ state, origin, site }) => {
    const job = runner(state, origin, 'login')
    try {
      await waitUntil(job, events => events.some(item => item.manualStage === 'captcha'))
      await waitUntil(job, events => events.some(item => item.frame?.startsWith('/9j/')))
      assert.ok(job.events.some(item => item.frame?.startsWith('/9j/')))
      assert.ok(!job.events.some(item => /Solving|Entering verification code/.test(item.phase || '')))
      job.child.stdin.write('{"type":"click","x":150,"y":135}\n')
      await waitUntil(job, events => events.some(item => item.manualStage === 'two-factor'))
      job.child.stdin.write('{"type":"click","x":150,"y":120}\n{"type":"text","text":"123456"}\n{"type":"click","x":150,"y":180}\n')
      await waitUntil(job, events => events.some(item => item.manualStage === 'other-code'))
      job.child.stdin.write('{"type":"click","x":150,"y":120}\n{"type":"text","text":"654321"}\n{"type":"click","x":150,"y":180}\n')
      await waitUntil(job, events => events.some(item => item.phase === 'Session ready'))
      await waitForExit(job)
      assert.equal(job.child.exitCode, 0)
      assert.ok(site.watchVisits >= 1)
      const marker = JSON.parse(await readFile(path.join(state, 'storage-state.json')))
      assert.equal(marker.engine, 'playwright-chromium')
      assert.equal(marker.accountId, 'fixture')
      assert.equal((await stat(path.join(state, 'storage-state.json'))).mode & 0o777, 0o600)
      assert.ok(!JSON.stringify(marker).includes('PAID-KEY'))
      const check = runner(state, origin, 'check')
      await waitUntil(check, events => events.some(item => item.phase === 'Session ready'))
      await waitForExit(check)
      assert.equal(check.child.exitCode, 0)
      assert.ok(!check.events.some(item => item.manual || item.frame))
    } finally { if (job.child.exitCode === null) await stop(job) }
  })
})

test('existing persistent profile survives SIGINT and can be reopened', { timeout: 80_000 }, async () => {
  await tempFixture(async ({ state, origin }) => {
    const profile = path.join(state, 'browser-profile')
    const context = await chromium.launchPersistentContext(profile, {
      executablePath: chromePath, headless: true, viewport: { width: 1280, height: 800 }, args: ['--no-sandbox'],
    })
    const expires = Math.floor(Date.now() / 1000) + 3600
    await context.addCookies([{ name: 'c_user', value: 'fixture', url: origin, expires }, { name: 'xs', value: 'fixture', url: origin, expires }])
    await context.close()
    const check = runner(state, origin, 'check')
    await waitUntil(check, events => events.some(item => item.phase === 'Session ready'))
    await waitForExit(check)
    assert.equal(check.child.exitCode, 0)
    await writeFile(path.join(state, 'storage-state.json'), JSON.stringify({ accountId: 'different' }), { mode: 0o600 })
    const mismatch = runner(state, origin, 'check')
    await waitUntil(mismatch, events => events.some(item => item.phase === 'Account mismatch'))
    await waitForExit(mismatch)
    assert.equal(mismatch.child.exitCode, 0)
    await writeFile(path.join(state, 'storage-state.json'), JSON.stringify({ accountId: 'fixture' }), { mode: 0o600 })
    const login = runner(state, origin, 'login')
    await waitUntil(login, events => events.some(item => item.manualStage === 'captcha'))
    login.child.kill('SIGINT')
    await waitForExit(login)
    assert.equal(login.child.exitCode, 0)
    const after = runner(state, origin, 'check')
    await waitUntil(after, events => events.some(item => item.phase === 'Session ready'))
    await waitForExit(after)
    assert.equal(after.child.exitCode, 0)
    const orphan = runner(state, origin, 'login')
    await waitUntil(orphan, events => events.some(item => item.manualStage === 'captcha'))
    orphan.child.stdin.end()
    await waitForExit(orphan)
    assert.equal(orphan.child.exitCode, 0)
  })
})
