// Run after npm run build. Install Playwright externally, or set PLAYWRIGHT_MODULE
// to its index.mjs. Uses only a fake stdio app-server and an ephemeral HTTP port.
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
import { RemoteController } from '../dist-server/controller.js'
import { createRemoteHttpServer } from '../dist-server/http-app.js'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const app = new CodexAppServer(process.execPath, [resolve('server/fixtures/plan-questions.mjs')])
const config = { host: '127.0.0.1', port: 0, publicOrigin: new URL('http://127.0.0.1'),
  password: 'isolated fixture password', sessionSecret: 'f'.repeat(48), sessionTtlSeconds: 600,
  codexBin: 'unused', workspaceRoots: ['/tmp'], production: true }
const controller = new RemoteController(config, app)
const server = createRemoteHttpServer(config, controller, resolve('dist'), null)
const browser = await chromium.launch({ headless: true })
try {
  await controller.start()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  config.publicOrigin = new URL(`http://127.0.0.1:${server.address().port}`)
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  // Group storage is unrelated and unavailable without a real vault.
  await page.route('**/api/conversation-groups', route => route.fulfill({ json: { revision: 0, groups: [], assignments: {} } }))
  await context.request.post(`${config.publicOrigin}api/session/login`, {
    headers: { Origin: config.publicOrigin.origin }, data: { password: config.password },
  })
  await page.goto(config.publicOrigin.origin)
  await page.locator('#instruction').waitFor()
  await page.waitForFunction(() => document.querySelector('.workspace-content')?.scrollTop > 1000)
  const question = page.getByLabel('Bạn thích câu hỏi lựa chọn hiển thị theo kiểu nào?', { exact: true })
  const visible = async () => {
    await question.waitFor()
    // Do not click/scroll into view first: that would hide the original bug.
    await page.waitForFunction(() => {
      const el = document.querySelector('.question-field select')
      if (!el) return false
      const rect = el.getBoundingClientRect()
      return rect.top >= 0 && rect.bottom <= innerHeight && document.elementFromPoint(rect.x + 5, rect.y + 5) === el
    }, undefined, { timeout: 5000 })
  }
  await app.request('fixture/question', { id: 'choice' })
  assert.equal(controller.listPending().length, 1, 'Native request reached controller')
  await visible()
  await question.selectOption('Dropdown')
  await page.getByRole('button', { name: 'Send answer', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.request-card'))
  assert.deepEqual((await app.request('fixture/replies', {})).at(-1), { id: 'choice', result: { answers: { question_display_test: { answers: ['Dropdown'] } } } })
  console.log('PASS: native stdio → controller → SSE → visible question → answer RPC')

  // A user reading older history must still see the question without jumping.
  await page.locator('.workspace-content').press('Home')
  await app.request('fixture/question', { id: 'custom' })
  await visible()
  await page.getByLabel('Other answer: Bạn thích câu hỏi lựa chọn hiển thị theo kiểu nào?').fill('Câu trả lời riêng của tôi')
  await page.getByRole('button', { name: 'Send answer', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.request-card'))
  assert.deepEqual((await app.request('fixture/replies', {})).at(-1), { id: 'custom', result: { answers: { question_display_test: { answers: ['Câu trả lời riêng của tôi'] } } } })
  console.log('PASS: question visible while reading older history; custom answer')

  await page.setViewportSize({ width: 390, height: 844 })
  await app.request('fixture/question', { id: 'reload-skip' })
  await visible()
  await page.reload()
  await visible()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No horizontal overflow on mobile')
  if (process.env.PLAN_QUESTION_SCREENSHOT) await page.screenshot({ path: process.env.PLAN_QUESTION_SCREENSHOT })
  assert.equal(await question.inputValue(), '', 'No option is automatically submitted')
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.request-card'))
  assert.deepEqual((await app.request('fixture/replies', {})).at(-1), { id: 'reload-skip', result: { answers: {} } })
  console.log('PASS: mobile display, reload restores pending, Skip replies to native RPC')

  // Disconnect for longer than the replay ring retains the request.
  await context.setOffline(true)
  await page.waitForFunction(() => !navigator.onLine)
  await app.request('fixture/question', { id: 'reconnect-stop' })
  for (let i = 0; i < 1100; i++) controller.events.publish('server-log', { line: `fixture ${i}` })
  await context.setOffline(false)
  await visible()
  await page.getByRole('button', { name: 'Stop Codex', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.request-card'))
  assert.deepEqual(controller.listPending(), [], 'Stop must remove orphaned questions')
  await page.reload()
  await page.locator('#instruction').waitFor()
  assert.equal(await page.locator('.request-card').count(), 0)
  assert.deepEqual(errors, [])
  console.log('PASS: reconnect beyond replay window, Stop cleanup, reload after Stop, no page errors')
} finally {
  await browser.close()
  controller.stop()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
