// ALL execution via codex-heavy, after worktree build. Owned files/keys/fake RPC only.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, open, stat, rm, truncate } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
import { RemoteController } from '../dist-server/controller.js'
import { createRemoteHttpServer } from '../dist-server/http-app.js'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/tmp/working-hours-browser/node_modules/playwright/index.mjs')
const root = await mkdtemp(join(tmpdir(), 'history-window-')), files = join(root, 'files'), sessions = join(root, 'native', 'sessions'), sockets = new Set()
const ordinals = new Map()
const row = (type, payload, thread = 'window') => {
  const ordinal = ordinals.get(thread) ?? 0; ordinals.set(thread, ordinal + 1)
  return JSON.stringify({ timestamp: '2026-09-25T00:00:00.000Z', ordinal, type, payload }) + '\n'
}
const event = (type, payload = {}, thread = 'window') => row('event_msg', { type, ...payload }, thread)
const item = (id, type, text, turn = 't', thread = 'window') => event('item_completed', { thread_id: thread, turn_id: turn,
  started_at_ms: 1, completed_at_ms: 2, item: { id, type: type[0].toUpperCase() + type.slice(1),
    ...(type === 'userMessage' ? { content: [{ type: 'text', text, text_elements: [] }] } : type === 'agentMessage' ?
      { content: [{ type: 'Text', text }], phase: 'final_answer' } : { command: 'fixture', status: 'completed', aggregatedOutput: text }) } }, thread)

let browser, server, lastPage, release = () => {}, releaseDetail = () => {}
try {
  await mkdir(files); await mkdir(sessions, { recursive: true })
  const sourcePath = join(sessions, 'window.jsonl'), otherPath = join(sessions, 'other.jsonl')
  const fd = await open(sourcePath, 'w', 0o600)
  await fd.write(row('session_meta', { id: 'window', cwd: files, cli_version: '0.155.0', history_mode: 'paginated', history_base: null, subagent_history_start_ordinal: null }) + event('task_started', { turn_id: 't' }))
  // REAL bytes written in bounded pieces: Small isolated input for independent navigation controls.
  // This is NOT a measurement of a real transcript or a 197 MB single item.
  const tool = 'x'.repeat(100), giantTool = 'large-tool-output-'.repeat(10_000)
  const giantUser = 'oversized-user-content-'.repeat(10_000), giantAssistant = 'oversized-assistant-content-'.repeat(10_000)
  for (let n = 0; n < 80; n++) {
    await fd.write(item(`u${n}`, 'userMessage', n === 78 ? giantUser : `Question ${n}`))
    for (let k = 0; k < 2; k++) await fd.write(item(`tool${n}-${k}`, 'commandExecution', n === 79 && k === 1 ? giantTool : tool))
    await fd.write(item(`a${n}`, 'agentMessage', n === 78 ? giantAssistant : `Answer ${n}\n\n${'Readable fixture content. '.repeat(15)}`))
  }
  await fd.write(event('task_complete', { turn_id: 't' })); await fd.close()
  const originalSize = (await stat(sourcePath)).size, originalOrdinal = ordinals.get('window')
  await writeFile(otherPath, row('session_meta', { id: 'other', cwd: files, cli_version: '0.155.0', history_mode: 'paginated' }, 'other') + event('task_started', { turn_id: 'other-turn' }, 'other') + item('other-answer', 'agentMessage', 'Other cached answer', 'other-turn', 'other') + event('task_complete', { turn_id: 'other-turn' }, 'other'))
  const key = { version: 1, app: randomBytes(24).toString('base64url'), generation: randomBytes(24).toString('base64url'), key: randomBytes(32).toString('base64url') }
  const keyFile = join(root, 'owner.json'); await writeFile(keyFile, JSON.stringify(key), { mode: 0o600 })
  const config = { host: '127.0.0.1', port: 0, publicOrigin: new URL('http://127.0.0.1'), password: 'FAKE window browser password', sessionSecret: 'fake-window'.repeat(6), sessionTtlSeconds: 600, codexBin: 'unused', production: true, workspaceRoots: [files], fileRoots: [files], secureApiRequired: true, secureKeyFile: keyFile, sessionStateFile: join(root, 'sessions.json'), historyNativeHome: join(root, 'native'), historyIndexPath: join(root, 'index') }
  let version = 1, hold = null
  const historyReads = []
  const calls = [], app = new CodexAppServer('UNUSED'), replies = []
  const metadata = id => ({ id, name: id === 'window' ? 'History window fixture' : 'Other fixture', cwd: files, path: id === 'window' ? sourcePath : otherPath, status: { type: 'idle' }, createdAt: 1, updatedAt: version })
  app.request = async (method, p = {}) => {
    calls.push({ method, ...p })
    let result
    if (method === 'thread/list') result = { data: [metadata('window'), metadata('other')], nextCursor: null }
    else if (method === 'thread/read') { assert.equal(p.includeTurns, false); result = { thread: metadata(p.threadId) } }
    else if (method === 'thread/resume') { assert.equal(p.excludeTurns, true); result = { thread: metadata(p.threadId) } }
    else if (method === 'thread/turns/list') { assert.equal(p.itemsView, 'notLoaded'); assert.equal(p.limit, 1); result = { data: [{ id: p.threadId === 'window' ? 't' : 'other-turn', status: 'completed', items: [] }], nextCursor: null } }
    else if (method === 'model/list') result = { data: [] }
    else if (method === 'account/rateLimits/read') result = { rateLimits: {} }
    else throw Error(`Unexpected fake RPC ${method}`)
    return result
  }
  app.respond = (id, result) => { replies.push({ id, result }); app.emit('notification', { method: 'serverRequest/resolved', params: { threadId: 'window', requestId: id } }) }
  const controller = new RemoteController(config, app), original = controller.readHistoryPage.bind(controller)
  const originalDetail = controller.readHistoryDetail.bind(controller), detailReads = []
  let detailHold = null, failDetail = false
  controller.readHistoryPage = async (...args) => {
    if (args[0] === 'window' && hold) await hold
    const result = await original(...args)
    historyReads.push(args[1] ?? null)
    return result
  }
  const blockHistory = () => { hold = new Promise(resolve => { release = () => { hold = null; resolve() } }) }
  const blockDetail = () => { detailHold = new Promise(resolve => { releaseDetail = () => { detailHold = null; resolve() } }) }
  controller.readHistoryDetail = async (...args) => {
    detailReads.push(args[2])
    if (detailHold) await detailHold
    if (failDetail) { failDetail = false; throw Error('Fixture detail failure') }
    return originalDetail(...args)
  }
  server = createRemoteHttpServer(config, controller, resolve('dist'), null)
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); config.publicOrigin = new URL(`http://127.0.0.1:${server.address().port}`)
  browser = await chromium.launch({ headless: true })
  const results = []
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 600 }]) {
    // Each fresh profile gets identical input. The previous profile's odd final
    // append otherwise shifts the twenty-message boundary by one message.
    await truncate(sourcePath, originalSize); ordinals.set('window', originalOrdinal); version = 1
    const context = await browser.newContext({ viewport }), page = await context.newPage(); page.setDefaultTimeout(90000)
    lastPage = page
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    const select = async name => {
      if (viewport.width < 800 && !(await page.locator('.thread-sidebar.is-open').count())) await page.getByRole('button', { name: 'Open conversations', exact: true }).click()
      await page.locator('.thread-row').filter({ hasText: name }).click({ timeout: 15000 })
    }
    const unlock = async () => { await page.getByLabel('Khóa mã hóa riêng', { exact: true }).fill(key.key); await page.getByRole('button', { name: 'Mở khóa', exact: true }).click() }
    const login = async () => {
      await page.getByRole('button', { name: 'Đăng nhập lại', exact: true }).click()
      await page.getByLabel('Mật khẩu đăng nhập', { exact: true }).fill(config.password)
      await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    }
    const transcript = page.getByLabel('Conversation transcript', { exact: true }), composer = page.locator('#instruction')
    await page.goto(config.publicOrigin.origin)
    await login()
    await unlock(); await page.getByText('Question 79', { exact: true }).waitFor()
    assert.equal(await page.locator('.conversation-stream article.message').count(), 20)
    const detailCard = page.locator('.activity-card.has-history-detail').last()
    await detailCard.waitFor()
    assert.equal(await page.getByRole('button', { name: 'Xem nội dung đầy đủ theo từng phần', exact: true }).count(), 0)
    let initialDetailReads = detailReads.length
    await page.waitForTimeout(200)
    assert.equal(detailReads.length, initialDetailReads, 'Collapsed tools load zero detail')
    const waitForDetailRead = async expected => {
      for (let attempt = 0; detailReads.length < expected && attempt < 400; attempt++) await page.waitForTimeout(25)
      assert.equal(detailReads.length, expected, 'Expected one targeted detail request')
    }
    const messageDetails = page.locator('.history-message-detail')
    assert.equal(await messageDetails.count(), 2, 'Both clipped user and assistant messages retain detail access')
    for (const [index, marker] of ['oversized-user-content-', 'oversized-assistant-content-'].entries()) {
      const disclosure = messageDetails.nth(index)
      await disclosure.locator(':scope > summary').click(); await waitForDetailRead(initialDetailReads + index + 1)
      await disclosure.getByText('Bản ghi gốc (JSON), từng phần tối đa 32 KB.', { exact: true }).waitFor()
      assert((await disclosure.locator('.history-detail pre').innerText()).includes(marker))
      assert(Buffer.byteLength(await disclosure.locator('.history-detail pre').innerText()) <= 32 * 1024)
      await disclosure.locator(':scope > summary').click()
    }
    initialDetailReads = detailReads.length
    // Opening the native disclosure starts only this tool detail. Collapsing
    // aborts the client request and cannot paint its late result.
    blockDetail()
    await detailCard.locator(':scope > summary').click()
    await waitForDetailRead(initialDetailReads + 1)
    await detailCard.getByRole('status').waitFor()
    await detailCard.locator(':scope > summary').click()
    releaseDetail()
    await page.waitForTimeout(200)
    assert.equal(await detailCard.getAttribute('open'), null)
    assert.equal(await detailCard.locator('.history-detail').count(), 0)
    // Reopening retries the aborted first chunk. A completed chunk remains in
    // component memory across an ordinary collapse/reopen.
    await detailCard.locator(':scope > summary').click()
    await waitForDetailRead(initialDetailReads + 2)
    await detailCard.getByText('Bản ghi gốc (JSON), từng phần tối đa 32 KB.', { exact: true }).waitFor()
    assert(Buffer.byteLength(await detailCard.locator('.history-detail pre').innerText()) <= 32 * 1024)
    const cachedReads = detailReads.length
    await detailCard.locator(':scope > summary').click(); await detailCard.locator(':scope > summary').click()
    await page.waitForTimeout(200)
    assert.equal(detailReads.length, cachedReads, 'Reopening a loaded tool reuses its detail page')
    // Navigate two pages forward, then fail Previous twice. Retrying must keep
    // both the offset and backwards operation without duplicating the trail.
    await detailCard.getByRole('button', { name: 'Phần tiếp', exact: true }).click(); await waitForDetailRead(cachedReads + 1)
    await detailCard.getByRole('button', { name: 'Phần tiếp', exact: true }).click(); await waitForDetailRead(cachedReads + 2)
    const forwardOffset = detailReads.at(-1)
    failDetail = true
    await detailCard.getByRole('button', { name: 'Phần trước', exact: true }).click(); await waitForDetailRead(cachedReads + 3)
    await detailCard.getByRole('alert').waitFor()
    const failedOffset = detailReads.at(-1)
    failDetail = true
    await detailCard.getByRole('button', { name: 'Thử lại', exact: true }).click(); await waitForDetailRead(cachedReads + 4)
    assert.equal(detailReads.at(-1), failedOffset, 'Repeated retry keeps the failed bounded offset')
    await detailCard.getByRole('button', { name: 'Thử lại', exact: true }).click(); await waitForDetailRead(cachedReads + 5)
    assert.equal(detailReads.at(-1), failedOffset, 'Successful retry keeps the backwards operation')
    await detailCard.getByRole('alert').waitFor({ state: 'detached' })
    await detailCard.getByRole('button', { name: 'Phần trước', exact: true }).click(); await waitForDetailRead(cachedReads + 6)
    assert.equal(detailReads.at(-1), 0, 'Previous after backward retry reaches the real predecessor')
    assert.notEqual(detailReads.at(-1), forwardOffset, 'Previous does not move forward after retry')
    assert(Buffer.byteLength(await detailCard.locator('.history-detail pre').innerText()) <= 32 * 1024)
    await detailCard.locator(':scope > summary').click()
    await composer.fill('Independent review draft')
    await transcript.evaluate(el => { el.scrollTop = 0 })
    await page.getByRole('button', { name: 'Tải tin nhắn cũ hơn', exact: true }).click()
    await page.getByText('Question 60', { exact: true }).waitFor()
    assert.equal(await page.locator('.conversation-stream article.message').count(), 40)
    assert.equal(await page.locator('.jump-latest').count(), 1)
    await transcript.evaluate(el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll', { bubbles: true })) })
    await page.locator('.jump-latest').waitFor({state:'visible'})
    const delta = 'INDEPENDENT NEW OUTPUT ' + viewport.width
    controller.events.publish('codex', { method: 'item/agentMessage/delta', params: { threadId: 'window', turnId: 'new-live', itemId: 'new-live-item', delta } })
    await page.waitForTimeout(350)
    // Acceptance: frozen output stays anchored, but pointer/touch recovery is visible.
    assert.equal(await page.getByText(delta, { exact: true }).count(), 0, 'Frozen history must not inject live output before explicit latest')
    assert.equal(await page.locator('.jump-latest').count(), 1, 'Frozen bottom retains latest control')
    assert.equal(await composer.inputValue(), 'Independent review draft')
    if (process.env.HISTORY_SCREENSHOTS) { await mkdir(process.env.HISTORY_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: join(process.env.HISTORY_SCREENSHOTS, `bottom-latest-available-${viewport.width}.png`) }) }
    // Use pointer (including mobile viewport), not the old keyboard-only workaround.
    await page.locator('.jump-latest').click()
    await page.getByText(delta, { exact: true }).waitFor({ timeout: 10000 })
    assert.equal(await composer.inputValue(), 'Independent review draft')
    // A paused latest20 becomes frozen during background revalidation, without loading older.
    await page.getByText('Question 79', { exact: true }).waitFor()
    await transcript.evaluate(el => { el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight - 200); el.dispatchEvent(new WheelEvent('wheel', { deltaY: -20, bubbles: true })); el.dispatchEvent(new Event('scroll', { bubbles: true })) })
    const pausedTop = await transcript.evaluate(el => el.scrollTop), refreshStart = historyReads.length
    controller.events.publish('codex', { method: 'turn/completed', params: { threadId: 'window', turn: { id: 'refresh-fixture', status: 'completed' } } })
    while (historyReads.length === refreshStart) await page.waitForTimeout(25)
    await page.waitForTimeout(250)
    assert(Math.abs(await transcript.evaluate(el => el.scrollTop) - pausedTop) < 50, 'Background refresh retains paused reader position')
    const pausedDelta = 'FROZEN LATEST OUTPUT ' + viewport.width
    controller.events.publish('codex', { method: 'item/agentMessage/delta', params: { threadId: 'window', turnId: 'paused-live', itemId: 'paused-live-item', delta: pausedDelta } })
    await page.waitForTimeout(250)
    assert.equal(await page.getByText(pausedDelta, { exact: true }).count(), 0)
    await transcript.evaluate(el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll', { bubbles: true })) })
    await page.locator('.jump-latest').waitFor({state:'visible'})
    await page.locator('.jump-latest').click()
    await page.getByText(pausedDelta, { exact: true }).waitFor()
    assert.equal(await composer.inputValue(), 'Independent review draft')
    // Six deliberate page requests cross the240-item bound and evict latest79.
    for (let n = 0; n < 6; n++) {
      await transcript.evaluate(el => { el.scrollTop = 0 })
      const anchor = await page.locator('[data-history-anchor]').first().evaluate(el => ({ id: el.dataset.historyAnchor, y: el.getBoundingClientRect().top }))
      await page.getByRole('button', { name: 'Tải tin nhắn cũ hơn', exact: true }).click()
      await page.getByText('Question ' + (60 - 10*n), { exact: true }).waitFor()
      await transcript.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const y = await page.locator('[data-history-anchor]').evaluateAll((els,id) => els.find(el=>el.dataset.historyAnchor===id)?.getBoundingClientRect().top,anchor.id)
      assert(Math.abs(y-anchor.y)<50, 'Prepend preserves reader anchor including eviction')
      const pageCount = await page.locator('[data-history-anchor]').count(), reads = historyReads.length
      await page.waitForTimeout(200)
      assert.equal(await page.locator('[data-history-anchor]').count(),pageCount,'No automatic page drain')
      assert.equal(historyReads.length,reads,'Only deliberate upward/page action loads older')
    }
    assert.equal(await page.getByText('Question 79', { exact: true }).count(),0,'Latest was evicted from bounded historical window')
    assert.equal(await page.locator('[data-history-anchor]').count(),240)
    await transcript.evaluate(el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll',{bubbles:true})) })
    await page.locator('.jump-latest').waitFor({state:'visible'})
    const deepTop = await transcript.evaluate(el => el.scrollTop), deepDelta = 'DEEP WINDOW OUTPUT ' + viewport.width
    controller.events.publish('codex', { method:'item/agentMessage/delta', params:{threadId:'window',turnId:'deep-live',itemId:'deep-live-item',delta:deepDelta} })
    await page.waitForTimeout(250)
    assert.equal(await page.getByText(deepDelta,{exact:true}).count(),0)
    assert(Math.abs(await transcript.evaluate(el=>el.scrollTop)-deepTop)<50,'SSE does not jump a deep reader')
    if(process.env.HISTORY_SCREENSHOTS) await page.screenshot({path:join(process.env.HISTORY_SCREENSHOTS,`deep-latest-${viewport.width}.png`)})
    await page.locator('.jump-latest').click()
    await page.getByText('Question 79',{exact:true}).waitFor()
    await page.getByText(deepDelta,{exact:true}).waitFor()
    assert.equal(await composer.inputValue(),'Independent review draft')
    const ids=await page.locator('[data-history-anchor]').evaluateAll(els=>els.map(el=>el.dataset.historyAnchor))
    assert.equal(new Set(ids).size,ids.length,'No duplicate rows after restoring latest')
    // Keyboard End remains supported for an ordinary paused reader too.
    await transcript.evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll',{bubbles:true}))})
    await transcript.focus();await page.keyboard.press('End')
    await page.waitForFunction(()=>!document.querySelector('.jump-latest'))
    const beforeDenied = calls.length
    const denied = await context.request.get(config.publicOrigin.origin + '/api/threads/window/history')
    assert.equal(denied.ok(), false); assert.equal(calls.length, beforeDenied)
    // A held detail reply cannot paint into a different conversation.
    await detailCard.locator(':scope > summary').click()
    await detailCard.getByText('Bản ghi gốc (JSON), từng phần tối đa 32 KB.', { exact: true }).waitFor()
    blockDetail(); const switchRead = detailReads.length + 1
    await detailCard.getByRole('button', { name: 'Phần tiếp', exact: true }).click()
    await waitForDetailRead(switchRead)
    await select('Other fixture'); releaseDetail()
    await page.getByText('Other cached answer', { exact: true }).waitFor(); await page.waitForTimeout(200)
    assert.equal(await page.locator('.history-detail').count(), 0)
    // Real in-flight encrypted history response held while switching and locking.
    blockHistory(); await select('Other fixture'); await select('History window fixture'); await select('Other fixture'); release()
    await page.getByText('Other cached answer', { exact: true }).waitFor(); await page.waitForTimeout(250)
    assert.equal(await page.getByText('Question 79', { exact: true }).count(), 0)
    await select('History window fixture'); await page.getByText('Question 79', { exact: true }).waitFor()
    const lockCard = page.locator('.activity-card.has-history-detail').last()
    await lockCard.locator(':scope > summary').click(); await lockCard.getByText('Bản ghi gốc (JSON), từng phần tối đa 32 KB.', { exact: true }).waitFor()
    blockDetail(); const lockRead = detailReads.length + 1
    await lockCard.getByRole('button', { name: 'Phần tiếp', exact: true }).click(); await waitForDetailRead(lockRead)
    if (viewport.width < 800) await page.getByRole('button', { name: 'Open conversations', exact: true }).click()
    await page.getByRole('button', { name: 'App menu', exact: true }).click(); await page.getByRole('button', { name: 'Lock app', exact: true }).click()
    releaseDetail(); await page.getByLabel('Khóa mã hóa riêng', { exact: true }).waitFor()
    assert.equal(await page.locator('.conversation-stream').count(), 0)
    assert.deepEqual(errors, [])
    results.push({ viewport, collapsedDetailRequests: 0, clippedUserAndAssistantDetails: true, disclosureLoadsTarget: true, collapseAbortsLatePaint: true, cachedReopen: true, backwardsRetryChain: true, repeatedRetryStable: true, inlineErrorRetry: true, boundedDetailChunks: true, detailSwitchAndLockDenied: true, oldDetailButtonAbsent: true, frozenBottomRetainsLatest: true, pointerRestoresSameSse: true, pausedLatestRefresh: true, deep240Eviction: true, anchorPreserved: true, noAutoDrain: true, keyboardEnd: true, draftPreserved: true, staleSwitchAndLockDenied: true, cookieOnlyDenied: true })
    await context.close()
  }
  assert(!calls.some(c => c.method === 'turn/start' || c.method === 'thread/items/list' || c.includeTurns === true))
  console.log(JSON.stringify({ baseReview: '6471a6e79e77ae94614d070132331a67748cf92a', acceptance: 'H1', results, realModelTurns: 0 }, null, 2))
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    await lastPage.screenshot({ path: '/tmp/history-independent-failure.png' }).catch(() => {})
    await writeFile('/tmp/history-independent-failure.txt', await lastPage.locator('body').innerText().catch(() => 'Page unavailable'))
  }
  throw error
} finally {
  release(); releaseDetail(); for (const socket of sockets) socket.destroy()
  await browser?.close()
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await rm(root, { recursive: true, force: true })
}
