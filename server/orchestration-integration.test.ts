import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it, vi } from 'vitest'
import { CodexAppServer } from './codex-app-server.js'
import { ContextVault } from './context-vault.js'
import { RemoteController } from './controller.js'
import { createRemoteHttpServer } from './http-app.js'
import { createSession } from './auth.js'
import type { RemoteConfig } from './config.js'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'orch-integration-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const config: RemoteConfig = { host: '127.0.0.1', port: 5173, publicOrigin: new URL('https://remote.example.test'),
    password: 'test-password-long-enough', sessionSecret: 's'.repeat(48), sessionTtlSeconds: 600,
    codexBin: 'unused', workspaceRoots: [root], production: true }
  const vault = new ContextVault(join(root, 'vault')), group = vault.createGroup('Project').groups[0]
  for (const id of ['leader', 'worker', 'second']) vault.assignThread(id, group.id)
  const app = new CodexAppServer('unused')
  let sequence = 0
  const rpc = vi.spyOn(app, 'request').mockImplementation(async (method, input) => {
    const params = input as Record<string, unknown>
    if (['thread/read', 'thread/resume'].includes(method)) return { thread: { id: params.threadId, cwd: root, status: { type: 'idle' }, turns: [] } }
    if (method === 'turn/start') return { turn: { id: `turn-${++sequence}`, status: 'inProgress' } }
    return {}
  })
  const controller = new RemoteController(config, app, vault)
  cleanups.push(() => controller.stop())
  return { root, config, vault, group, app, rpc, controller }
}

it('keeps leader changes and team controls behind session, CSRF and group checks', async () => {
  const f = setup(), server = createRemoteHttpServer(f.config, f.controller, f.root, null)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())))
  const session = createSession(f.config.sessionSecret, 600)
  const call = (path: string, body?: unknown, auth = true, csrf = session.payload.csrf) => new Promise<{ status: number; data: Record<string, unknown> }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: (server.address() as AddressInfo).port, path,
      method: body === undefined ? 'GET' : path.endsWith('/leader') ? 'PUT' : 'POST', headers: {
        Host: 'remote.example.test', Origin: f.config.publicOrigin.origin, 'Content-Type': 'application/json',
        ...(auth ? { Cookie: `codex_remote_session=${session.token}`, 'X-CSRF-Token': csrf } : {}),
      } }, res => {
      let data = ''; res.on('data', chunk => { data += chunk }); res.on('end', () => resolve({ status: res.statusCode!, data: JSON.parse(data) }))
    }); req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body))
  })
  const path = `/api/conversation-groups/${f.group.id}/leader`
  expect((await call(path, { threadId: 'leader' }, false)).status).toBe(401)
  expect((await call(path, { threadId: 'leader' }, true, 'wrong')).status).toBe(403)
  expect((await call(path, { threadId: 'outsider' })).status).toBe(400)
  expect((await call(path, { threadId: 'leader' })).status).toBe(200)
  expect((await call('/api/threads/worker/orchestration')).data).toMatchObject({ leaderId: 'leader', members: ['leader', 'worker', 'second'] })
  expect((await call('/api/threads/worker/orchestration', { action: 'spawn' })).status).toBe(400)
  expect((await call('/api/threads/worker/orchestration', { action: 'release' }, true, 'wrong')).status).toBe(403)
  expect((await call(path, { threadId: 'second' })).status).toBe(200)
  expect(f.vault.snapshot().groups[0].leaderThreadId).toBe('second')
  expect((await call(path, { threadId: null })).status).toBe(200)
})

it('injects private leader commands on existing threads, enforces worker roles and serializes actual turn starts', async () => {
  const f = setup()
  f.vault.setLeader(f.group.id, 'leader')
  await f.controller.startTurn('leader', 'Delegate a bounded task')
  const injections = () => f.rpc.mock.calls.filter(([method]) => method === 'thread/inject_items').map(([, input]) => JSON.stringify(input))
  const leaderContext = injections().at(-1)!
  expect(leaderContext).toContain('You are the leader')
  expect(leaderContext).toContain('scripts/conversations.mjs')
  const token = leaderContext.match(/--capability ([\w-]+)/)![1]
  await expect(f.controller.startTurn('leader', 'Duplicate send')).rejects.toMatchObject({ status: 409 })
  await f.controller.startTurn('worker', 'Direct question')
  expect(injections().at(-1)).toContain('You are a worker')
  expect(injections().at(-1)).not.toContain('--capability')
  const trace = JSON.stringify(f.vault.knowledge.traces())
  expect(trace).not.toContain(token)
  f.vault.setLeader(f.group.id, 'second')
  await expect(f.controller.orchestration!.command(token, { action: 'status' })).rejects.toMatchObject({ status: 403 })
  f.app.emit('notification', { method: 'turn/completed', params: { threadId: 'leader', turn: { id: 'turn-1', status: 'completed' } } })
  await f.controller.startTurn('leader', 'Continue as worker')
  expect(injections().at(-1)).toContain('You are a worker')
})

it('checks delegation authority after context preparation and before sending to Codex', async () => {
  const f = setup()
  let authorized = true
  f.rpc.mockImplementation(async (method, input) => {
    const params = input as Record<string, unknown>
    if (['thread/read', 'thread/resume'].includes(method)) return { thread: { id: params.threadId, cwd: f.root, turns: [] } }
    if (method === 'thread/inject_items') { authorized = false; return {} }
    if (method === 'turn/start') throw Error('Must not dispatch')
    return {}
  })
  const guard = () => { if (!authorized) throw Error('Role changed') }
  await expect(f.controller.startTurn('worker', 'Delegated', undefined, undefined, false, [], [], undefined, undefined, guard)).rejects.toThrow('Role changed')
  expect(f.rpc.mock.calls.some(([method]) => method === 'turn/start')).toBe(false)
})

it('inherits Plan mode for workers and result wakeups, including native plan-only answers', async () => {
  const f = setup(), original = f.rpc.getMockImplementation()!
  f.rpc.mockImplementation((method, params, timeout) => method === 'model/list' ? Promise.resolve({ data: [{
    id: 'test-model', model: 'test-model', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'high' }],
  }] }) : original(method, params, timeout))
  f.vault.setLeader(f.group.id, 'leader')
  await f.controller.startTurn('leader', 'Research the feature and return a plan', 'test-model', 'high', false, [], [], undefined, 'plan')
  const context = JSON.stringify(f.rpc.mock.calls.filter(([method]) => method === 'thread/inject_items').at(-1)![1])
  const token = context.match(/--capability ([\w-]+)/)![1]
  const { task } = await f.controller.orchestration!.command(token, { action: 'delegate', requestId: 'plan-task', threadId: 'worker', title: 'Research', text: 'Inspect and propose a plan only' }) as { task: { turnId: string } }
  await f.controller.orchestration!.start(); await f.controller.orchestration!.pump()
  const starts = () => f.rpc.mock.calls.filter(([method]) => method === 'turn/start').map(([, params]) => params)
  expect(starts().at(-1)).toMatchObject({ threadId: 'worker', collaborationMode: { mode: 'plan' } })
  f.app.emit('notification', { method: 'item/completed', params: { threadId: 'worker', turnId: task.turnId, item: { id: 'plan', type: 'plan', text: 'A verified plan, without code changes.' } } })
  f.app.emit('notification', { method: 'turn/completed', params: { threadId: 'worker', turn: { id: task.turnId, status: 'completed' } } })
  await f.controller.orchestration!.pump()
  expect(f.controller.orchestration!.snapshot('leader').tasks[0].result).toContain('A verified plan')
  f.app.emit('notification', { method: 'turn/completed', params: { threadId: 'leader', turn: { id: 'turn-1', status: 'completed' } } })
  await f.controller.orchestration!.pump()
  expect(starts().at(-1)).toMatchObject({ threadId: 'leader', collaborationMode: { mode: 'plan' }, input: [{ text: expect.stringContaining('A verified plan') }] })
})
