// Isolated native protocol + mocked team routes. No real vault or model turns.
// Run after npm run build; PLAYWRIGHT_MODULE may point to an external install.
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
import { RemoteController } from '../dist-server/controller.js'
import { MAX_CONCURRENT_WORKERS } from '../dist-server/orchestration.js'
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
    const context = await browser.newContext({ viewport, serviceWorkers: 'allow' })
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
      json.data.unshift({ ...json.data[0], id: 'worker', name: 'Fixture worker', updatedAt: json.data[0].updatedAt + 1000 })
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
        pendingResults: 1, unconfirmedResults: 0, limits: { concurrent: MAX_CONCURRENT_WORKERS, dispatchesLeft: 10, wakeupsLeft: 4 } } })
    })
    await context.request.post(`${config.publicOrigin}api/session/login`, { headers: { Origin: config.publicOrigin.origin }, data: { password: config.password } })
    await page.goto(config.publicOrigin.origin)
    const transcript = page.locator('.workspace-content'), team = page.locator('.leader-page'), composer = page.locator('#instruction')
    const leaderTab = page.locator('.view-tabs').getByRole('button', { name: 'Leader', exact: true })
    const conversationTab = page.locator('.view-tabs').getByRole('button', { name: 'Conversation', exact: true })
    await composer.waitFor()
    if ((await page.locator('.workspace-title h1').textContent()) !== 'Plan question fixture') {
      if (viewport.width < 800) await page.getByRole('button', { name: 'Open conversations', exact: true }).click()
      await page.locator('.thread-row').filter({ hasText: 'Plan question fixture' }).click()
      await page.waitForFunction(() => document.querySelector('.workspace-title h1')?.textContent === 'Plan question fixture')
    }
    await page.waitForFunction(() => document.querySelector('.workspace-content')?.scrollTop > 1000)
    const isOnscreen = locator => locator.evaluate(el => {
      const r = el.getBoundingClientRect()
      return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
    })
    const layout = async () => {
      assert.equal(await isOnscreen(leaderTab), true)
      assert.equal(await isOnscreen(composer), true)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight), false, 'No outer overflow')
      const tabs = await page.locator('.view-tabs').boundingBox(), files = await page.locator('.files-tab').boundingBox()
      const leader = await leaderTab.boundingBox()
      assert.ok(files.x > leader.x + leader.width - 1, 'Files follows Leader')
      assert.ok(tabs.x + tabs.width - files.x - files.width <= 23, 'Files is at the right edge')
      if (await team.isVisible()) {
        assert.equal(await transcript.count(), 0, 'Leader is a separate page, not an expanded strip over chat')
        const body = await team.boundingBox()
        assert.ok(body.height >= (await page.locator('.pending-requests').count() ? 44 : 200), 'Leader page uses remaining space beside pending input')
        assert.equal(await leaderTab.getAttribute('aria-current'), 'page')
      } else {
        assert.equal(await transcript.isVisible(), true)
        assert.equal(await conversationTab.getAttribute('aria-current'), 'page')
      }
    }
    await layout()
    assert.match(await page.locator('.thread-row-title').first().textContent(), /Plan question fixture/, 'Leader is first despite newer worker')
    assert.equal(await team.isVisible(), false)
    if (viewport.width < 800) await page.getByRole('button', { name: 'Open conversations', exact: true }).click()
    const folder = page.locator('.conversation-folder').filter({ has: page.locator('.folder-name', { hasText: 'Fixture folder' }) })
    const folderToggle = folder.locator('.conversation-folder-toggle')
    await folderToggle.click()
    assert.equal(await folderToggle.getAttribute('aria-expanded'), 'false')
    assert.equal(await folder.locator('.thread-row').count(), 1, 'Collapsed folder retains only its leader')
    assert.match(await folder.locator('.thread-row-title').textContent(), /Plan question fixture/)
    const search = page.getByRole('searchbox')
    await search.fill('Fixture worker')
    assert.equal(await folder.locator('.thread-row').count(), 1)
    assert.match(await folder.locator('.thread-row-title').textContent(), /Fixture worker/, 'Search does not force a nonmatching leader into results')
    await search.fill('')
    assert.equal(await folderToggle.getAttribute('aria-expanded'), 'false')
    assert.match(await folder.locator('.thread-row-title').textContent(), /Plan question fixture/)
    if (shots) await page.screenshot({ path: resolve(shots, `folder-collapsed-${viewport.width}x${viewport.height}.png`) })
    await folder.locator('.thread-row').click()
    assert.equal(await folderToggle.getAttribute('aria-expanded'), 'false', 'Opening leader keeps folder collapsed')
    if (viewport.width < 800) await page.getByRole('button', { name: 'Open conversations', exact: true }).click()
    await folderToggle.click()
    assert.equal(await folder.locator('.thread-row').count(), 2)
    if (viewport.width < 800) await folder.locator('.thread-row').first().click()
    if (shots) await page.screenshot({ path: resolve(shots, `conversation-${viewport.width}x${viewport.height}.png`) })
    await composer.fill('Draft stays while reviewing work')
    await transcript.focus(); await transcript.press('Home')
    await transcript.evaluate(el => { el.scrollTop = 500 })
    await page.waitForTimeout(100)
    const top = await transcript.evaluate(el => el.scrollTop)
    await leaderTab.focus(); await leaderTab.press('Enter')
    await team.locator('.team-tasks > li').first().waitFor()
    await layout()
    assert.equal(await composer.inputValue(), 'Draft stays while reviewing work')
    await team.locator('.team-task-result > summary').first().click()
    assert.equal(await team.evaluate(el => el.scrollHeight > el.clientHeight), true)
    await team.evaluate(el => { el.scrollTop = 500 })
    const teamTop = await team.evaluate(el => el.scrollTop)
    const refreshed = page.waitForResponse(response => response.url().endsWith('/orchestration'))
    controller.events.publish('codex', { method: 'orchestration/changed', params: {} })
    await refreshed
    assert.equal(await team.evaluate(el => el.scrollTop), teamTop, 'Live updates preserve page position')
    await conversationTab.click()
    await transcript.waitFor()
    assert.equal(await transcript.evaluate(el => el.scrollTop), top, 'Returning restores transcript position')
    await layout()
    await leaderTab.click()
    assert.equal(await team.evaluate(el => el.scrollTop), teamTop, 'Returning restores leader page position')
    await team.evaluate(el => { el.scrollTop = 0 })
    await team.locator('.team-task-result > summary').first().click()
    const stopTask = team.getByRole('button', { name: 'Dừng việc', exact: true })
    assert.equal(await stopTask.textContent(), '[x]')
    await stopTask.focus(); await stopTask.press('Enter')
    await page.waitForFunction(() => document.querySelector('.team-task-stop')?.disabled)
    releaseCancel()
    await team.getByRole('alert').filter({ hasText: 'Fixture cancel failed' }).waitFor()
    assert.equal(await stopTask.isEnabled(), true)
    await stopTask.click(); await stopTask.waitFor({ state: 'detached' })
    assert.equal(await team.getByRole('alert').count(), 0)
    assert.equal(actions.filter(action => action.action === 'cancel').length, 2)
    await team.evaluate(el => { el.scrollTop = 0 })
    if (shots) await page.screenshot({ path: resolve(shots, `leader-${viewport.width}x${viewport.height}.png`) })
    await app.request('fixture/question', { id: `team-question-${viewport.width}-${viewport.height}`, questions: [{ id: 'question', question: 'Choose a plan. '.repeat(40),
      options: [{ label: 'First', description: 'Many details. '.repeat(80) }, { label: 'Second', description: 'Alternative' }] }] })
    await page.locator('.plan-question').waitFor()
    await page.locator('.plan-question').getByRole('radio', { name: 'First', exact: true }).click()
    await layout()
    assert.equal(await isOnscreen(page.locator('.plan-question').getByRole('button', { name: 'Send', exact: true })), true)
    await conversationTab.click(); await layout(); await leaderTab.click(); await layout()
    assert.equal(controller.listPending().length, 1)
    if (shots) await page.screenshot({ path: resolve(shots, `leader-plan-${viewport.width}x${viewport.height}.png`) })
    if (viewport.width === 390 && viewport.height === 600) {
      await page.getByRole('button', { name: 'Open conversations', exact: true }).click()
      await page.getByRole('button', { name: 'App menu', exact: true }).click()
      await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.getByRole('button', { name: 'Reload app', exact: true }).click()])
      await composer.waitFor()
      assert.equal(await composer.inputValue(), 'Draft stays while reviewing work')
      assert.equal(controller.listPending().length, 1)
      if (await page.locator('.drawer-scrim').count()) {
        await page.locator('.drawer-scrim').click({ position: { x: 380, y: 550 } })
        await page.waitForFunction(() => document.querySelector('.thread-sidebar').getBoundingClientRect().right <= 0)
      }
      await leaderTab.click(); await layout()
    }
    await page.getByRole('button', { name: 'Stop Codex', exact: true }).click()
    await page.locator('.plan-question').waitFor({ state: 'detached' })
    assert.equal(await composer.inputValue(), 'Draft stays while reviewing work')
    // Errors remain visible in both views.
    failLeader = true
    await page.getByRole('button', { name: 'Bỏ vai trò leader', exact: true }).click()
    const error = page.getByRole('alert').filter({ hasText: 'Fixture leader update failed' })
    await error.waitFor(); assert.equal(await isOnscreen(error), true)
    await conversationTab.click(); assert.equal(await isOnscreen(error), true)
    failLeader = false
    // Worker ownership, release and navigation.
    leaderId = 'worker'; revision++; paused = ['plan-fixture']
    await page.reload(); await composer.waitFor(); await leaderTab.click()
    assert.match(await page.locator('.thread-row-title').first().textContent(), /Fixture worker/, 'Changing leader updates folder order')
    if (viewport.width < 800) await page.getByRole('button', { name: 'Open conversations', exact: true }).click()
    await folderToggle.click()
    assert.equal(await folder.locator('.thread-row').count(), 1)
    assert.match(await folder.locator('.thread-row-title').textContent(), /Fixture worker/)
    await folderToggle.click()
    if (viewport.width < 800) await page.getByRole('button', { name: 'Close conversations', exact: true }).click({ position: { x: viewport.width - 5, y: 500 } })
    await team.getByRole('button', { name: 'Cho leader giao việc trở lại', exact: true }).click()
    assert.deepEqual(actions.at(-1), { action: 'release' })
    await layout()
    await team.getByRole('button', { name: 'Mở convo leader ↗', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.workspace-title h1')?.textContent === 'Fixture worker')
    assert.equal(await team.isVisible(), false, 'Opening another conversation returns to chat')
    await leaderTab.click(); await layout()
    await page.getByRole('button', { name: 'Bỏ vai trò leader', exact: true }).click()
    await leaderTab.waitFor({ state: 'detached' })
    assert.equal(await transcript.isVisible(), true, 'Removing leader returns to conversation')
    assert.equal(await team.count(), 0)
    await page.getByRole('button', { name: 'Đặt làm leader', exact: true }).click()
    await leaderTab.waitFor(); await leaderTab.click()
    if (viewport.width < 800) await page.getByRole('button', { name: 'Open conversations', exact: true }).click()
    await page.getByRole('button', { name: '＋ New conversation', exact: true }).click()
    await page.locator('#new-conversation-name').waitFor()
    if (viewport.width < 800) await page.waitForFunction(() => document.querySelector('.thread-sidebar').getBoundingClientRect().right <= 0)
    assert.equal(await leaderTab.count(), 0)
    assert.equal(await isOnscreen(composer), true)
    assert.deepEqual(errors, [])
    console.log(`PASS ${viewport.width}x${viewport.height}: separate Leader page, Files right, keyboard, scrolling/draft, cancel/retry, Plan/reload, worker controls and fallback`)
    await context.close()
  }
} finally {
  await browser.close(); controller.stop(); server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
