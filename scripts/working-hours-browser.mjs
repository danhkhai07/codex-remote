// All browser requests are intercepted. Real store, fake clock/data; no listener,
// production API, credentials, session logs, or model turns are used.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join, resolve, extname } from 'node:path'
import { WorkHoursStore } from '../dist-server/work-hours.js'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({headless: true})
const root = mkdtempSync('/tmp/hours-pause-browser-')
const dashboardPath = '/root/VAULTS/Flint-Software/Working-Hours/index.html'
const shots = process.env.HOURS_SCREENSHOTS
if (shots) mkdirSync(shots, {recursive: true})
try {
 for (const viewport of [{width: 1280, height: 1000}, {width: 390, height: 844}, {width: 320, height: 700}]) {
  let now = Date.parse('2026-09-21T12:00:00+07:00'), mode = '', posts = 0, release
  const file = join(root, `state-${viewport.width}.json`), day = '2026-09-21', hour = 3600000
  const store = new WorkHoursStore(file, () => now)
  const estimates = end => writeFileSync(join(root, 'data.json'), JSON.stringify({days: [], activityIntervals: [[now - 2 * hour, end]]}))
  estimates(now)
  const data = {generated: new Date(now).toISOString(), today: day, timezone: 'Asia/Ho_Chi_Minh', sourceFiles: 1, gapMinutes: 60, days: [{date: day, hours: 2, estimatedHours: 2, source: 'recorded'}]}
  const html = readFileSync('working-hours/dashboard.template.html', 'utf8').replace('__WORK_DATA__', JSON.stringify(data))
  const thread = {id: 'fixture', name: 'Hours fixture', cwd: '/tmp', status: {type: 'idle'}, createdAt: 1, updatedAt: 1, turns: [{id: 'history', status: 'completed', items: [{id: 'link', type: 'agentMessage', text: `[Hours dashboard](${dashboardPath})`}]}]}
  const context = await browser.newContext({viewport, serviceWorkers: 'block'})
  const errors = []
  await context.route('**/*', async route => {
   const url = new URL(route.request().url()), path = url.pathname
   const json = value => route.fulfill({json: value})
   if (path === '/api/secure/setup') return json({required: false, version: 1})
   if (path === '/api/session') return json({csrf: 'fixture-csrf', expiresAt: Math.floor(Date.now()/1000)+3600, workspaces: [{id: '0', path: '/tmp', label: 'Fixture'}]})
   if (path === '/api/working-hours') {
    if (route.request().method() === 'POST') {
     posts++
     assert.equal(route.request().headers()['x-csrf-token'], 'fixture-csrf')
     const input = route.request().postDataJSON()
     if (mode === 'pending') await new Promise(resolve => {release = resolve})
     if (mode === 'failure') return route.fulfill({status: 503, json: {error: 'Fixture unavailable'}})
     if (mode === 'conflict') {store.change({action: input.action, expectedRevision: store.read().revision}); mode = ''}
     try {return json(store.change(input))} catch (error) {return route.fulfill({status: error.status || 500, json: {error: error.message}})}
    }
    return json(store.read())
   }
   if (path === '/api/files/html-preview' || path === '/api/files/content') return route.fulfill({contentType: 'text/html', body: html})
   if (path === '/api/files/roots') return json({roots: ['/tmp']})
   if (path === '/api/files/list') return json({path: '/tmp', parentPath: null, total: 1, offset: 0, limit: 100, entries: [{name: 'index.html', path: dashboardPath, kind: 'file', symlink: false, size: html.length, modifiedAt: new Date(now).toISOString()}]})
   if (path === '/api/files/info') return json({path: dashboardPath, name: 'index.html', extension: '.html', contentType: 'text/html', kind: 'text', size: html.length, previewable: true, createdAt: new Date(now).toISOString(), modifiedAt: new Date(now).toISOString()})
   if (path === '/api/threads') return json({data: [thread], nextCursor: null})
   if (path === '/api/threads/fixture' || path === '/api/threads/fixture/resume') return json({thread})
   if (path === '/api/conversation-groups') return json({revision: 0, groups: [], assignments: {}})
   if (path === '/api/models') return json({data: [{id: 'fixture', model: 'fixture', isDefault: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: []}]})
   if (path === '/api/read-state' || path.endsWith('/read-state')) return json({revision: 0, unread: {}})
   if (path === '/api/pending') return json({data: [], cursor: 0, epoch: 'fixture'})
   if (path === '/api/events') return route.fulfill({contentType: 'text/event-stream', body: ': fixture\n\n'})
   if (path.startsWith('/api/')) return json({data: [], ids: [], enabled: false})
   const asset = path.startsWith('/assets/') ? resolve('dist', '.'+path) : resolve('dist/index.html')
   const mime = {'.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html'}[extname(asset)] || 'application/octet-stream'
   return route.fulfill({contentType: mime, body: readFileSync(asset)})
  })
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(12000)
  await page.goto('http://hours.fixture/working-hours')
  let frame = page.frameLocator('iframe')
  await frame.locator('#auto-toggle:enabled').waitFor()
  assert.match(await frame.locator('#auto-state').innerText(), /Đang hoạt động/)
  await frame.locator('#today-worked').filter({hasText: '2 giờ 00 phút'}).waitFor()
  assert.equal(await frame.locator('#today-worked').getAttribute('data-date'), day)
  await frame.locator('#edit-date').fill('2026-09-20')
  await frame.locator('#range').selectOption('month')
  assert.equal(await frame.locator('#today-worked').innerText(), '2 giờ 00 phút')
  mode = 'pending'; const before = posts
  await frame.locator('#auto-toggle').click()
  await frame.locator('#auto-toggle[aria-busy="true"]').waitFor()
  assert.equal(await frame.locator('#auto-toggle').isDisabled(), true)
  assert.equal(store.read().autoPaused, false)
  await frame.locator('#auto-toggle').evaluate(button => {button.click(); button.click()})
  // Await the intercepted POST rather than guessing network timing.
  while (!release) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(posts, before + 1); mode = ''; release()
  await frame.getByRole('button', {name: 'Tiếp tục', exact: true}).waitFor()
  now += hour; estimates(now)
  await page.reload(); frame = page.frameLocator('iframe')
  await frame.getByRole('button', {name: 'Tiếp tục', exact: true}).waitFor()
  assert.equal(store.read().totals[day], 2)
  assert.equal(await frame.locator('#today-worked').innerText(), '2 giờ 00 phút')
  assert.equal(await frame.locator('#timer-start').isDisabled(), true)
  assert.equal(await frame.locator('body').evaluate(body => body.scrollWidth > innerWidth), false)
  if (shots) await page.screenshot({path: join(shots, `paused-${viewport.width}.png`), fullPage: true})
  mode = 'failure'; await frame.locator('#auto-toggle').click()
  await frame.locator('#auto-status').filter({hasText: 'Fixture unavailable'}).waitFor()
  assert.equal(store.read().autoPaused, true)
  assert.equal(await frame.locator('#auto-toggle').innerText(), 'Tiếp tục')
  mode = 'conflict'; await frame.locator('#auto-toggle').click()
  await frame.locator('#auto-status').filter({hasText: 'máy khác'}).waitFor()
  assert.equal(await frame.locator('#auto-toggle').innerText(), 'Tạm dừng')
  assert.equal(store.read().timer, null)
  now += hour; estimates(now)
  assert.equal(store.read().totals[day], 3)
  await frame.locator('#today-worked').filter({hasText: '3 giờ 00 phút'}).waitFor()
  // Exercise the exact FileViewer bridge from the Files browser.
  await page.goto('http://hours.fixture/')
  await page.locator('#instruction').waitFor().catch(async error => {console.error(await page.locator('body').innerText(), errors); throw error})
  await page.getByRole('button', {name: 'Files', exact: true}).click()
  await page.locator('.file-browser-entry').filter({hasText: 'index.html'}).first().click().catch(async error => {console.error(await page.locator('body').innerText(), errors); throw error})
  frame = page.frameLocator('.file-viewer iframe')
  await frame.locator('#auto-toggle:enabled').waitFor()
  await frame.locator('#timer-start').click()
  await frame.locator('#timer-stop:enabled').waitFor()
  now += hour / 2
  await frame.locator('#today-worked').filter({hasText: '3 giờ 30 phút'}).waitFor()
  await frame.locator('#auto-toggle').click()
  await frame.getByRole('button', {name: 'Tiếp tục', exact: true}).waitFor()
  assert.equal(store.read().timer, null); assert.equal(store.read().totals[day], 3.5)
  assert.equal(await frame.locator('#today-worked').innerText(), '3 giờ 30 phút')
  await frame.locator('#edit-date').fill('2026-09-20')
  await frame.locator('#range').selectOption('month')
  now = Date.parse('2026-09-22T00:00:30+07:00')
  await frame.locator('#today-worked').filter({hasText: 'Chưa có dữ liệu'}).waitFor()
  assert.equal(await frame.locator('#today-worked').getAttribute('data-date'), '2026-09-22')
  assert.equal(await frame.locator('#edit-date').inputValue(), '2026-09-20')
  assert.equal(await frame.locator('#range').inputValue(), 'month')
  assert.equal(store.read().autoPaused, true)
  if (shots) await page.screenshot({path: join(shots, `file-view-paused-${viewport.width}.png`), fullPage: true})
  assert.deepEqual(errors, [])
  console.log(`PASS ${viewport.width}: today total, other date/month, midnight rollover, paused/running, page/file-view and pause controls`)
  await context.close()
 }
} finally {await browser.close(); rmSync(root, {recursive: true, force: true})}
