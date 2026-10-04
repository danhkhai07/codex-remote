import { createHmac, randomBytes } from 'node:crypto'
import { readFile, writeFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = process.env.FB_SESSION_STATE_DIR ?? '/root/.local/state/facebook-session-console'
const sessionFile = path.join(directory, 'storage-state.json')
const chromePath = process.env.FB_CHROME_PATH || '/root/.cache/ms-playwright/chromium-1187/chrome-linux/chrome'
const playwrightPath = process.env.FB_PLAYWRIGHT_MODULE || '/root/.local/share/facebook-headless/node_modules/playwright-core/index.mjs'
const action = process.argv[2]
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const report = (phase, result) => process.stdout.write(`${JSON.stringify({ phase, result })}\n`)

function totp(secret, now = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of secret.toUpperCase().replace(/\s/g, '')) {
    const index = alphabet.indexOf(char)
    if (index < 0) throw new Error('Invalid TOTP secret')
    bits += index.toString(2).padStart(5, '0')
  }
  const key = Buffer.alloc(Math.floor(bits.length / 8))
  for (let i = 0; i < key.length; i++) key[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2)
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)))
  const digest = createHmac('sha1', key).update(counter).digest()
  const offset = digest[19] & 15
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0')
}

function route(url) {
  try { return new URL(url).pathname } catch { return '' }
}

async function verified(page, context) {
  const cookies = await context.cookies('https://www.facebook.com/')
  const hasCookies = ['c_user', 'xs'].every(name => cookies.some(cookie => cookie.name === name))
  const blocked = /two_step_verification|checkpoint|login|recover/.test(route(page.url()))
  const loginForm = await page.locator('input[name="email"]:visible').count().catch(() => 0)
  return hasCookies && !blocked && loginForm === 0
}

async function saveAndRecheck(browser, context) {
  const temporary = `${sessionFile}.${randomBytes(8).toString('hex')}.tmp`
  await writeFile(temporary, JSON.stringify(await context.storageState()), { mode: 0o600, flag: 'wx' })
  let confirmed = false
  try {
    const check = await browser.newContext({ storageState: temporary, viewport: { width: 1280, height: 800 } })
    try {
      const page = await check.newPage()
      await page.goto('https://www.facebook.com/watch/', { waitUntil: 'domcontentloaded', timeout: 30000 })
      await delay(3000)
      confirmed = await verified(page, check)
    } finally { await check.close() }
    if (confirmed) await rename(temporary, sessionFile)
  } finally { await unlink(temporary).catch(() => {}) }
  return confirmed
}

async function solveCaptcha(key, challenge) {
  const task = {
    type: 'FunCaptchaTaskProxyless', websiteURL: challenge.url,
    websitePublicKey: challenge.publicKey,
    userAgent: challenge.userAgent,
  }
  if (challenge.subdomain) task.funcaptchaApiJSSubdomain = challenge.subdomain
  if (challenge.data) task.data = JSON.stringify(challenge.data)
  const create = await fetch('https://api.2captcha.com/createTask', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientKey: key, task }), signal: AbortSignal.timeout(30000),
  }).then(response => response.json())
  if (create.errorId || !create.taskId) throw new Error('Captcha task was rejected')
  const deadline = Date.now() + 5 * 60_000
  while (Date.now() < deadline) {
    await delay(5000)
    const result = await fetch('https://api.2captcha.com/getTaskResult', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: key, taskId: create.taskId }), signal: AbortSignal.timeout(30000),
    }).then(response => response.json())
    if (result.errorId) throw new Error('Captcha solve failed')
    if (result.status === 'ready' && typeof result.solution?.token === 'string') return result.solution.token
  }
  throw new Error('Captcha solve timed out')
}

async function challengeFromPage(page, observed) {
  const keys = new Set(observed.keys)
  const subdomains = new Set(observed.subdomains)
  let callbackFrame = null
  let data = null
  let callbackKey = null
  for (const frame of page.frames()) {
    const state = await frame.evaluate(() => ({
      ready: typeof globalThis.__sessionConsoleArkoseComplete === 'function',
      scripts: [...document.querySelectorAll('script[src]')].map(el => el.src).filter(src => src.includes('/v2/') && src.includes('arkoselabs')),
      config: globalThis.__sessionConsoleArkoseData ?? null,
      key: globalThis.__sessionConsoleArkoseKey ?? null,
    })).catch(() => null)
    if (!state) continue
    if (state.ready) { callbackFrame = frame; data = state.config; callbackKey = state.key }
    for (const src of state.scripts) {
      try {
        const parsed = new URL(src)
        const match = parsed.pathname.match(/\/v2\/([a-f0-9-]{36})\/api\.js/i)
        if (match) keys.add(match[1])
        subdomains.add(parsed.hostname)
      } catch {}
    }
  }
  const selectedKey = callbackKey && /^[a-f0-9-]{36}$/i.test(callbackKey) ? callbackKey : keys.size === 1 ? [...keys][0] : null
  if (!callbackFrame || !selectedKey) return null
  return { frame: callbackFrame, publicKey: selectedKey, subdomain: [...subdomains][0], data,
    url: page.url(), userAgent: await page.evaluate(() => navigator.userAgent) }
}

async function runLogin(browser, config) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' })
  const observed = { keys: new Set(), subdomains: new Set() }
  try {
    await context.addInitScript(() => {
      const hooked = new Set()
      function hook(name) {
        if (!/^[a-zA-Z_$][\w$]{0,80}$/.test(name) || hooked.has(name)) return
        hooked.add(name)
        let current = globalThis[name]
        Object.defineProperty(globalThis, name, {
          configurable: true,
          get() { return current },
          set(fn) {
            if (typeof fn !== 'function') { current = fn; return }
            current = function (enforcer) {
              const original = enforcer.setConfig
              enforcer.setConfig = function (config) {
                if (typeof config?.onCompleted === 'function') {
                  globalThis.__sessionConsoleArkoseComplete = config.onCompleted
                  globalThis.__sessionConsoleArkoseData = config.data ?? null
                  globalThis.__sessionConsoleArkoseKey = config.publicKey ?? null
                }
                return original.call(this, config)
              }
              return fn.call(this, enforcer)
            }
          },
        })
        if (typeof current === 'function') globalThis[name] = current
      }
      hook('setupEnforcement')
      new MutationObserver(() => {
        for (const script of document.querySelectorAll('script[data-callback][src]')) {
          if (script.src.includes('arkoselabs')) hook(script.getAttribute('data-callback') ?? '')
        }
      }).observe(document, { subtree: true, childList: true })
    })
    const page = await context.newPage()
    page.on('request', request => {
      try {
        const parsed = new URL(request.url())
        if (!parsed.hostname.includes('arkoselabs.com')) return
        const match = parsed.pathname.match(/\/v2\/([a-f0-9-]{36})\/api\.js/i)
        if (match) observed.keys.add(match[1])
        const key = parsed.searchParams.get('public_key') ?? parsed.searchParams.get('pk')
        if (key && /^[a-f0-9-]{36}$/i.test(key)) observed.keys.add(key)
        observed.subdomains.add(parsed.hostname)
      } catch {}
    })
    report('Opening Facebook')
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    const email = page.locator('input[name="email"]:visible').first()
    const password = page.locator('input[name="pass"]:visible').first()
    if (!await email.isVisible({ timeout: 12000 }).catch(() => false)) {
      report('Login form unavailable', 'Facebook did not show the expected login form')
      return
    }
    await email.fill(config.account)
    await password.fill(config.password)
    await password.press('Enter', { noWaitAfter: true })
    report('Login submitted')
    let solved = false
    let enteredTotp = false
    const deadline = Date.now() + 9 * 60_000
    while (Date.now() < deadline) {
      await delay(2500)
      if (await verified(page, context)) {
        report('Checking saved session')
        const confirmed = await saveAndRecheck(browser, context)
        report(confirmed ? 'Session ready' : 'Verification failed', confirmed ? 'Saved and verified in a fresh browser' : 'Facebook rejected the saved session')
        return
      }
      const pathname = route(page.url())
      const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
      if (/video selfie|identity confirmation in progress/i.test(text)) {
        report('Identity review required', 'Facebook requires a person to complete identity review')
        return
      }
      if (/two_step_verification|two_factor/.test(pathname) && !enteredTotp) {
        const input = page.locator('input[autocomplete="one-time-code"]:visible, input[type="text"]:visible, input[type="tel"]:visible')
        if (await input.count() !== 1) {
          report('2FA needs attention', 'Could not identify one verification-code field')
          return
        }
        report('Entering verification code')
        await input.first().fill(totp(config.totpSecret))
        const continueButton = page.getByRole('button', { name: /continue|next|tiếp tục/i }).first()
        if (await continueButton.isVisible().catch(() => false)) await continueButton.click({ noWaitAfter: true })
        else await input.first().press('Enter', { noWaitAfter: true })
        enteredTotp = true
        continue
      }
      if (!solved) {
        const challenge = await challengeFromPage(page, observed)
        if (challenge) {
          solved = true
          report('Solving one CAPTCHA task')
          let token
          try { token = await solveCaptcha(config.captchaKey, challenge) }
          catch { report('CAPTCHA failed', 'One 2Captcha task failed or timed out; no automatic retry'); return }
          const accepted = await challenge.frame.evaluate(value => {
            const callback = globalThis.__sessionConsoleArkoseComplete
            if (typeof callback !== 'function') return false
            callback({ token: value })
            return true
          }, token).catch(() => false)
          report(accepted ? 'CAPTCHA response submitted' : 'CAPTCHA handoff failed', accepted ? undefined : 'Facebook challenge changed before submission')
          if (!accepted) return
        }
      }
      if (/checkpoint/.test(pathname) && !solved && !/arkose|captcha/i.test(text)) {
        report('Verification required', 'Facebook opened a checkpoint that this one-account tool cannot complete')
        return
      }
    }
    report('Timed out', 'Facebook did not produce a verified session')
  } finally { await context.close() }
}

async function runCheck(browser) {
  const context = await browser.newContext({ storageState: sessionFile, viewport: { width: 1280, height: 800 } })
  try {
    const page = await context.newPage()
    await page.goto('https://www.facebook.com/watch/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await delay(3000)
    const okay = await verified(page, context)
    report(okay ? 'Session ready' : 'Session expired', okay ? 'Saved session passed a fresh-browser check' : 'Facebook requires login or verification')
  } finally { await context.close() }
}

async function main() {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk.toString('utf8')
  const input = JSON.parse(raw)
  const { chromium } = await import(playwrightPath)
  const browser = await chromium.launch({ executablePath: chromePath, headless: !process.env.DISPLAY, args: ['--no-sandbox'] })
  try {
    if (action === 'login') await runLogin(browser, input)
    else if (action === 'check') await runCheck(browser)
    else throw new Error('Unknown action')
  } finally { await browser.close() }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(() => { report('Error', 'Browser task failed; check account and try again'); process.exitCode = 1 })
export { totp }
