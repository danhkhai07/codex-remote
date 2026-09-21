// Run after npm run build. All APIs are fixtures; no model turns or real sessions.
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
import { RemoteController } from '../dist-server/controller.js'
import { createRemoteHttpServer } from '../dist-server/http-app.js'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const config = { host: '127.0.0.1', port: 0, publicOrigin: new URL('http://127.0.0.1'),
  password: 'unused fixture password', sessionSecret: 'f'.repeat(48), sessionTtlSeconds: 600,
  codexBin: 'unused', workspaceRoots: ['/tmp'], production: true }
const server = createRemoteHttpServer(config, new RemoteController(config, new CodexAppServer('unused')), resolve('dist'), null)
const browser = await chromium.launch({ headless: true })
try {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  config.publicOrigin = new URL(`http://127.0.0.1:${server.address().port}`)
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'allow' })
  const page = await context.newPage(), errors = [], mutations = []
  page.on('pageerror', error => errors.push(error.message))
  const thread = id => ({ id, name: id === 'a' ? 'First fixture' : 'Second fixture', cwd: '/tmp', createdAt: 1, updatedAt: 1, status: { type: 'idle' }, turns: [] })
  await context.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() !== 'GET') mutations.push(path)
    let data = {}
    if (path === '/api/session') data = { csrf: 'fixture', expiresAt: 9999999999, workspaces: [{ id: '0', label: 'Fixture', path: '/tmp' }] }
    else if (path === '/api/threads') data = { data: [thread('a'), thread('b')] }
    else if (path === '/api/models') data = { data: [{ id: 'fixture', model: 'fixture', isDefault: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: [] }] }
    else if (path === '/api/pending') data = { data: [], epoch: 'fixture', cursor: 0 }
    else if (path === '/api/conversation-groups') data = { revision: 0, groups: [], assignments: {} }
    else if (path === '/api/read-state') data = { revision: 0, unread: {} }
    else if (path.endsWith('/message-ids')) data = { ids: [] }
    else if (path === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' })
    else if (path.startsWith('/api/threads/')) data = { thread: thread(path.split('/')[3]) }
    await route.fulfill({ json: data })
  })
  await page.goto(config.publicOrigin.origin)
  const composer = page.locator('#instruction')
  const logo = page.getByRole('button', { name: 'App menu', exact: true })
  const settings = page.getByLabel('Settings', { exact: true })
  const reload = page.getByRole('button', { name: 'Reload app', exact: true })
  const restored = async () => {
    await composer.waitFor()
    await page.waitForFunction(() => document.querySelector('.thread-row-entry.is-selected')?.textContent.includes('Second fixture'))
    assert.equal(await composer.inputValue(), 'Unsaved second conversation draft')
    assert.equal(await page.evaluate(() => localStorage.getItem('reload-fixture-retained')), 'keep')
  }
  const reloadAndWait = async () => {
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), reload.click()])
    await restored()
  }
  await composer.waitFor()
  await composer.fill('First conversation draft')
  await page.locator('.thread-row').filter({ hasText: 'Second fixture' }).click()
  await composer.fill('Unsaved second conversation draft')
  await page.evaluate(() => localStorage.setItem('reload-fixture-retained', 'keep'))
  await logo.focus()
  await logo.press('Enter')
  assert.equal(await logo.getAttribute('aria-expanded'), 'true')
  assert.equal(await reload.evaluate(el => document.activeElement === el), true)
  await reload.press('Escape')
  assert.equal(await reload.isVisible(), false)
  assert.equal(await logo.evaluate(el => document.activeElement === el), true)
  await logo.click()
  await logo.click()
  assert.equal(await reload.isVisible(), false, 'Clicking the logo again closes the menu')
  await logo.click()
  await composer.click()
  assert.equal(await reload.isVisible(), false, 'Outside click closes the menu')
  await settings.click()
  await page.getByRole('button', { name: 'Enable completion notifications' }).waitFor()
  await page.getByRole('button', { name: 'Lock app', exact: true }).waitFor()
  await settings.press('Tab')
  assert.equal(await reload.evaluate(el => document.activeElement === el), true)
  await reload.press('Escape')
  assert.equal(await settings.evaluate(el => document.activeElement === el), true)
  await logo.click()
  if (process.env.LOGO_RELOAD_SCREENSHOT) await page.screenshot({ path: process.env.LOGO_RELOAD_SCREENSHOT.replace(/\.png$/, '-desktop.png') })
  await reloadAndWait()
  console.log('PASS: logo/settings menu, keyboard, Escape/outside/toggle, reload restores selected conversation/draft/storage')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open conversations', exact: true }).click()
  await logo.click()
  assert.equal(await reload.isVisible(), true)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  if (process.env.LOGO_RELOAD_SCREENSHOT) await page.screenshot({ path: process.env.LOGO_RELOAD_SCREENSHOT })
  await reloadAndWait()
  await logo.click()
  // Exercise the existing waiting-worker/controllerchange path without installing
  // or changing a real service worker. Only the message and lifecycle are mocked.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('codex-remote:update-ready', { detail: {
    postMessage(message) {
      localStorage.setItem('reload-fixture-worker-message', JSON.stringify(message))
      navigator.serviceWorker.dispatchEvent(new Event('controllerchange'))
    },
  } })))
  await page.getByRole('button', { name: 'Reload', exact: true }).waitFor({ state: 'attached' })
  await reloadAndWait()
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('reload-fixture-worker-message'))), { type: 'SKIP_WAITING' })
  assert.deepEqual(errors, [])
  assert.equal(mutations.some(path => /\/(turns|interrupt|logout)$/.test(path)), false, 'Reload must not send/stop turns or log out')
  console.log('PASS: mobile drawer reload; waiting worker activation/controllerchange; no turns, interrupts, logout or page errors')
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
