/** One-account manual login and read-only session check in ordinary Chromium.
 * Secrets arrive on stdin. Only bounded status events and live JPEG frames leave
 * stdout; neither screenshots nor credentials are written to diagnostic files.
 */
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { pathToFileURL } from 'node:url'

const stateDir = process.env.FB_SESSION_STATE_DIR || '/root/.local/state/facebook-session-console'
const profileDir = path.join(stateDir, 'browser-profile')
const sessionFile = path.join(stateDir, 'storage-state.json')
const facebookProfileFile = path.join(stateDir, 'facebook-profile.json')
const facebookAvatarFile = path.join(stateDir, 'facebook-profile-avatar.png')
const chromePath = process.env.FB_CHROME_PATH || '/root/.cache/ms-playwright/chromium-1187/chrome-linux/chrome'
const playwrightPath = process.env.FB_PLAYWRIGHT_MODULE || '/root/.local/share/facebook-headless/node_modules/playwright-core/index.mjs'
const action = process.argv[2]
const origin = (() => {
  const candidate = process.env.FB_SESSION_TEST_ORIGIN
  const start = process.env.FB_SESSION_TEST_URL
  if (!candidate || !start) return 'https://www.facebook.com'
  try {
    const testOrigin = new URL(candidate)
    if (testOrigin.hostname === '127.0.0.1' && new URL(start).origin === testOrigin.origin) return testOrigin.origin
  } catch {}
  return 'https://www.facebook.com'
})()
const startUrl = origin === 'https://www.facebook.com' ? `${origin}/` : process.env.FB_SESSION_TEST_URL
const checkUrl = `${origin}/watch/`
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const report = (phase, result = '', manual, manualStage) => {
  const event = { phase, result }
  if (typeof manual === 'boolean') { event.manual = manual; event.manualStage = manual ? manualStage : null }
  process.stdout.write(`${JSON.stringify(event)}\n`)
}
let stage = 'reading input'
let stopping = false
const pendingActions = []
process.on('SIGINT', () => { stopping = true })
process.on('SIGTERM', () => { stopping = true })

function acceptAction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || pendingActions.length >= 32) return
  const kind = value.type
  if (kind === 'click' || kind === 'drag') {
    if (![value.x, value.y].every((number, index) => Number.isInteger(number) && number >= 0 && number < [1280, 800][index])) return
    if (kind === 'drag' && ![value.toX, value.toY].every((number, index) => Number.isInteger(number) && number >= 0 && number < [1280, 800][index])) return
  } else if (kind === 'text') {
    if (typeof value.text !== 'string' || value.text.length === 0 || value.text.length > 80) return
  } else if (kind === 'key') {
    if (!['Enter', 'Backspace', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(value.key)) return
  } else if (kind === 'scroll') {
    if (!Number.isInteger(value.deltaY) || value.deltaY === 0 || Math.abs(value.deltaY) > 600) return
  } else return
  pendingActions.push(value)
}

async function drainActions(page) {
  while (pendingActions.length && !stopping) {
    const item = pendingActions.shift()
    try {
      if (item.type === 'click') await page.mouse.click(item.x, item.y)
      if (item.type === 'drag') {
        await page.mouse.move(item.x, item.y)
        await page.mouse.down()
        await page.mouse.move(item.toX, item.toY, { steps: 12 })
        await page.mouse.up()
      }
      if (item.type === 'text') await page.keyboard.insertText(item.text)
      if (item.type === 'key') await page.keyboard.press(item.key)
      if (item.type === 'scroll') await page.mouse.wheel(0, item.deltaY)
    } catch {} // A user action can race a navigation; the next live frame shows the result.
  }
}

async function captureFrame(page) {
  try {
    const frame = await page.screenshot({ type: 'jpeg', quality: 78, timeout: 3000 })
    const encoded = frame.toString('base64')
    if (encoded.length <= 1_800_000) process.stdout.write(`${JSON.stringify({ frame: encoded })}\n`)
  } catch {} // Navigation can race capture; retry on the next poll.
}

function classify(facts) {
  if (facts.identity) return 'identity'
  if (facts.captcha) return 'captcha'
  if (facts.login) return facts.rejected ? 'login-rejected' : 'login'
  if (facts.otherCode) return 'other-code'
  if (facts.codeStep) return facts.code ? 'two-factor' : 'two-factor-loading'
  if (facts.checkpoint) return 'checkpoint'
  if (facts.hasCookies && facts.accountControl) return 'authenticated'
  return 'unknown'
}

async function detect(page, context) {
  const before = page.url()
  let parsed
  try { parsed = new URL(before) } catch { return 'unknown' }
  const text = await page.locator('body').innerText({ timeout: 1500 }).catch(() => '')
  let captcha = /complete a challenge to verify|solve a puzzle to continue/i.test(text)
  let code = false
  for (const frame of page.frames()) {
    if (frame !== page.mainFrame()) {
      try {
        const frameUrl = new URL(frame.url())
        if (/(^|\.)arkoselabs\.com$/.test(frameUrl.hostname)
            || (frameUrl.hostname === 'www.fbsbx.com' && frameUrl.pathname.startsWith('/captcha/arkose/'))) {
          const element = await frame.frameElement()
          captcha ||= await element.isVisible().catch(() => false)
          await element.dispose()
        }
      } catch {}
    }
    code ||= await frame.locator('input:visible[autocomplete="one-time-code"], input:visible[name*="code" i], input:visible[id*="code" i]').count().catch(() => 0) > 0
  }
  const cookies = await context.cookies(`${origin}/`).catch(() => [])
  const facts = {
    identity: /video selfie|identity confirmation in progress|upload.{0,80}\b(?:ID|identity document)\b/i.test(text),
    captcha,
    login: await page.locator('input[name="email"]:visible, input[name="pass"]:visible').count().catch(() => 0) > 0,
    rejected: /incorrect password|wrong password|incorrect email|incorrect username/i.test(text),
    otherCode: /(?:sent|send|check).{0,50}(?:email|text message|SMS)|code.{0,30}(?:email|text message|SMS)/i.test(text)
      && !/authentication app|authenticator app/i.test(text),
    codeStep: /\/two_step_verification\/two_factor\/?$/.test(parsed.pathname) || /authentication app|authenticator app/i.test(text),
    code,
    checkpoint: /two_step_verification|checkpoint|login|recover/.test(parsed.pathname),
    hasCookies: parsed.origin === origin && ['c_user', 'xs'].every(name => cookies.some(cookie => cookie.name === name)),
    accountControl: await page.locator('[aria-label="Account"]:visible, [aria-label="Your profile"]:visible, [aria-label="Tài khoản"]:visible').count().catch(() => 0) > 0,
  }
  return page.url() === before ? classify(facts) : 'unknown'
}

async function observedAccountId(context) {
  const cookies = await context.cookies(`${origin}/`).catch(() => [])
  return cookies.find(cookie => cookie.name === 'c_user')?.value || null
}

async function browser(chromium) {
  stage = 'launching Chromium'
  await mkdir(profileDir, { recursive: true, mode: 0o700 })
  await chmod(profileDir, 0o700)
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: chromePath, headless: !process.env.DISPLAY,
    viewport: { width: 1280, height: 800 }, locale: 'en-US',
    args: ['--no-sandbox', '--disable-dev-shm-usage'], timeout: 30000,
    handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
  })
  return { context, page: context.pages()[0] || await context.newPage() }
}

async function navigate(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
}

async function freshVerify(chromium, expectedId) {
  stage = 'checking saved session in a new browser'
  let fresh
  try {
    fresh = await browser(chromium)
    await navigate(fresh.page, checkUrl)
    await delay(1200)
    const kind = await detect(fresh.page, fresh.context)
    const accountId = kind === 'authenticated' ? await observedAccountId(fresh.context) : null
    return { confirmed: Boolean(accountId && (!expectedId || expectedId === accountId)), accountId }
  } finally {
    await fresh?.context.close().catch(() => {})
  }
}

async function writeMarker(accountId) {
  const temporary = `${sessionFile}.${randomBytes(8).toString('hex')}.tmp`
  try {
    await writeFile(temporary, JSON.stringify({ engine: 'playwright-chromium', verifiedAt: Math.floor(Date.now() / 1000), accountId }), { mode: 0o600, flag: 'wx' })
    await rename(temporary, sessionFile)
  } finally { await rm(temporary, { force: true }).catch(() => {}) }
}

function cleanProfileName(value) {
  if (typeof value !== 'string') return null
  const name = value.replace(/\s+/g, ' ').trim().replace(/\s*[|·-]\s*Facebook$/i, '')
  if (!name || name.length > 80 || /^(Facebook|Watch|Home|Log in)$/i.test(name)
      || [...name].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return null
  return name
}

async function extractFacebookProfile(page) {
  stage = 'reading Facebook profile'
  await navigate(page, `${origin}/me`)
  await delay(900)
  const name = cleanProfileName(await page.evaluate(() => {
    const headings = [...document.querySelectorAll('h1')]
      .filter(node => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0 })
      .map(node => node.textContent)
    return headings.find(Boolean)
      || document.querySelector('meta[property="og:title"]')?.getAttribute('content')
      || document.title
  }).catch(() => ''))
  if (!name) return null
  let avatar = null
  const images = page.locator('img:visible')
  let best = null
  let bestScore = -1
  for (let index = 0, count = Math.min(await images.count().catch(() => 0), 80); index < count; index++) {
    const candidate = images.nth(index)
    const data = await candidate.evaluate((node, profileName) => {
      const box = node.getBoundingClientRect()
      return { alt: node.getAttribute('alt') || '', width: box.width, height: box.height,
        matchesName: (node.getAttribute('alt') || '').toLocaleLowerCase().includes(profileName.toLocaleLowerCase()) }
    }, name).catch(() => null)
    if (!data || data.width < 32 || data.height < 32) continue
    const profileAlt = /profile (?:picture|photo)|ảnh đại diện/i.test(data.alt)
    const square = Math.abs(data.width - data.height) <= Math.max(data.width, data.height) * 0.2
    const score = (profileAlt ? 1000 : 0) + (data.matchesName ? 500 : 0) + (square ? 100 : 0) + Math.min(data.width, data.height)
    if ((profileAlt || data.matchesName) && score > bestScore) { best = candidate; bestScore = score }
  }
  if (best) {
    const screenshot = await best.screenshot({ type: 'png', timeout: 4000 }).catch(() => null)
    if (screenshot?.length >= 32 && screenshot.length <= 2 * 1024 * 1024) avatar = screenshot
  }
  return { name, avatar }
}

async function writeFacebookProfile(accountId, profile) {
  if (!profile?.name || !accountId) return
  const temporary = `${facebookProfileFile}.${randomBytes(8).toString('hex')}.tmp`
  try {
    await writeFile(temporary, JSON.stringify({ accountId, name: profile.name, updatedAt: new Date().toISOString() }), { mode: 0o600, flag: 'wx' })
    await rename(temporary, facebookProfileFile)
    await chmod(facebookProfileFile, 0o600)
  } finally { await rm(temporary, { force: true }).catch(() => {}) }
  if (profile.avatar) {
    const avatarTemporary = `${facebookAvatarFile}.${randomBytes(8).toString('hex')}.tmp`
    try {
      await writeFile(avatarTemporary, profile.avatar, { mode: 0o600, flag: 'wx' })
      await rename(avatarTemporary, facebookAvatarFile)
      await chmod(facebookAvatarFile, 0o600)
    } finally { await rm(avatarTemporary, { force: true }).catch(() => {}) }
  }
}

const labels = {
  login: 'Login form', 'login-rejected': 'Login rejected', captcha: 'CAPTCHA detected',
  'two-factor': '2FA code form detected', 'two-factor-loading': 'Waiting for 2FA page',
  'other-code': 'Email or SMS verification required', identity: 'Identity verification required',
  checkpoint: 'Other verification required', authenticated: 'Authenticated page detected',
  unknown: 'Waiting for page to load',
}
const checkLabels = {
  authenticated: 'Session ready', login: 'Login required', 'login-rejected': 'Login rejected',
  captcha: 'CAPTCHA required', 'two-factor': '2FA required', 'two-factor-loading': '2FA page not ready',
  'other-code': 'Email or SMS verification required', identity: 'Identity review required',
  checkpoint: 'Other verification required', unknown: 'Session could not be verified',
}

async function runLogin(chromium, config) {
  if (typeof config.account !== 'string' || !config.account || typeof config.password !== 'string' || !config.password) throw new Error('Invalid login configuration')
  let current = await browser(chromium)
  let submitted = false
  let lastKind = null
  let lastManualStage = null
  let lastFrame = 0
  const deadline = Date.now() + 30 * 60_000
  try {
    stage = 'opening login page'
    report('Opening Facebook')
    await navigate(current.page, startUrl)
    while (!stopping && Date.now() < deadline) {
      stage = 'checking Facebook response'
      const kind = await detect(current.page, current.context).catch(() => 'unknown')
      if (kind !== lastKind) { lastKind = kind; report(labels[kind]) }
      if (process.env.FB_SESSION_DRY_RUN === '1') {
        report(kind === 'login' ? 'Login form ready' : `Current stage: ${kind}`, 'Read-only preflight passed; no account was submitted')
        return
      }
      if (kind === 'authenticated') {
        const seenId = await observedAccountId(current.context)
        if (/^\d+$/.test(config.account.trim()) && seenId !== config.account.trim()) {
          report('Account mismatch', 'The browser is signed in to a different account')
          return
        }
        const profile = await extractFacebookProfile(current.page).catch(() => null)
        report('Checking saved session', '', false)
        await current.context.close()
        current = null
        const { confirmed, accountId } = await freshVerify(chromium, seenId)
        if (confirmed) {
          await writeMarker(accountId)
          await writeFacebookProfile(accountId, profile)
        }
        report(confirmed ? 'Session ready' : 'Verification failed',
          confirmed ? 'Saved and verified in a fresh browser' : 'Facebook rejected the saved session')
        return
      }
      if (kind === 'login' && !submitted) {
        const email = current.page.locator('input[name="email"]:visible').first()
        const password = current.page.locator('input[name="pass"]:visible').first()
        if (await email.count() && await password.count()) {
          stage = 'submitting initial login'
          await email.fill(config.account)
          await password.fill(config.password)
          const button = current.page.getByRole('button', { name: /^log in$/i }).first()
          if (await button.count()) await button.click()
          else await password.press('Enter')
          submitted = true
          report('Login button clicked')
          continue
        }
      }
      // Every challenge, code and later login step is controlled by the owner.
      if (kind !== lastManualStage) {
        lastManualStage = kind
        report(`Continue in browser: ${labels[kind]}`, 'Complete this step yourself; the browser stays open', true, kind)
      }
      stage = 'waiting for owner in browser'
      await drainActions(current.page)
      if (Date.now() - lastFrame >= 1000) {
        await captureFrame(current.page)
        lastFrame = Date.now()
      }
      await delay(350)
    }
    report(stopping ? 'Stopped' : 'Timed out', stopping ? 'Browser closed by owner' : 'Facebook did not produce a verified session', false)
  } finally { await current?.context.close().catch(() => {}) }
}

async function runCheck(chromium, config) {
  let current
  try {
    let expectedId = null
    try { expectedId = JSON.parse(await readFile(sessionFile, 'utf8')).accountId || null } catch {}
    if (!expectedId && typeof config.account === 'string' && /^\d+$/.test(config.account.trim())) expectedId = config.account.trim()
    current = await browser(chromium)
    stage = 'loading Facebook with saved session'
    await navigate(current.page, checkUrl)
    await delay(1200)
    const kind = await detect(current.page, current.context)
    const observedId = kind === 'authenticated' ? await observedAccountId(current.context) : null
    const wrongAccount = kind === 'authenticated' && expectedId && observedId !== expectedId
    if (kind === 'authenticated' && !wrongAccount) {
      const profile = await extractFacebookProfile(current.page).catch(() => null)
      await writeFacebookProfile(observedId, profile)
    }
    report(wrongAccount ? 'Account mismatch' : checkLabels[kind], kind === 'authenticated' && !wrongAccount
      ? 'Saved session passed a fresh-browser check' : 'Read-only check; no login or verification was submitted')
  } finally { await current?.context.close().catch(() => {}) }
}

async function main() {
  if (!['login', 'check'].includes(action)) throw new Error('Unknown action')
  await mkdir(stateDir, { recursive: true, mode: 0o700 })
  await chmod(stateDir, 0o700)
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  let resolveConfig
  const configLine = new Promise(resolve => { resolveConfig = resolve })
  let first = true
  input.on('line', line => {
    if (line.length > 8192) return
    if (first) { first = false; resolveConfig(line); return }
    try { acceptAction(JSON.parse(line)) } catch {}
  })
  input.on('close', () => {
    if (first) { first = false; resolveConfig(null) }
    else stopping = true
  })
  const raw = await configLine
  if (raw === null) throw new Error('Missing configuration')
  const config = JSON.parse(raw)
  const module = await import(pathToFileURL(playwrightPath).href)
  try {
    if (action === 'login') await runLogin(module.chromium, config)
    else await runCheck(module.chromium, config)
  } finally { input.close() }
}

if (process.env.FB_SESSION_WORKER_IMPORT !== '1') {
  main().catch(error => {
    report('Error', `Browser task failed at ${stage} (${error?.name || 'Error'}); no automatic retry`)
    process.exitCode = 1
  })
}

export { acceptAction, classify, cleanProfileName, detect, drainActions, extractFacebookProfile }
