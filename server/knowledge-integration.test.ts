import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContextVault } from './context-vault.js'
import { CodexAppServer } from './codex-app-server.js'
import { RemoteController } from './controller.js'
import { createRemoteHttpServer } from './http-app.js'
import { createSession, sessionCookieName } from './auth.js'
import type { RemoteConfig } from './config.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'knowledge-http-'))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  const config: RemoteConfig = { host: '127.0.0.1', port: 5173, publicOrigin: new URL('http://127.0.0.1:5173'), password: 'example-password', sessionSecret: 's'.repeat(48), sessionTtlSeconds: 600, codexBin: 'unused', workspaceRoots: ['/tmp'], production: true }
  const app = new CodexAppServer('unused')
  vi.spyOn(app, 'request').mockImplementation(async method => method === 'turn/start' ? { turn: { id: 'turn', status: 'inProgress' } } : { thread: { id: 'chat', cwd: '/tmp' } })
  const vault = new ContextVault(root), controller = new RemoteController(config, app, vault)
  const server = createRemoteHttpServer(config, controller, root, null)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }))
  const address = server.address() as { port: number }, base = `http://127.0.0.1:${address.port}`
  config.publicOrigin = new URL(base)
  const session = createSession(config.sessionSecret, 600, config.password)
  const send = (path: string, method = 'GET', body?: object, headers = {}) => fetch(base + path, { method, headers: { Host: config.publicOrigin.host, Cookie: `${sessionCookieName(config.publicOrigin.protocol === 'https:')}=${session.token}`, Origin: config.publicOrigin.origin, 'X-CSRF-Token': session.payload.csrf, 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { send, vault, controller, base }
}

it('authenticates reads, protects writes and supports revision conflicts, diff and restore', async () => {
  const { send, base } = await setup()
  expect((await fetch(base + '/api/knowledge')).status).toBe(401)
  const path = 'Projects/Example.md', body = { path, content: '# First\n\nDecision one', revision: '' }
  expect((await send('/api/knowledge/note', 'PUT', body, { 'X-CSRF-Token': '' })).status).toBe(403)
  expect((await send('/api/knowledge/note', 'PUT', body, { Origin: 'https://untrusted.example' })).status).toBe(403)
  const first = await (await send('/api/knowledge/note', 'PUT', body)).json()
  const second = await (await send('/api/knowledge/note', 'PUT', { ...body, revision: first.revision, content: '# Second' })).json()
  expect((await send('/api/knowledge/note', 'PUT', { ...body, revision: first.revision })).status).toBe(409)
  const { versions } = await (await send('/api/knowledge/versions?path=' + path)).json()
  const version = await (await send('/api/knowledge/version?path=' + path + '&id=' + versions[1].id)).json()
  expect(version.diff).toMatchObject({ changed: true, before: '# First\n\nDecision one', after: '# Second' })
  const restored = await (await send('/api/knowledge/restore', 'POST', { path, revision: second.revision, versionId: versions[1].id })).json()
  expect(restored.content).toBe(body.content)
  expect((await send('/api/knowledge/note?path=../secret.md')).status).toBe(400)
  expect((await send('/api/knowledge/note', 'PUT', { ...body, path: 'Index.md' })).status).toBe(400)
}, 20_000)

it('records exactly the selected snippets on a turn and previews without adding a used-context record', async () => {
  const { send, vault, controller } = await setup()
  vault.knowledge.save('Projects/POS.md', '---\nstatus: confirmed\nscope: global\n---\n# POS\n\nUse preview for POS review.', '')
  await controller.startTurn('chat', 'POS review')
  const { traces } = await (await send('/api/knowledge/traces?threadId=chat')).json()
  expect(traces).toHaveLength(1)
  const trace = await (await send('/api/knowledge/traces?id=' + traces[0].id)).json()
  expect(trace.snippets.some((snippet: { path: string }) => snippet.path === 'Projects/POS.md')).toBe(true)
  expect(trace.usedBytes).toBeLessThanOrEqual(24000)
  expect((await send('/api/knowledge/preview', 'POST', { threadId: 'chat', text: 'POS review' })).status).toBe(200)
  expect(vault.knowledge.traces()).toHaveLength(1)
}, 20_000)
