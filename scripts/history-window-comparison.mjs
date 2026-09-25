// Run each mode as a separate process via codex-heavy. Identical fake ~7MB input;
// immutable previously built baseline, no production server/keys/native turns.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm, cp, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { once } from 'node:events'
const mode = process.argv[2]
assert(['baseline', 'window'].includes(mode))
const baseline = mode === 'baseline' ? await mkdtemp(join(tmpdir(), 'history-baseline-code-')) : null
if (baseline) {
  // Isolated copy of published CODE only; no .env, runtime state, native home,
  // credentials or maintenance scripts. Never mutate the publication tree.
  const runtime = '/root/RUNNING-SERVICES/codex-remote-secure'
  await cp(join(runtime, 'dist-server'), join(baseline, 'dist-server'), { recursive: true })
  await cp(join(runtime, 'dist'), join(baseline, 'dist'), { recursive: true })
  await cp(join(runtime, 'package.json'), join(baseline, 'package.json'))
  await symlink(resolve('node_modules'), join(baseline, 'node_modules'))
}
const base = baseline ?? resolve('.')
const module = p => import(pathToFileURL(join(base, 'dist-server', p)).href)
const { createRemoteHttpServer } = await module('http-app.js')
const { RemoteController } = await module('controller.js')
const { CodexAppServer } = await module('codex-app-server.js')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/tmp/working-hours-browser/node_modules/playwright/index.mjs')
const root = await mkdtemp(join(tmpdir(), 'history-compare-')), files = join(root, 'files'), sessions = join(root, 'native', 'sessions'), path = join(sessions, 'fixture.jsonl')
const text = 'Representative plain prose without a model call. '.repeat(1300)
const source = { id: 'large-thread', name: 'Large fake history', cwd: files, path, historyMode: 'paginated', status: { type: 'idle' }, createdAt: 1, updatedAt: 2,
 turns: Array.from({ length: 110 }, (_, n) => ({ id: `turn-${n}`, status: 'completed', items: [
  { id: `user-${n}`, type: 'userMessage', content: [{ type: 'text', text: `Question ${n}` }] },
  { id: `tool-${n}`, type: 'commandExecution', command: 'fixture-only', status: 'completed', aggregatedOutput: 'Fake tool result' },
  { id: `answer-${n}`, type: 'agentMessage', phase: 'final_answer', text: `${text}\n\nEND-${n}` },
 ] })) }
const serialized = JSON.stringify(source), { turns: _turns, ...metadata } = source
let browser, server
const sockets = new Set(), calls = []
let fullReads = 0, nativeBytes = 0, wireBytes = 0
try {
 await mkdir(files); await mkdir(sessions, { recursive: true })
 const rows = [{ type: 'session_meta', payload: { id: source.id, cwd: files, history_mode: 'paginated', history_base: null, subagent_history_start_ordinal: null } }]
 for (const turn of source.turns) {
  rows.push({ type: 'event_msg', payload: { type: 'task_started', turn_id: turn.id } })
  for (const item of turn.items) {
   const canonical = { ...item, type: item.type[0].toUpperCase() + item.type.slice(1) }
   if (item.type === 'agentMessage') { canonical.content = [{ type: 'Text', text: item.text }]; delete canonical.text }
   rows.push({ type: 'event_msg', payload: { type: 'item_completed', thread_id: source.id, turn_id: turn.id, item: canonical, completed_at_ms: 1 } })
  }
  rows.push({ type: 'event_msg', payload: { type: 'task_complete', turn_id: turn.id } })
 }
 await writeFile(path, rows.map((r, ordinal) => JSON.stringify({ ...r, ordinal })).join('\n') + '\n')
 const key = { version: 1, app: randomBytes(24).toString('base64url'), generation: randomBytes(24).toString('base64url'), key: randomBytes(32).toString('base64url') }
 const keyFile = join(root, 'key.json'); await writeFile(keyFile, JSON.stringify(key), { mode: 0o600 })
 const config = { host: '127.0.0.1', port: 0, publicOrigin: new URL('http://127.0.0.1'), password: 'FAKE comparison password', sessionSecret: 'FAKE-COMPARE'.repeat(5), sessionTtlSeconds: 600, codexBin: 'UNUSED', production: true, workspaceRoots: [files], fileRoots: [files], secureApiRequired: true, secureKeyFile: keyFile, sessionStateFile: join(root, 'session.json'), historyNativeHome: join(root, 'native'), historyIndexPath: join(root, 'index') }
 const app = new CodexAppServer('UNUSED')
 app.request = async (method, p = {}) => {
  calls.push(method); let result
  if (method === 'thread/list') result = { data: [{ ...metadata, turns: [] }], nextCursor: null }
  else if (method === 'thread/read' && p.includeTurns) { fullReads++; result = { thread: JSON.parse(serialized) } }
  else if (method === 'thread/read' || method === 'thread/resume') result = { thread: { ...metadata, turns: [] } }
  else if (method === 'thread/turns/list') { assert.equal(p.itemsView, 'notLoaded'); result = { data: [{ id: 'turn-109', status: 'completed', items: [] }], nextCursor: null } }
  else if (method === 'model/list') result = { data: [] }
  else if (method === 'account/rateLimits/read') result = { rateLimits: {} }
  else throw Error('Unexpected fake method: ' + method)
  nativeBytes += Buffer.byteLength(JSON.stringify(result)); return result
 }
 const controller = new RemoteController(config, app)
 server = createRemoteHttpServer(config, controller, join(base, 'dist'), null)
 server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
 server.prependListener('request', (req, res) => {
  if (req.url !== '/api/secure/request') return
  let bytes = 0; const write = res.write.bind(res), end = res.end.bind(res)
  res.write = (chunk, ...args) => { if (chunk) bytes += Buffer.byteLength(chunk); return write(chunk, ...args) }
  res.end = (chunk, ...args) => { if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) bytes += Buffer.byteLength(chunk); return end(chunk, ...args) }
  res.once('finish', () => { wireBytes += bytes })
 })
 server.listen(0, '127.0.0.1'); await once(server, 'listening'); config.publicOrigin = new URL(`http://127.0.0.1:${server.address().port}`)
 browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(60000)
 await page.goto(config.publicOrigin.origin); await page.getByRole('button', { name: 'Đăng nhập lại', exact: true }).click()
 await page.getByLabel('Mật khẩu đăng nhập', { exact: true }).fill(config.password); await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
 await page.getByLabel('Khóa mã hóa riêng', { exact: true }).fill(key.key)
 calls.length = 0; fullReads = nativeBytes = wireBytes = 0; const started = performance.now()
 await page.getByRole('button', { name: 'Mở khóa', exact: true }).click(); await page.locator('.thread-row').filter({ hasText: source.name }).click()
 await page.getByText('Question 109', { exact: true }).waitFor(); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
 const metrics = { mode, sourceBytes: Buffer.byteLength(serialized), ms: Math.round(performance.now() - started), nativeCalls: calls.length, nativeFullReads: fullReads, nativeResponseBytes: nativeBytes, encryptedBodyBytes: wireBytes,
  dom: await page.locator('.conversation-stream').evaluate(el => el.querySelectorAll('*').length), messages: await page.locator('.conversation-stream article.message').count(), rss: process.memoryUsage().rss, peakRss: process.resourceUsage().maxRSS * 1024,
  rendererHeap: await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null), index: controller.historyPages?.source?.metrics ?? null }
 if (mode === 'window') { assert.equal(fullReads, 0); assert.equal(metrics.messages, 20) }
 assert(!calls.includes('turn/start'))
 console.log(JSON.stringify(metrics))
} finally {
 await browser?.close(); for (const socket of sockets) socket.destroy()
 if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
 await rm(root, { recursive: true, force: true })
 if (baseline) await rm(baseline, { recursive: true, force: true })
}
