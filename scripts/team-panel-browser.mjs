// Isolated native protocol + mocked team routes. No real vault or model turns.
// Run after npm run build; PLAYWRIGHT_MODULE may point to an external install.
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
import { RemoteController } from '../dist-server/controller.js'
import { createRemoteHttpServer } from '../dist-server/http-app.js'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const app = new CodexAppServer(process.execPath, [resolve('server/fixtures/plan-questions.mjs')])
const config = { host: '127.0.0.1', port: 0, publicOrigin: new URL('http://127.0.0.1'), password: 'fixture password',
  sessionSecret: 't'.repeat(48), sessionTtlSeconds: 600, codexBin: 'unused', workspaceRoots: ['/tmp'], production: true }
const controller = new RemoteController(config, app)
const server = createRemoteHttpServer(config, controller, resolve('dist'), null)
const browser = await chromium.launch({ headless: true })
const shots = process.env.TEAM_SCREENSHOTS
if (shots) mkdirSync(shots, { recursive: true })
try {
  await controller.start()
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  config.publicOrigin = new URL(`http://127.0.0.1:${server.address().port}`)
  for (const viewport of [{ width: 1280, height: 900 }, { width: 320, height: 600 }, { width: 390, height: 844 }, { width: 390, height: 600 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    let leaderId = 'plan-fixture', revision = 1, paused = [], actions = [], failLeader = false
    let releaseCancel
    const cancelGate = new Promise(resolve => { releaseCancel = resolve })
    let failCancel = true
    const groups = () => ({ revision, groups: [{ id: 'group', name: 'Fixture folder', contextPath: 'unused', leaderThreadId: leaderId, leaderEpoch: revision }],
      assignments: { 'plan-fixture': 'group', worker: 'group' } })
    const tasks = Array.from({ length: 30 }, (_, i) => ({ id: `task-${i}`, threadId: 'worker', groupId: 'group', title: `Task ${i}: ${'Long title '.repeat(10)}`,
      status: i === 29 ? 'running' : 'completed', result: 'Long result without overflowing the page. '.repeat(100) }))
    await page.route('**/api/conversation-groups', route => route.fulfill({ json: groups() }))
    await page.route('**/api/conversation-groups/group/leader', route => {
      if (failLeader) return route.fulfill({ status: 503, json: { error: 'Fixture leader update failed' } })
      leaderId = route.request().postDataJSON().threadId; revision++
      return route.fulfill({ json: groups() })
    })
    await page.route('**/api/threads', async route => {
      const json = await (await route.fetch()).json()
      json.data.push({ ...json.data[0], id: 'worker', name: 'Fixture worker' })
      await route.fulfill({ json })
    })
    await page.route('**/api/threads/worker', async route => {
      const json = await (await context.request.get(`${config.publicOrigin}api/threads/plan-fixture`)).json()
      json.thread.id = 'worker'; json.thread.name = 'Fixture worker'
      await route.fulfill({ json })
    })
    await page.route('**/api/threads/*/orchestration', async route => {
      if (route.request().method() === 'POST') {
        const action = route.request().postDataJSON(); actions.push(action)
        if (action.action === 'cancel' && failCancel) {
          await cancelGate
          failCancel = false
          return route.fulfill({ status: 503, json: { error: 'Fixture cancel failed' } })
        }
        if (action.action === 'release') paused = []
        else tasks.find(task => task.id === action.taskId).status = 'cancelled'
      }
      await route.fulfill({ json: { groupId: 'group', leaderId, members: ['plan-fixture', 'worker'], paused, tasks,
        pendingResults: 1, unconfirmedResults: 0, limits: { concurrent: 3, dispatchesLeft: 10, wakeupsLeft: 4 } } })
    })
    await context.request.post(`${config.publicOrigin}api/session/login`, { headers: { Origin: config.publicOrigin.origin }, data: { password: config.password } })
    await page.goto(config.publicOrigin.origin)
    const transcript = page.locator('.workspace-content'), team = page.locator('.conversation-team-region'), summary = page.locator('.conversation-team > summary'), composer = page.locator('#instruction')
    await composer.waitFor()
    await page.waitForFunction(() => document.querySelector('.workspace-content')?.scrollTop > 1000)
    const isOnscreen = locator => locator.evaluate(el => {
      const r = el.getBoundingClientRect()
      return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
    })
    if (process.env.TEAM_PANEL_EXPECT_BUG) {
      assert.equal(await isOnscreen(summary), false, 'Original panel is lost above long history')
      if (shots) await page.screenshot({ path: resolve(shots, 'before.png') })
      console.log('REPRODUCED: team summary is outside viewport at the latest message')
      await context.close(); break
    }
    const layout = async () => {
      assert.equal(await isOnscreen(summary), true, 'Summary remains visible without scrolling it into view')
      assert.equal(await isOnscreen(composer), true, 'Composer remains visible')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight), false, 'No outer page overflow')
      assert.equal(await team.evaluate(el => !!el.closest('.transcript-region')), false)
      const tab = await page.locator('.view-tabs').boundingBox(), bar = await summary.boundingBox()
      assert.ok(bar.y >= tab.y && bar.y + bar.height <= tab.y + tab.height, 'Leader control shares the tabs row')
      assert.equal(await summary.evaluate(el => !!el.closest('.view-tabs')), true)
      assert.ok(bar.width >= 44 && bar.height >= 44, 'Leader control remains usable on narrow screens')
    }
    await layout()
    if (shots) await page.screenshot({ path: resolve(shots, `collapsed-${viewport.width}x${viewport.height}.png`) })
    await composer.fill('Draft stays while reviewing work')
    // Pause following and put the reading position away from either boundary.
    await transcript.focus(); await transcript.press('Home')
    await transcript.evaluate(el => { el.scrollTop = 500 })
    await page.waitForTimeout(100)
    const top = await transcript.evaluate(el => el.scrollTop)
    await summary.focus(); await summary.press('Enter')
    await team.locator('.team-tasks > li').first().waitFor()
    assert.equal(await team.getByText('Gửi mục tiêu', { exact: false }).count(), 0, 'Redundant leader hint is removed')
    await layout()
    assert.equal(await transcript.evaluate(el => el.scrollTop), top, 'Opening team preserves transcript position')
    await team.locator('.team-task-result > summary').first().click()
    const body = team.locator('.conversation-team-body')
    assert.equal(await body.evaluate(el => el.scrollHeight > el.clientHeight), true, 'Entire expanded body has its own scroll')
    await body.evaluate(el => { el.scrollTop = el.scrollHeight })
    const bodyTop = await body.evaluate(el => el.scrollTop)
    const refreshed = page.waitForResponse(response => response.url().endsWith('/orchestration'))
    controller.events.publish('codex', { method: 'orchestration/changed', params: {} })
    await refreshed
    assert.equal(await page.locator('.conversation-team').getAttribute('open'), '', 'Team stays open during live refresh')
    assert.equal(await body.evaluate(el => el.scrollTop), bodyTop, 'Live refresh preserves team reading position')
    await layout()
    assert.equal(await transcript.evaluate(el => el.scrollTop), top, 'Team scrolling does not scroll history')
    const b = await body.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height - 5); await page.mouse.wheel(0, 700)
    await page.waitForTimeout(100)
    assert.equal(await transcript.evaluate(el => el.scrollTop), top, 'Scrolling at team boundary does not chain into history')
    await summary.click(); await layout()
    assert.equal(await transcript.evaluate(el => el.scrollTop), top, 'Collapsing team preserves reading position')
    await transcript.press('End'); await layout()
    await summary.click()
    await body.evaluate(el => { el.scrollTop = 0 })
    const stopTask = team.getByRole('button', { name: 'Dừng việc', exact: true })
    assert.equal(await stopTask.textContent(), '[x]')
    assert.equal(await stopTask.getAttribute('title'), 'Dừng việc')
    await team.locator('.team-task-actions').first().getByRole('button').first().focus()
    await page.keyboard.press('Tab')
    const stopStyle = await stopTask.evaluate(el => ({ font: getComputedStyle(el).fontFamily, focused: el.matches(':focus-visible'),
      width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }))
    assert.ok(stopStyle.font.includes('monospace') && stopStyle.focused)
    assert.ok(stopStyle.width >= 44 && stopStyle.height >= 44, 'Compact ASCII keeps a usable touch target')
    if (shots) await page.screenshot({ path: resolve(shots, `ascii-stop-${viewport.width}x${viewport.height}.png`) })
    await stopTask.press('Enter')
    await page.waitForFunction(() => document.querySelector('.team-task-stop')?.disabled)
    assert.equal(await stopTask.isDisabled(), true, 'Pending cancel cannot be submitted twice')
    releaseCancel()
    await team.getByRole('alert').filter({ hasText: 'Fixture cancel failed' }).waitFor()
    assert.equal(await stopTask.isEnabled(), true, 'Failed cancel remains retryable')
    await stopTask.click()
    await stopTask.waitFor({ state: 'detached' })
    assert.equal(await team.getByRole('alert').count(), 0, 'Successful retry clears error')
    assert.equal(actions.filter(action => action.action === 'cancel').length, 2)
    assert.deepEqual(actions.at(-1), { action: 'cancel', taskId: 'task-29' })
    await app.request('fixture/question', { id: `team-question-${viewport.height}`, questions: [{ id: 'question', question: 'Choose a plan. '.repeat(40),
      options: [{ label: 'First', description: 'Many details. '.repeat(80) }, { label: 'Second', description: 'Alternative' }] }] })
    await page.locator('.plan-question').waitFor()
    await page.locator('.plan-question').getByRole('radio', { name: 'First', exact: true }).click()
    await layout()
    assert.equal(await isOnscreen(page.locator('.plan-question').getByRole('button', { name: 'Send', exact: true })), true, 'Plan answer remains reachable with team expanded')
    if (shots) await page.screenshot({ path: resolve(shots, `team-${viewport.width}x${viewport.height}.png`) })
    if (viewport.width === 390 && viewport.height === 600) {
      // Combined integration: reload from the logo while a native question and
      // expanded team share the short viewport. No real conversation is used.
      await page.getByRole('button', { name: 'Open conversations', exact: true }).click()
      await page.getByRole('button', { name: 'App menu', exact: true }).click()
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'load' }),
        page.getByRole('button', { name: 'Reload app', exact: true }).click(),
      ])
      await composer.waitFor()
      await page.waitForFunction(() => document.querySelector('.workspace-title h1')?.textContent === 'Plan question fixture')
      assert.equal(await composer.inputValue(), 'Draft stays while reviewing work')
      assert.equal(controller.listPending().length, 1, 'Reload must not resolve/interrupt native input')
      if (await page.locator('.drawer-scrim').count()) {
        await page.locator('.drawer-scrim').click({ position: { x: 380, y: 550 } })
        await page.waitForFunction(() => document.querySelector('.thread-sidebar').getBoundingClientRect().right <= 0)
      }
      await summary.click()
      await page.locator('.plan-question').getByRole('radio', { name: 'First', exact: true }).click()
      await layout()
      assert.equal(await isOnscreen(page.locator('.plan-question').getByRole('button', { name: 'Send', exact: true })), true)
      if (shots) await page.screenshot({ path: resolve(shots, 'combined-after-reload-390x600.png') })
    }
    await page.getByRole('button', { name: 'Stop Codex', exact: true }).click()
    await page.locator('.plan-question').waitFor({ state: 'detached' })
    assert.equal(await composer.inputValue(), 'Draft stays while reviewing work')
    // Worker view, direct-user ownership, release and navigation still function.
    leaderId = 'worker'; revision++; paused = ['plan-fixture']
    await page.reload(); await composer.waitFor(); await summary.click()
    await team.getByRole('button', { name: 'Cho leader giao việc trở lại', exact: true }).click()
    assert.deepEqual(actions.at(-1), { action: 'release' })
    await layout()
    await team.getByRole('button', { name: 'Mở convo leader ↗', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.workspace-title h1')?.textContent === 'Fixture worker')
    await layout()
    // Leader errors remain in the fixed region; clearing leader removes the slot.
    failLeader = true
    await page.getByRole('button', { name: 'Bỏ vai trò leader', exact: true }).click()
    const error = page.getByRole('alert').filter({ hasText: 'Fixture leader update failed' })
    await error.waitFor(); assert.equal(await isOnscreen(error), true)
    failLeader = false
    await page.getByRole('button', { name: 'Bỏ vai trò leader', exact: true }).click()
    await team.waitFor({ state: 'detached' })
    assert.equal(await isOnscreen(composer), true)
    assert.equal(await page.locator('.conversation-team-region').count(), 0)
    await page.getByRole('button', { name: 'Đặt làm leader', exact: true }).click()
    await summary.waitFor()
    // Draft setup hides even an existing leader panel without leaving an empty slot.
    if (viewport.width < 800) await page.getByRole('button', { name: 'Open conversations', exact: true }).click()
    await page.getByRole('button', { name: '＋ New conversation', exact: true }).click()
    await page.locator('#new-conversation-name').waitFor()
    if (viewport.width < 800) await page.waitForFunction(() => document.querySelector('.thread-sidebar').getBoundingClientRect().right <= 0)
    assert.equal(await page.locator('.conversation-team-region').count(), 0)
    assert.equal(await isOnscreen(composer), true)
    assert.deepEqual(errors, [])
    console.log(`PASS ${viewport.width}x${viewport.height}: visible bar, bounded body/results, scroll position/draft, questions/composer, worker actions, no leader and draft`)
    await context.close()
  }
} finally {
  await browser.close(); controller.stop(); server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
