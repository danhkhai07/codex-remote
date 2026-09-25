// Run only through codex-heavy after building this worktree. Fake native/key/files.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
import { RemoteController } from '../dist-server/controller.js'
import { createRemoteHttpServer } from '../dist-server/http-app.js'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/tmp/working-hours-browser/node_modules/playwright/index.mjs')
const root = await mkdtemp(join(tmpdir(), 'history-window-')), files = join(root, 'files'), sockets = new Set()
let browser, server
try {
  await mkdir(files)
  const sourcePath = join(files, 'fake-rollout.jsonl'); await writeFile(sourcePath, 'FAKE version 1')
  const key = { version: 1, app: randomBytes(24).toString('base64url'), generation: randomBytes(24).toString('base64url'), key: randomBytes(32).toString('base64url') }
  const keyFile = join(root, 'owner.json'); await writeFile(keyFile, JSON.stringify(key), { mode: 0o600 })
  const config = { host: '127.0.0.1', port: 0, publicOrigin: new URL('http://127.0.0.1'), password: 'FAKE window browser password', sessionSecret: 'fake-window'.repeat(6), sessionTtlSeconds: 600, codexBin: 'unused', production: true, workspaceRoots: [files], fileRoots: [files], secureApiRequired: true, secureKeyFile: keyFile, sessionStateFile: join(root, 'sessions.json') }
  // 197 MB logical history in many old tool items. RPC constructs only requested
  // item; this does NOT prove the giant-single-item native transport case.
  const logicalToolBytes = 197_000_000, toolCount = 1000, eachTool = Math.ceil(logicalToolBytes / toolCount)
  const turns = Array.from({ length: 500 }, (_, n) => ({ id: `t${n}`, status: 'completed', items: [
    { id: `u${n}`, type: 'userMessage', content: [{ type: 'inputText', text: `Question ${n}` }] },
    ...Array.from({ length: 2 }, (_, k) => ({ id: `tool${n}-${k}`, type: 'commandExecution', command: 'fixture', status: 'completed', aggregatedOutput: n < 470 ? null : 'Small recent result', lazy: n < 470 })),
    { id: `a${n}`, type: 'agentMessage', phase: 'final_answer', text: `Answer ${n}\n\n${'Readable content. '.repeat(15)}` },
  ] }))
  const metadata = id => ({ id, name: id === 'window' ? 'History window fixture' : 'Other fixture', cwd: files, path: sourcePath, status: { type: 'idle' }, createdAt: 1, updatedAt: turns.length })
  const calls = [], app = new CodexAppServer('UNUSED')
  let nativeBytes = 0, wireBytes = 0
  app.request = async (method, p = {}) => {
    calls.push(method)
    if (method === 'thread/list') return { data: [metadata('window'), metadata('other')], nextCursor: null }
    if (method === 'thread/read') { assert(!p.includeTurns, 'Full history RPC is forbidden'); return { thread: metadata(p.threadId) } }
    if (method === 'thread/resume') return { thread: metadata(p.threadId) }
    if (method === 'thread/turns/list') {
      assert.equal(p.itemsView, 'notLoaded'); const i = p.cursor ? Number(p.cursor.slice(1)) : turns.length - 1
      return { data: i >= 0 ? [{ ...turns[i], items: [] }] : [], nextCursor: i > 0 ? `t${i - 1}` : null }
    }
    if (method === 'thread/items/list') {
      const turn = turns.find(t => t.id === p.turnId), i = p.cursor ? Number(p.cursor.slice(1)) : turn.items.length - 1
      const item = { ...turn.items[i] }; if (item.lazy) item.aggregatedOutput = 'x'.repeat(eachTool)
      const result = { data: [{ turnId: turn.id, item }], nextCursor: i > 0 ? `i${i - 1}` : null }; nativeBytes += Buffer.byteLength(JSON.stringify(result)); return result
    }
    if (method === 'model/list') return { data: [] }
    if (method === 'account/rateLimits/read') return { rateLimits: {} }
    throw Error(`Unexpected fake RPC ${method}`)
  }
  const controller = new RemoteController(config, app)
  server = createRemoteHttpServer(config, controller, resolve('dist'), null)
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  server.prependListener('request', (_req, res) => {
    let count = 0; const write = res.write.bind(res), end = res.end.bind(res)
    res.write = (chunk, ...args) => { if (chunk) count += Buffer.byteLength(chunk); return write(chunk, ...args) }
    res.end = (chunk, ...args) => { if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) count += Buffer.byteLength(chunk); return end(chunk, ...args) }
    res.once('finish', () => { wireBytes += count })
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); config.publicOrigin = new URL(`http://127.0.0.1:${server.address().port}`)
  browser = await chromium.launch({ headless: true })
  const results = []
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport }), page = await context.newPage(); page.setDefaultTimeout(20_000)
    await page.goto(config.publicOrigin.origin)
    await page.getByRole('button', { name: 'Đăng nhập lại', exact: true }).click()
    await page.getByLabel('Mật khẩu đăng nhập', { exact: true }).fill(config.password)
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    await page.getByLabel('Khóa mã hóa riêng', { exact: true }).fill(key.key)
    await page.getByRole('button', { name: 'Mở khóa', exact: true }).click()
    if (viewport.width < 800) await page.getByRole('button', { name: 'Open conversations', exact: true }).click()
    const started = Date.now(); nativeBytes = 0; wireBytes = 0
    await page.locator('.thread-row').filter({ hasText: 'History window fixture' }).click()
    await page.getByText('Question 499', { exact: true }).waitFor()
    assert.equal(await page.locator('.conversation-stream article.message').count(), 20)
    const initial = { ms: Date.now() - started, nativeBytes, wireBytes, elements: await page.locator('.conversation-stream').evaluate(el => el.querySelectorAll('*').length) }
    const viewportEl = page.getByLabel('Conversation transcript', { exact: true })
    await viewportEl.evaluate(el => { el.scrollTop = 0 })
    await page.getByRole('button', { name: 'Tải tin nhắn cũ hơn', exact: true }).click()
    await page.getByText('Question 480', { exact: true }).waitFor()
    assert.equal(await page.locator('.conversation-stream article.message').count(), 40)
    const count = calls.length
    await page.waitForTimeout(300)
    assert(!calls.slice(count).includes('thread/items/list'), 'Does not drain history automatically')
    await context.setOffline(true)
    await page.getByRole('button', { name: /Jump to latest/ }).click()
    await page.getByText('Question 499', { exact: true }).waitFor()
    assert.equal(await page.locator('.conversation-stream article.message').count(), 20)
    await viewportEl.evaluate(el => { el.scrollTop = 0 })
    await page.getByRole('button', { name: 'Tải tin nhắn cũ hơn', exact: true }).click()
    await page.getByText('Question 480', { exact: true }).waitFor()
    await context.setOffline(false)
    results.push({ viewport, initial, olderFromCacheOffline: true, logicalOldToolBytes: logicalToolBytes })
    await context.close()
  }
  assert(!calls.includes('turn/start'))
  console.log(JSON.stringify({ results, nativeMethods: [...new Set(calls)], limits: 'Fake many-item 197 MB dataset; giant-single-item transport not proven; no production/native model turn.' }, null, 2))
} finally {
  for (const socket of sockets) socket.destroy()
  await browser?.close()
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await rm(root, { recursive: true, force: true })
}
