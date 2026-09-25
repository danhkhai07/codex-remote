// Isolated feasibility measurement only. No production/native transcript edits.
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { once } from 'node:events'
import { limitConversation } from '../dist-server/conversation-size.js'
import { createRemoteHttpServer } from '../dist-server/http-app.js'
import { RemoteController } from '../dist-server/controller.js'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
const { chromium } = await import('/tmp/working-hours-browser/node_modules/playwright/index.mjs')
const bytes = value => Buffer.byteLength(JSON.stringify(value))
const root = await mkdtemp(join(tmpdir(), 'history-size-probe-'))
const files = join(root, 'files')
const text = 'Representative plain prose without a model call. '.repeat(1300)
const source = { id: 'large-thread', name: 'Large fake history', cwd: files, status: { type: 'idle' }, createdAt: 1, updatedAt: 2,
  turns: Array.from({ length: 110 }, (_, i) => ({ id: `turn-${i}`, status: 'completed', items: [
    { id: `user-${i}`, type: 'userMessage', content: [{ type: 'inputText', text: `Question ${i}` }] },
    { id: `tool-${i}`, type: 'commandExecution', command: 'fixture-only', status: 'completed', aggregatedOutput: 'Fake tool result' },
    { id: `answer-${i}`, type: 'agentMessage', phase: 'final_answer', text: `${text}\n\nEND-${i}` },
  ] })) }
// Proposed conservative page projection: whole turns only, same item references.
// Oversized single turns must instead be retrieved by an explicit item-detail page;
// this prototype intentionally refuses to silently split or drop such a turn.
function wholeTurnPage(thread, budget = 2_500_000) {
  const selected = []
  for (let i = thread.turns.length - 1; i >= 0; i--) {
    const next = [thread.turns[i], ...selected]
    if (bytes({ ...thread, turns: next }) > budget) break
    selected.unshift(thread.turns[i])
  }
  if (!selected.length && thread.turns.length) throw Error('Oversized turn needs an explicit detail path')
  return { ...thread, turns: selected, historyCacheTruncated: selected.length < thread.turns.length, historyTruncation: 'head', latestTurn: { id: thread.turns.at(-1).id, status: thread.turns.at(-1).status } }
}
assert(bytes(source) > 5_000_000)
const serialized = JSON.stringify(source)
const originalHash = JSON.stringify(source)
const t = performance.now(); const current = limitConversation(JSON.parse(serialized)); const currentMs = performance.now() - t
const h = performance.now(); const half = wholeTurnPage(source); const halfMs = performance.now() - h
assert(bytes(half) < 2_500_000)
assert.deepEqual(half.turns, source.turns.slice(-half.turns.length))
const older = source.turns.slice(0, -half.turns.length)
assert.deepEqual([...older, ...half.turns], source.turns)
assert.equal(JSON.stringify(source), originalHash)
assert.throws(() => wholeTurnPage({ ...source, turns: [{ ...source.turns[0], items: [{ text: 'x'.repeat(3_000_000) }] }] }), /Oversized/)
let browser, server
const sockets = new Set()
try {
  await mkdir(files)
  const key = { version: 1, app: randomBytes(24).toString('base64url'), generation: randomBytes(24).toString('base64url'), key: randomBytes(32).toString('base64url') }
  const keyFile = join(root, 'key.json'); await writeFile(keyFile, JSON.stringify(key), { mode: 0o600 })
  const config = { host: '127.0.0.1', port: 0, publicOrigin: new URL('http://127.0.0.1'), password: 'FAKE history probe password', sessionSecret: 'fake-history-secret'.repeat(4), sessionTtlSeconds: 600, codexBin: 'UNUSED', production: true, workspaceRoots: [files], fileRoots: [files], secureApiRequired: true, secureKeyFile: keyFile, sessionStateFile: join(root, 'sessions.json') }
  let mode = 'current', calls = [], nativeParseMs = 0, fullReads = 0, encryptedBytes = 0
  const app = new CodexAppServer('UNUSED')
  app.request = async (method, params = {}) => {
    calls.push(method)
    const { turns: _turns, ...metadata } = source
    if (method === 'thread/list') return { data: [{ ...metadata, turns: [] }], nextCursor: null }
    if (method === 'thread/read' && params.includeTurns) {
      fullReads++; const start = performance.now(); const thread = JSON.parse(serialized); nativeParseMs += performance.now() - start
      return { thread }
    }
    if (method === 'thread/read' || method === 'thread/resume') return { thread: { ...metadata, turns: [] } }
    if (method === 'model/list') return { data: [] }
    if (method === 'account/rateLimits/read') return { rateLimits: {} }
    throw Error(`Unexpected fake RPC ${method}`)
  }
  const controller = new RemoteController(config, app)
  const originalRead = controller.readThread.bind(controller)
  controller.readThread = async (...args) => {
    const result = await originalRead(...args)
    return mode === 'half' ? { ...result, thread: wholeTurnPage(result.thread) } : result
  }
  server = createRemoteHttpServer(config, controller, resolve('dist'), null)
  server.prependListener('request', (req, res) => {
    if (req.url !== '/api/secure/request') return
    let count = 0
    const write = res.write.bind(res), end = res.end.bind(res)
    res.write = (chunk, ...args) => { if (chunk) count += Buffer.byteLength(chunk); return write(chunk, ...args) }
    res.end = (chunk, ...args) => { if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) count += Buffer.byteLength(chunk); return end(chunk, ...args) }
    res.once('finish', () => { encryptedBytes += count })
  })
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  config.port = server.address().port; config.publicOrigin = new URL(`http://127.0.0.1:${config.port}`)
  browser = await chromium.launch({ headless: true })
  const results = []
  for (mode of ['current', 'half']) {
    calls = []; nativeParseMs = 0; fullReads = 0; encryptedBytes = 0
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage(); page.setDefaultTimeout(20_000)
    console.error('Probe', mode, 'login')
    await page.goto(config.publicOrigin.origin)
    await page.getByRole('button', { name: 'Đăng nhập lại', exact: true }).click()
    await page.getByLabel('Mật khẩu đăng nhập', { exact: true }).fill(config.password)
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    await page.getByLabel('Khóa mã hóa riêng', { exact: true }).fill(key.key)
    const start = performance.now()
    await page.getByRole('button', { name: 'Mở khóa', exact: true }).click()
    console.error('Probe', mode, 'select thread')
    try { await page.locator('.thread-row').filter({ hasText: 'Large fake history' }).click() } catch (error) { console.error((await page.locator('body').innerText()).slice(0, 1800), calls); throw error }
    await page.getByText('END-109', { exact: true }).waitFor()
    const renderedMs = performance.now() - start
    const dom = await page.locator('.conversation-stream').evaluate(el => ({ elements: el.querySelectorAll('*').length, textChars: el.textContent.length }))
    assert(!calls.some(m => ['turn/start', 'thread/start', 'turn/interrupt'].includes(m)))
    results.push({ mode, unlockToLatestRenderedMs: Math.round(renderedMs), fakeNativeJsonParseMs: Math.round(nativeParseMs), nativeFullReadCalls: fullReads, nativeAllReadCalls: calls.filter(m => m === 'thread/read').length, encryptedResponseBodyBytes: encryptedBytes, ...dom })
    await context.close()
  }
  console.log(JSON.stringify({ sourceBytes: bytes(source), currentBytes: bytes(current), proposedBytes: bytes(half), currentTurns: current.turns.length, proposedTurns: half.turns.length, currentParseAndLimitMs: Math.round(currentMs), proposedProjectionMs: Math.round(halfMs), originalUnchanged: true, olderReconstructionExact: true, results, limitations: 'Single fake local run; native disk/model cost unmeasured. Whole-turn prototype only, no API pagination or live feature. Wire counts completed startup encrypted responses, excluding open SSE; timing includes auth and render.' }, null, 2))
} catch (error) { console.error(error); throw error
} finally {
  for (const socket of sockets) socket.destroy()
  await browser?.close()
  if (server) { for (const socket of sockets) socket.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await rm(root, { recursive: true, force: true })
}
