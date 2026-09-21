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
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'allow' })
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
  const panel = page.locator('.plan-question')
  const composer = page.locator('#instruction')
  const radio = label => panel.getByRole('radio', { name: label, exact: true })
  const button = name => panel.getByRole('button', { name, exact: true })
  const visible = async () => {
    await panel.waitFor()
    // Never scroll into view before asserting visibility (the original regression).
    await page.waitForFunction(() => {
      const el = document.querySelector('.plan-question')
      if (!el) return false
      const r = el.getBoundingClientRect()
      return r.top >= 0 && r.bottom <= innerHeight && el.contains(document.elementFromPoint(r.x + 3, r.y + 3))
    })
  }
  const ask = async (id, questions) => { await app.request('fixture/question', { id, questions }); await visible() }
  const gone = () => panel.waitFor({ state: 'detached' })
  const replies = () => app.request('fixture/replies', {})
  const lastReply = async (id, answers) => assert.deepEqual((await replies()).at(-1), { id, result: { answers } })
  const options = [{ label: 'Small', description: 'One part at a time' }, { label: 'All', description: 'Everything at once' }]
  const questions = [
    { id: 'scope', question: 'Which scope?', options },
    { id: 'detail', question: 'Any extra details?', options },
    { id: 'notes', question: 'Your notes?', options },
  ]
  await page.getByRole('button', { name: 'Plan mode', exact: true }).click()
  assert.equal(await page.getByText('Plan mode · Tìm hiểu và lập kế hoạch trước khi sửa code.', { exact: true }).count(), 0)
  await composer.fill('Keep my chat draft untouched')
  await ask('choice')
  assert.equal(controller.listPending().length, 1)
  assert.equal(await composer.evaluate(el => el === document.activeElement), true, 'Arrival must not steal composer focus')
  await composer.press('ArrowUp')
  await composer.press('ArrowDown')
  await composer.press('Shift+Enter')
  assert.equal(await radio('Dropdown').getAttribute('aria-checked'), 'false', 'Composer keys must not select answers')
  assert.equal((await replies()).length, 0)
  assert.equal(await button('Send').isDisabled(), true)
  assert.equal(await panel.locator('input, select, details, .plan-question-description').count(), 0)
  assert.ok((await panel.boundingBox()).height < 280, 'Short desktop question must be compact')
  await radio('Dropdown').click()
  assert.equal(await panel.locator('.plan-question-description').count(), 1)
  assert.equal((await replies()).length, 0, 'Selection must not submit automatically')
  if (process.env.PLAN_QUESTION_SCREENSHOT) await page.screenshot({ path: process.env.PLAN_QUESTION_SCREENSHOT.replace(/\.png$/, '-desktop.png') })
  await button('Send').click()
  await gone()
  await lastReply('choice', { question_display_test: { answers: ['Dropdown'] } })
  console.log('PASS: compact desktop, native RPC answer, no preselection, scoped keys/focus, draft preserved')

  await page.locator('.workspace-content').press('Home')
  await ask('multi', questions)
  const beforeMulti = (await replies()).length
  await radio('Small').focus()
  await radio('Small').press('ArrowDown')
  assert.equal(await radio('All').getAttribute('aria-checked'), 'true')
  await radio('All').press('ArrowUp')
  assert.equal(await radio('Small').getAttribute('aria-checked'), 'true')
  await radio('Small').press('Enter')
  await panel.getByLabel('Question 2 of 3').waitFor()
  await radio('All').click()
  await button('Back').click()
  assert.equal(await radio('Small').getAttribute('aria-checked'), 'true', 'Back preserves the first answer')
  await button('Next').click()
  assert.equal(await radio('All').getAttribute('aria-checked'), 'true', 'Back/Next preserves the second answer')
  await button('Skip').click()
  await panel.getByLabel('Question 3 of 3').waitFor()
  assert.equal((await replies()).length, beforeMulti, 'Skip advances only the current question')
  await radio('Other answer…').click()
  const custom = panel.getByLabel('Other answer: Your notes?', { exact: true })
  await custom.fill('Câu trả lời riêng của tôi')
  await button('Back').click()
  assert.equal(await radio('All').getAttribute('aria-checked'), 'true', 'Skipped question keeps its choice for Back')
  await button('Skip').click()
  assert.equal(await custom.inputValue(), 'Câu trả lời riêng của tôi')
  // IME Enter must neither advance nor submit, including the Safari 229 signal.
  await custom.dispatchEvent('compositionstart')
  await custom.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 })
  await custom.dispatchEvent('compositionend')
  assert.equal((await replies()).length, beforeMulti)
  await custom.press('Enter')
  await gone()
  await lastReply('multi', { scope: { answers: ['Small'] }, notes: { answers: ['Câu trả lời riêng của tôi'] } })
  assert.match(await composer.inputValue(), /Keep my chat draft untouched/)
  console.log('PASS: several questions, Back, per-question Skip, custom, arrows/Enter, IME, one combined response')

  await ask('failure', [{ id: 'secret', question: 'Private answer?', isSecret: true, options: null }])
  const secret = panel.locator('input[aria-label="Private answer?"]')
  assert.equal(await secret.getAttribute('type'), 'password')
  await secret.fill('fixture private answer')
  let failRequest
  const waitingRequest = new Promise(resolve => { failRequest = resolve })
  let intercepted
  await page.route('**/api/requests/*/respond', async route => { intercepted = route; failRequest() }, { times: 1 })
  await button('Send').click()
  await waitingRequest
  assert.equal(await secret.isDisabled(), true)
  assert.equal(await button('Skip').isDisabled(), true)
  await intercepted.fulfill({ status: 503, json: { error: 'Fixture retryable failure' } })
  await panel.getByRole('alert').waitFor()
  assert.equal(await secret.inputValue(), 'fixture private answer')
  await button('Retry').click()
  await gone()
  await lastReply('failure', { secret: { answers: ['fixture private answer'] } })
  console.log('PASS: free text, isSecret, busy disables mutation, failed response retry preserves answers')

  await ask('skip-retry', questions)
  await radio('Small').click()
  await button('Next').click()
  await button('Skip').click()
  await page.route('**/api/requests/*/respond', route => route.fulfill({ status: 503, json: { error: 'Retry skipped final question' } }), { times: 1 })
  await button('Skip').click()
  await panel.getByRole('alert').waitFor()
  await button('Back').click()
  await button('Back').click()
  assert.equal(await radio('Small').getAttribute('aria-checked'), 'true', 'Failed send must preserve earlier answers for Back')
  await button('Next').click()
  await button('Skip').click()
  await page.route('**/api/requests/*/respond', route => route.fulfill({ status: 503, json: { error: 'Retry skipped final question again' } }), { times: 1 })
  await button('Skip').click()
  await panel.getByRole('alert').waitFor()
  await button('Retry').click()
  await gone()
  await lastReply('skip-retry', { scope: { answers: ['Small'] } })
  console.log('PASS: failed final Skip, Back preserves earlier answers, retry keeps skipped IDs omitted')

  await page.setViewportSize({ width: 390, height: 844 })
  await ask('reload-skip', questions.slice(0, 1))
  await page.reload()
  await visible()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.ok((await panel.boundingBox()).height < 260, 'Short mobile question must be compact')
  assert.equal(await panel.locator('[aria-checked="true"]').count(), 0)
  if (process.env.PLAN_QUESTION_SCREENSHOT) await page.screenshot({ path: process.env.PLAN_QUESTION_SCREENSHOT })
  await button('Skip').click()
  await gone()
  await lastReply('reload-skip', {})
  console.log('PASS: compact mobile and reload restore pending, Skip sends empty answers')

  await ask('long', [{ id: 'long', question: 'Long question '.repeat(50), options: [
    { label: 'Long option '.repeat(35), description: 'Long description '.repeat(80) },
    ...Array.from({ length: 12 }, (_, i) => ({ label: `Option ${i}`, description: 'Details' })),
  ] }])
  await panel.getByRole('radio').first().click()
  const body = panel.locator('.plan-question-body')
  assert.equal(await body.evaluate(el => el.scrollHeight > el.clientHeight), true, 'Long content scrolls inside question')
  assert.ok((await panel.boundingBox()).height <= 360)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.equal(await button('Skip').isVisible(), true)
  const skipBounds = await button('Skip').boundingBox(), composerBounds = await composer.boundingBox()
  assert.ok(skipBounds.y + skipBounds.height <= composerBounds.y, 'Long question actions remain above composer')
  if (process.env.PLAN_QUESTION_SCREENSHOT) await page.screenshot({ path: process.env.PLAN_QUESTION_SCREENSHOT.replace(/\.png$/, '-long.png') })
  await composer.fill('Draft survives long question')
  await composer.press('ArrowUp')
  assert.equal(await composer.inputValue(), 'Draft survives long question')
  await button('Skip').click()
  await gone()
  console.log('PASS: bounded long content/internal scroll with accessible actions and composer')

  await context.setOffline(true)
  await page.waitForFunction(() => !navigator.onLine)
  await app.request('fixture/question', { id: 'reconnect-stop' })
  for (let i = 0; i < 1100; i++) controller.events.publish('server-log', { line: `fixture ${i}` })
  await context.setOffline(false)
  await visible()
  assert.equal(await composer.inputValue(), 'Draft survives long question')
  await page.getByRole('button', { name: 'Stop Codex', exact: true }).click()
  await gone()
  assert.deepEqual(controller.listPending(), [])
  await page.reload()
  await composer.waitFor()
  assert.equal(await panel.count(), 0)
  assert.deepEqual(errors, [])
  console.log('PASS: reconnect beyond replay window, Stop cleanup, reload after Stop, no page errors')
} finally {
  await browser.close()
  controller.stop()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
