import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const { chromium } = await import('/root/.local/share/facebook-headless/node_modules/playwright-core/index.mjs')
const output = process.env.FB_UI_SCREENSHOT_DIR || '/tmp/facebook-accounts-ui'
await mkdir(output, { recursive: true })
const assets = {
  '/': ['text/html', await readFile(path.join(here, 'index.html'))],
  '/app.js': ['text/javascript', await readFile(path.join(here, 'app.js'))],
  '/app.css': ['text/css', await readFile(path.join(here, 'app.css'))],
}
const accounts = [
  { id: 'one', label: 'Marketing', account: 'm***@example.com', configured: true, locked: false, sessionSaved: true, sessionStatus: 'logged-in', running: false, activity: 'Idle', avatarVersion: null, phase: 'Ready', lastResult: 'Saved session ready', updatedAt: new Date().toISOString(), manualAvailable: false, manualStage: null },
  { id: 'two', label: 'Support', account: 's***@example.com', configured: true, locked: false, sessionSaved: false, sessionStatus: 'logged-out', running: false, activity: 'Idle', avatarVersion: null, phase: 'Ready', lastResult: '', updatedAt: null, manualAvailable: false, manualStage: null },
]
let activeAccountId = null
let nextId = 3
const manualCommands = []
let delayedFrame = false
let delayedTotp = false
let delayedConfig = false
const pendingResponses = []
const json = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}
const list = () => ({ accounts, activeAccountId, capacity: 1 })
const frame = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect width="1280" height="800" fill="#ffffff"/><text x="70" y="100" font-size="40" fill="#1c2741">Manual browser fixture</text><rect x="70" y="150" width="450" height="64" fill="#eaf3ff"/></svg>')
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname
  if (assets[pathname]) {
    response.writeHead(200, { 'content-type': assets[pathname][0] })
    response.end(assets[pathname][1])
    return
  }
  if (!pathname.startsWith('/api/')) { json(response, 404, { error: 'Not found' }); return }
  if (request.headers['x-session-console-key'] !== 'test-key') { json(response, 401, { error: 'Wrong access code' }); return }
  if (pathname === '/api/accounts' && request.method === 'GET') { json(response, 200, list()); return }
  let body = {}
  if (request.method === 'POST') {
    let raw = ''
    for await (const chunk of request) raw += chunk
    body = raw ? JSON.parse(raw) : {}
  }
  if (pathname === '/api/accounts' && request.method === 'POST') {
    const account = { id: String(nextId++), label: body.label, account: body.account.replace(/(^.).*(@.*$)/, '$1***$2'), configured: true, locked: body.locked, sessionSaved: false, sessionStatus: body.locked ? 'locked' : 'logged-out', running: false, activity: 'Idle', avatarVersion: null, phase: 'Ready', lastResult: '', updatedAt: null, manualAvailable: false, manualStage: null }
    accounts.push(account)
    json(response, 200, list())
    return
  }
  const match = /^\/api\/accounts\/([^/]+)\/(config|login|check|stop|status|frame|totp|manual)$/.exec(pathname)
  const account = accounts.find(item => item.id === match?.[1])
  if (!account) { json(response, 404, { error: 'Account not found' }); return }
  const action = match[2]
  if (action === 'config') {
    const send = () => {
      if (body.label !== undefined) account.label = body.label
      account.locked = body.locked
      account.sessionStatus = account.locked ? 'locked' : account.sessionSaved ? 'logged-in' : 'logged-out'
      account.updatedAt = new Date().toISOString()
      json(response, 200, list())
    }
    if (delayedConfig) pendingResponses.push(send)
    else send()
  } else if (action === 'login' || action === 'check') {
    if (activeAccountId && activeAccountId !== account.id) { json(response, 409, { error: 'Another browser is active' }); return }
    activeAccountId = account.id
    account.running = true
    account.phase = 'Continue in browser'
    account.activity = 'Continue in browser'
    account.manualAvailable = true
    account.manualStage = account.id === 'one' ? 'two-factor' : 'captcha'
    account.updatedAt = new Date().toISOString()
    json(response, 200, list())
  } else if (action === 'stop') {
    activeAccountId = null
    account.running = false
    account.manualAvailable = false
    account.manualStage = null
    account.phase = 'Stopped'
    account.activity = 'Idle'
    json(response, 200, list())
  } else if (action === 'status') json(response, 200, account)
  else if (action === 'totp') {
    if (delayedTotp) { pendingResponses.push(() => json(response, 200, { code: '123456', expiresAt: Date.now() + 25000, serverNow: Date.now() })); return }
    if (account.id === 'two') { json(response, 404, { error: 'No authenticator secret' }); return }
    json(response, 200, { code: '123456', expiresAt: Date.now() + 25000, serverNow: Date.now() })
  } else if (action === 'frame') {
    const send = () => { response.writeHead(200, { 'content-type': 'image/svg+xml' }); response.end(frame) }
    if (delayedFrame) pendingResponses.push(send)
    else send()
  } else if (action === 'manual') {
    manualCommands.push({ id: account.id, ...body })
    json(response, 200, { ok: true })
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = 'http://127.0.0.1:' + server.address().port
const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1187/chrome-linux/chrome', headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
try {
  await page.goto(url)
  await page.locator('#access-code').fill('bad')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await assert.doesNotReject(() => page.getByText('Wrong access code').waitFor())
  await page.locator('#access-code').fill('test-key')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.getByText('2 accounts').waitFor()
  assert.equal(await page.locator('.account-row').count(), 2)
  assert.equal(await page.getByText('Manage saved sessions and complete sign-in steps yourself.').count(), 0)
  assert.equal(await page.getByText(/One browser at a time/).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Open', exact: true }).count(), 0)
  assert.equal(await page.locator('#start-login').isHidden(), true)
  assert.equal(await page.getByRole('button', { name: 'Use saved session' }).isVisible(), true)
  assert.equal(await page.locator('.account-row').filter({ hasText: 'Marketing' }).getByText('Logged in').count(), 1)
  assert.equal(await page.locator('.account-row').filter({ hasText: 'Marketing' }).getByText('Idle').count(), 1)
  await page.screenshot({ path: path.join(output, 'accounts-1280.png'), fullPage: true })
  await page.getByRole('button', { name: '+ Add account' }).click()
  await page.locator('#field-account').fill('events@example.com')
  await page.locator('#field-password').fill('fixture-password')
  await page.getByRole('button', { name: 'Add account', exact: true }).last().click()
  await page.getByText('3 accounts').waitFor()
  assert.equal(await page.locator('#selected-heading').textContent(), 'events@example.com')
  await page.getByRole('button', { name: 'Edit details' }).click()
  assert.equal(await page.locator('#field-account').isDisabled(), true)
  assert.equal(await page.locator('#field-password').getAttribute('required'), null)
  await page.locator('#field-status').selectOption('locked')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.locator('#account-dialog').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('#selected-status').textContent(), 'Locked')
  assert.equal(await page.locator('#start-login').isHidden(), true)
  assert.equal(await page.locator('#check-session').isHidden(), true)
  await page.getByRole('button', { name: 'Edit details' }).click()
  await page.locator('#field-status').selectOption('available')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.locator('#account-dialog').waitFor({ state: 'hidden' })
  delayedConfig = true
  await page.getByRole('button', { name: 'Edit details' }).click()
  await page.locator('#field-status').selectOption('locked')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: '+ Add account' }).click()
  await page.locator('#field-account').fill('draft@example.com')
  await page.waitForTimeout(100)
  pendingResponses.splice(0).forEach(send => send())
  await page.waitForTimeout(100)
  assert.equal(await page.locator('#account-dialog').isVisible(), true)
  assert.equal(await page.locator('#field-account').inputValue(), 'draft@example.com')
  await page.getByRole('button', { name: 'Cancel' }).click()
  delayedConfig = false
  await page.locator('.account-row').filter({ hasText: 'Marketing' }).click()
  await page.getByRole('button', { name: 'Use saved session' }).click()
  await page.locator('#manual-panel').waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.querySelector('#browser-frame')?.naturalWidth === 1280)
  await page.getByText('123456').waitFor()
  assert.equal(await page.locator('#totp-panel').isVisible(), true)
  await page.locator('#browser-frame').click({ position: { x: 180, y: 120 } })
  assert.equal(manualCommands.at(-1).id, 'one')
  assert.equal(manualCommands.at(-1).type, 'click')
  await page.locator('#manual-text').fill('fixture')
  await page.getByRole('button', { name: 'Type text' }).click()
  assert.equal(manualCommands.at(-1).text, 'fixture')
  await page.getByRole('button', { name: 'Scroll down' }).click()
  assert.equal(manualCommands.at(-1).deltaY, 500)
  await page.locator('.account-row').filter({ hasText: 'Support' }).click()
  assert.equal(await page.locator('#manual-panel').isVisible(), false)
  assert.equal(await page.getByRole('button', { name: 'Start login' }).isDisabled(), true)
  await page.locator('.account-row').filter({ hasText: 'Marketing' }).click()
  await page.getByRole('button', { name: 'Stop browser' }).click()
  await page.locator('#manual-panel').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Lock', exact: true }).click()
  assert.equal(await page.locator('#manager').isVisible(), false)
  assert.equal(await page.locator('#browser-frame').getAttribute('src'), null)
  await page.locator('#access-code').fill('test-key')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.locator('.account-row').filter({ hasText: 'Support' }).click()
  await page.getByRole('button', { name: 'Start login' }).click()
  accounts.find(item => item.id === 'two').manualStage = 'two-factor'
  await page.waitForTimeout(3100)
  await page.getByText('Enter the code from your authenticator app').waitFor()
  await page.screenshot({ path: path.join(output, 'manual-1280.png'), fullPage: true })
  await page.setViewportSize({ width: 768, height: 900 })
  await page.screenshot({ path: path.join(output, 'manual-768.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(output, 'manual-390.png'), fullPage: true })
  await page.getByRole('button', { name: '100%' }).click()
  assert.equal(await page.locator('#browser-viewport').evaluate(el => el.scrollWidth > el.clientWidth), true)
  await page.getByRole('button', { name: 'Pan view' }).click()
  assert.equal(await page.locator('#browser-viewport').evaluate(el => el.classList.contains('pan')), true)
  await page.setViewportSize({ width: 320, height: 700 })
  await page.screenshot({ path: path.join(output, 'manual-320.png'), fullPage: true })
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 700 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'page overflow at ' + width)
    assert.equal(await page.locator('.account-row').first().evaluate(row => getComputedStyle(row).gridTemplateRows.split(' ').length), 1, 'account row wrapped at ' + width)
  }
  await page.getByRole('button', { name: 'Stop browser' }).click()
  await page.locator('.account-row').filter({ hasText: 'Marketing' }).click()
  delayedFrame = true
  delayedTotp = true
  await page.getByRole('button', { name: 'Use saved session' }).click()
  await page.waitForTimeout(1300)
  assert.ok(pendingResponses.length > 0)
  await page.locator('.account-row').filter({ hasText: 'Support' }).click()
  pendingResponses.splice(0).forEach(send => send())
  await page.waitForTimeout(100)
  assert.equal(await page.locator('#browser-frame').getAttribute('src'), null)
  assert.equal(await page.locator('#totp-code').textContent(), '')
  await page.locator('.account-row').filter({ hasText: 'Marketing' }).click()
  await page.waitForTimeout(1300)
  assert.ok(pendingResponses.length > 0)
  await page.getByRole('button', { name: 'Lock', exact: true }).click()
  pendingResponses.splice(0).forEach(send => send())
  await page.waitForTimeout(100)
  assert.equal(await page.locator('#browser-frame').getAttribute('src'), null)
  assert.equal(await page.locator('#totp-code').textContent(), '')
  process.stdout.write('Account manager UI smoke passed; screenshots: ' + output + '\n')
} finally {
  await page.close()
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
