// ALL execution via codex-heavy, after worktree build. Owned files/keys/fake RPC only.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, appendFile, open, stat, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
import { RemoteController } from '../dist-server/controller.js'
import { createRemoteHttpServer } from '../dist-server/http-app.js'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/tmp/working-hours-browser/node_modules/playwright/index.mjs')
const root = await mkdtemp(join(tmpdir(), 'history-window-')), files = join(root, 'files'), sessions = join(root, 'native', 'sessions'), sockets = new Set()
const row = (type, payload) => JSON.stringify({ type, payload }) + '\n'
const event = (type, payload = {}) => row('event_msg', { type, ...payload })
const item = (id, type, text, turn = 't') => event('item_completed', { turn_id: turn, item: { id, type, ...(type === 'userMessage' ? { content: [{ type: 'text', text }] } : type === 'commandExecution' ? { command: 'fixture', status: 'completed', aggregatedOutput: text } : { text, phase: 'final_answer' }) } })
let browser, server, release = () => {}
try {
  await mkdir(files); await mkdir(sessions, { recursive: true })
  const sourcePath = join(sessions, 'window.jsonl'), otherPath = join(sessions, 'other.jsonl')
  const fd = await open(sourcePath, 'w', 0o600)
  await fd.write(row('session_meta', { id: 'window', cwd: files }) + event('task_started', { turn_id: 't' }))
  // REAL bytes written in bounded pieces: 197 MB across 1000 tool records.
  // This is NOT a measurement of a real transcript or a 197 MB single item.
  const tool = 'x'.repeat(197000)
  for (let n = 0; n < 500; n++) {
    await fd.write(item(`u${n}`, 'userMessage', `Question ${n}`))
    for (let k = 0; k < 2; k++) await fd.write(item(`tool${n}-${k}`, 'commandExecution', tool))
    await fd.write(item(`a${n}`, 'agentMessage', `Answer ${n}\n\n${'Readable fixture content. '.repeat(15)}`))
  }
  await fd.write(event('task_complete', { turn_id: 't' })); await fd.close()
  await writeFile(otherPath, row('session_meta', { id: 'other', cwd: files }) + event('task_started', { turn_id: 'other-turn' }) + item('other-answer', 'agentMessage', 'Other cached answer', 'other-turn') + event('task_complete', { turn_id: 'other-turn' }))
  const key = { version: 1, app: randomBytes(24).toString('base64url'), generation: randomBytes(24).toString('base64url'), key: randomBytes(32).toString('base64url') }
  const keyFile = join(root, 'owner.json'); await writeFile(keyFile, JSON.stringify(key), { mode: 0o600 })
  const config = { host: '127.0.0.1', port: 0, publicOrigin: new URL('http://127.0.0.1'), password: 'FAKE window browser password', sessionSecret: 'fake-window'.repeat(6), sessionTtlSeconds: 600, codexBin: 'unused', production: true, workspaceRoots: [files], fileRoots: [files], secureApiRequired: true, secureKeyFile: keyFile, sessionStateFile: join(root, 'sessions.json'), historyNativeHome: join(root, 'native'), historyIndexPath: join(root, 'index') }
  let version = 1, hold = null, wireBytes = 0, nativeBytes = 0, pages = 0, bodyBytes = 0
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
    nativeBytes += Buffer.byteLength(JSON.stringify(result)); return result
  }
  app.respond = (id, result) => { replies.push({ id, result }); app.emit('notification', { method: 'serverRequest/resolved', params: { threadId: 'window', requestId: id } }) }
  const controller = new RemoteController(config, app), original = controller.readHistoryPage.bind(controller)
  controller.readHistoryPage = async (...args) => {
    if (args[0] === 'window' && hold) await hold
    const value = await original(...args); pages++; bodyBytes += Buffer.byteLength(JSON.stringify(value)); return value
  }
  const blockHistory = () => { hold = new Promise(resolve => { release = () => { hold = null; resolve() } }) }
  server = createRemoteHttpServer(config, controller, resolve('dist'), null)
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  server.prependListener('request', (req, res) => {
    if (req.url !== '/api/secure/request') return
    let count = 0; const write = res.write.bind(res), end = res.end.bind(res)
    res.write = (chunk, ...args) => { if (chunk) count += Buffer.byteLength(chunk); return write(chunk, ...args) }
    res.end = (chunk, ...args) => { if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) count += Buffer.byteLength(chunk); return end(chunk, ...args) }
    res.once('finish', () => { wireBytes += count })
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); config.publicOrigin = new URL(`http://127.0.0.1:${server.address().port}`)
  browser = await chromium.launch({ headless: true })
  const results = []
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 600 }]) {
    const context = await browser.newContext({ viewport }), page = await context.newPage(); page.setDefaultTimeout(90000)
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    const select = async name => {
      if (viewport.width < 800 && !(await page.locator('.thread-row').filter({ hasText: name }).isVisible())) await page.getByRole('button', { name: 'Open conversations', exact: true }).click()
      await page.locator('.thread-row').filter({ hasText: name }).click()
    }
    const unlock = async () => { await page.getByLabel('Khóa mã hóa riêng', { exact: true }).fill(key.key); await page.getByRole('button', { name: 'Mở khóa', exact: true }).click() }
    const transcript = page.getByLabel('Conversation transcript', { exact: true }), composer = page.locator('#instruction')
    await page.goto(config.publicOrigin.origin)
    await page.getByRole('button', { name: 'Đăng nhập lại', exact: true }).click()
    await page.getByLabel('Mật khẩu đăng nhập', { exact: true }).fill(config.password)
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    const started = Date.now(), callStart = calls.length; wireBytes = nativeBytes = bodyBytes = 0
    await unlock(); await select('History window fixture'); await page.getByText('Question 499', { exact: true }).waitFor()
    assert.equal(await page.locator('.conversation-stream article.message').count(), 20)
    const beforeDenied = calls.length
    const denied = await context.request.get(config.publicOrigin.origin + '/api/threads/window/history')
    assert.equal(denied.ok(), false, 'Cookie alone cannot read history')
    assert.equal(calls.length, beforeDenied)
    const initial = { ms: Date.now() - started, nativeCalls: calls.length - callStart, nativeBytes, wireBytes, indexedResponseBytes: bodyBytes, dom: await page.locator('.conversation-stream').evaluate(el => el.querySelectorAll('*').length), rss: process.memoryUsage().rss }
    await composer.fill('Keep draft while paging')
    await transcript.evaluate(el => { el.scrollTop = 0 })
    const anchor = await page.locator('[data-history-anchor]').first().evaluate(el => ({ id: el.dataset.historyAnchor, y: el.getBoundingClientRect().top }))
    await transcript.hover(); await page.mouse.wheel(0, -20)
    await page.getByText('Question 480', { exact: true }).waitFor()
    assert.equal(await page.locator('.conversation-stream article.message').count(), 40)
    const anchored = await page.locator('[data-history-anchor]').evaluateAll((els, id) => els.find(el => el.dataset.historyAnchor === id)?.getBoundingClientRect().top, anchor.id)
    assert(Math.abs(anchored - anchor.y) < 50, 'prepend preserves old visible row')
    assert.equal(await composer.inputValue(), 'Keep draft while paging')
    const pageCount = pages; await page.waitForTimeout(350); assert.equal(pages, pageCount, 'No automatic older-page drain')
    await select('Other fixture'); await page.getByText('Other cached answer', { exact: true }).waitFor()
    await context.setOffline(true); await select('History window fixture')
    await page.getByText('Question 499', { exact: true }).waitFor()
    await transcript.evaluate(el => { el.scrollTop = 0 })
    await page.getByRole('button', { name: 'Tải tin nhắn cũ hơn', exact: true }).click()
    await page.getByText('Question 480', { exact: true }).waitFor()
    await context.setOffline(false)
    // Warm reload blocks EVERY history response. Only encrypted device cache can paint.
    blockHistory(); await page.reload(); await unlock()
    await page.getByText('Question 499', { exact: true }).waitFor({ timeout: 10000 })
    release(); await page.waitForTimeout(500)
    const noChangeStart = calls.length, noChangeBytes = wireBytes
    await select('Other fixture'); await select('History window fixture')
    await page.getByText('Question 499', { exact: true }).waitFor(); await page.waitForTimeout(500)
    const warm = { nativeCalls: calls.length - noChangeStart, wireBytes: wireBytes - noChangeBytes }
    assert(warm.wireBytes < initial.wireBytes, 'Unchanged revalidation does not retransmit the initial history body')
    // Append while closed, reconnect catches only new source suffix and a bounded window.
    await select('Other fixture'); version++
    const fresh = `Appended ${viewport.width}`
    await appendFile(sourcePath, item(`append-${version}`, 'agentMessage', fresh))
    await select('History window fixture'); await page.getByText(fresh, { exact: true }).waitFor()
    await transcript.evaluate(el => { el.scrollTop = 0 }); await page.getByRole('button', { name: 'Tải tin nhắn cũ hơn', exact: true }).click()
    const beforeLive = await transcript.evaluate(el => el.scrollTop)
    controller.events.publish('codex', { method: 'item/agentMessage/delta', params: { threadId: 'window', turnId: 'live-only', itemId: 'live', delta: 'Fresh live content must not move old reading' } })
    await page.waitForTimeout(200); assert(Math.abs(await transcript.evaluate(el => el.scrollTop) - beforeLive) < 50)
    // Plan is a real pending request from a fake native source; never start a turn.
    await composer.fill('Plan draft preserved')
    app.emit('serverRequest', { id: `plan-${viewport.width}`, method: 'item/tool/requestUserInput', params: { threadId: 'window', turnId: 'fake-plan', itemId: 'q', questions: [{ id: 'q', question: 'History Plan fixture?', options: [{ label: 'Keep', description: 'Preserve current window' }, { label: 'Other', description: 'Alternative' }] }] } })
    const panel = page.locator('.plan-question'); await panel.waitFor()
    const rect = await panel.boundingBox(); assert(rect.y >= 0 && rect.y + rect.height <= viewport.height)
    await panel.getByRole('radio', { name: 'Keep', exact: true }).click(); await panel.getByRole('button', { name: 'Send', exact: true }).click(); await panel.waitFor({ state: 'detached' })
    assert.equal(await composer.inputValue(), 'Plan draft preserved')
    // Delayed old-conversation read may neither overwrite another convo nor cross Lock.
    blockHistory(); await select('Other fixture'); await select('History window fixture'); await select('Other fixture'); release()
    await page.getByText('Other cached answer', { exact: true }).waitFor(); await page.waitForTimeout(300)
    assert.equal(await page.getByText(fresh, { exact: true }).count(), 0)
    blockHistory(); await select('History window fixture')
    if (viewport.width < 800) await page.getByRole('button', { name: 'Open conversations', exact: true }).click()
    await page.getByRole('button', { name: 'App menu', exact: true }).click(); await page.getByRole('button', { name: 'Lock app', exact: true }).click()
    release(); await page.getByLabel('Khóa mã hóa riêng', { exact: true }).waitFor()
    assert.equal(await page.locator('.conversation-stream').count(), 0)
    await unlock(); await select('History window fixture'); await page.getByText(fresh, { exact: true }).waitFor()
    // Device cache must not place fixture conversation strings in plaintext localStorage.
    assert.equal(await page.evaluate(() => Object.values(localStorage).some(v => /Question 499|Other cached answer/.test(v))), false)
    assert.deepEqual(errors, [])
    if (process.env.HISTORY_SCREENSHOTS) { await mkdir(process.env.HISTORY_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: join(process.env.HISTORY_SCREENSHOTS, `history-${viewport.width}.png`) }) }
    results.push({ viewport, initial, warm, offlineOlder: true, blockedNetworkWarmPaint: true, scrollAnchor: true, appendedWhileClosed: true, planDraft: true, lockSwitch: true })
    await context.close()
  }
  assert(!calls.some(c => c.method === 'turn/start' || c.method === 'thread/items/list' || c.includeTurns === true))
  assert.equal(replies.length, 2)
  console.log(JSON.stringify({ sourceBytes: (await stat(sourcePath)).size, results, nativeMethods: [...new Set(calls.map(c => c.method))], limits: 'Synthetic ~197 MB whole transcript; separate unit fixture tests 16 MiB single item. No production/native model turn.' }, null, 2))
} finally {
  release(); for (const socket of sockets) socket.destroy()
  await browser?.close()
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await rm(root, { recursive: true, force: true })
}
