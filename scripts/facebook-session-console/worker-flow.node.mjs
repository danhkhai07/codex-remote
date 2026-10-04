import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('real worker walks login → CAPTCHA → TOTP → fresh-browser verification using fixtures', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fb-flow-'))
  const shim = path.join(directory, 'playwright-fixture.mjs')
  await writeFile(shim, String.raw`
import { chromium as real } from '/root/.local/share/facebook-headless/node_modules/playwright-core/index.mjs'
let tasks = 0
globalThis.fetch = async url => {
  if (url === 'https://api.2captcha.com/createTask') {
    if (++tasks > 1) throw Error('Duplicate paid task')
    return { json: async () => ({ taskId: 1 }) }
  }
  if (url === 'https://api.2captcha.com/getTaskResult') return { json: async () => ({ status: 'ready', solution: { token: 'fixture-only' } }) }
  throw Error('Unexpected network call')
}
export const chromium = { async launch(options) {
  const browser = await real.launch({ ...options, headless: true })
  const original = browser.newContext.bind(browser)
  browser.newContext = async options => {
    const context = await original(options)
    await context.route('**/*', async route => {
      const url = new URL(route.request().url())
      let body
      if (url.hostname === 'www.fbsbx.com') body = '<p>Challenge</p>'
      else if (url.hostname !== 'www.facebook.com') throw Error('Unexpected browser host')
      else if (url.pathname === '/') body = '<input name="email"><input name="pass" type="password"><button onclick="location.href=\'/two_step_verification/authentication/\'">Log in</button>'
      else if (url.pathname === '/two_step_verification/authentication/') body = '<iframe src="https://www.fbsbx.com/captcha/arkose/iframe/"></iframe><script>window.setupEnforcement=function(e){e.setConfig({publicKey:"11111111-1111-1111-1111-111111111111",onCompleted:function(r){if(r.token==="fixture-only")location.href="/two_step_verification/two_factor/"}})};window.setupEnforcement({setConfig:function(){}})</script>'
      else if (url.pathname === '/two_step_verification/two_factor/') body = '<p>Enter your authenticator app code</p><input autocomplete="one-time-code" maxlength="6"><button onclick="if(/^[0-9]{6}$/.test(document.querySelector(\'input\').value)){document.cookie=\'c_user=fixture;path=/\';document.cookie=\'xs=fixture;path=/\';location.href=\'/watch/\'}">Continue</button>'
      else if (url.pathname === '/watch/') {
        const cookies = await context.cookies('https://www.facebook.com/')
        body = ['c_user','xs'].every(n => cookies.some(c => c.name === n)) ? '<button aria-label="Account">Account</button>' : '<input name="email">'
      } else throw Error('Unexpected fixture path')
      await route.fulfill({ status: 200, contentType: 'text/html', body })
    })
    return context
  }
  return browser
} }
`)
  const worker = fileURLToPath(new URL('./worker.mjs', import.meta.url))
  const child = spawn(process.execPath, [worker, 'login'], {
    env: { ...process.env, DISPLAY: '', FB_SESSION_STATE_DIR: directory, FB_PLAYWRIGHT_MODULE: shim },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const timer = setTimeout(() => child.kill('SIGTERM'), 50000)
  let output = ''
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', () => {})
  child.stdin.end(JSON.stringify({ account: 'fixture', password: 'fixture', totpSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', captchaKey: 'fixture' }))
  try {
    const code = await new Promise(resolve => child.on('exit', resolve))
    const events = output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    const phases = events.map(event => event.phase)
    assert.equal(code, 0, output)
    assert.ok(phases.includes('CAPTCHA detected'), output)
    assert.equal(phases.filter(p => p === 'Solving one CAPTCHA task').length, 1, output)
    assert.ok(phases.indexOf('Entering verification code') > phases.indexOf('CAPTCHA response submitted'), output)
    assert.equal(phases.at(-1), 'Session ready', output)
    const state = JSON.parse(await readFile(path.join(directory, 'storage-state.json'), 'utf8'))
    assert.ok(state.cookies.some(cookie => cookie.name === 'c_user'))
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null) child.kill('SIGTERM')
    await rm(directory, { recursive: true, force: true })
  }
})
