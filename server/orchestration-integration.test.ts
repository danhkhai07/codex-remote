import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
  const withoutLeader = { status: 200, data: { leaderId: null, members: ['leader', 'worker', 'second'],
    tasks: [], limits: { concurrent: 3, dispatchesLeft: 0, wakeupsLeft: 0 } } }
  expect(await call('/api/threads/worker/orchestration')).toMatchObject(withoutLeader)
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
  expect(await call('/api/threads/worker/orchestration')).toMatchObject(withoutLeader)
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

it('overrides worker model/effort in actual RPC while preserving Plan and leader wakeup settings', async () => {
  const f = setup(), original = f.rpc.getMockImplementation()!
  f.rpc.mockImplementation((method, params, timeout) => method === 'model/list' ? Promise.resolve({ data: [{
    id: 'gpt-6-astra', model: 'gpt-6-astra', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'high' }],
  }, { model: 'gpt-5.6-sol', supportedReasoningEfforts: [{ reasoningEffort: 'xhigh' }] }] }) : original(method, params, timeout))
  f.vault.setLeader(f.group.id, 'leader')
  await f.controller.startTurn('leader', 'Research the feature and return a plan', 'gpt-6-astra', 'high', false, [], [], undefined, 'plan')
  const context = JSON.stringify(f.rpc.mock.calls.filter(([method]) => method === 'thread/inject_items').at(-1)![1])
  const token = context.match(/--capability ([\w-]+)/)![1]
  const { task } = await f.controller.orchestration!.command(token, { action: 'delegate', requestId: 'plan-task', model: 'gpt-5.6-sol', effort: 'xhigh', fullAccess: true, mode: 'default', threadId: 'worker', title: 'Research', text: 'Inspect and propose a plan only' }) as { task: { turnId: string } }
  await f.controller.orchestration!.start(); await f.controller.orchestration!.pump()
  const starts = () => f.rpc.mock.calls.filter(([method]) => method === 'turn/start').map(([, params]) => params)
  expect(starts().at(-1)).toMatchObject({ threadId: 'worker', model: 'gpt-5.6-sol', effort: 'xhigh', sandboxPolicy: { type: 'workspaceWrite', networkAccess: false }, collaborationMode: { mode: 'plan', settings: { model: 'gpt-5.6-sol', reasoning_effort: 'xhigh' } } })
  f.app.emit('notification', { method: 'item/completed', params: { threadId: 'worker', turnId: task.turnId, item: { id: 'plan', type: 'plan', text: 'A verified plan, without code changes.' } } })
  f.app.emit('notification', { method: 'turn/completed', params: { threadId: 'worker', turn: { id: task.turnId, status: 'completed' } } })
  await f.controller.orchestration!.pump()
  expect(f.controller.orchestration!.snapshot('leader').tasks[0].result).toContain('A verified plan')
  f.app.emit('notification', { method: 'turn/completed', params: { threadId: 'leader', turn: { id: 'turn-1', status: 'completed' } } })
  await f.controller.orchestration!.pump()
  expect(starts().at(-1)).toMatchObject({ threadId: 'leader', model: 'gpt-6-astra', effort: 'high', collaborationMode: { mode: 'plan', settings: { model: 'gpt-6-astra', reasoning_effort: 'high' } }, input: [{ text: expect.stringContaining('A verified plan') }] })
})


it('renames through native RPC/events and archives without deleting vault context or source history', async () => {
  const f = setup(), names = new Map<string, string>()
  f.vault.setLeader(f.group.id, 'leader')
  const orchestra = f.controller.orchestration!, cap = orchestra.context('leader', { fullAccess: false }, true).match(/--capability ([\w-]+)/)![1]
  f.rpc.mockImplementation(async (method, input) => {
    const params = input as Record<string, unknown>
    if (method === 'thread/read') return { thread: { id: params.threadId, name: names.get(String(params.threadId)), cwd: f.root, status: { type: 'idle' },
      turns: [{ id: 'history', status: 'completed', items: [{ id: 'answer', type: 'agentMessage', text: 'Preserve this source history' }] }] } }
    if (method === 'thread/name/set') names.set(String(params.threadId), String(params.name))
    return {}
  })
  await f.controller.readThread('worker')
  const note = join(f.root, 'vault/Conversations/worker/Context.md')
  writeFileSync(note, '# Keep this context\nUseful knowledge survives archival.\n')
  const sources = join(f.root, 'vault/Conversations/worker/Turns')
  const before = readdirSync(sources).map(name => [name, readFileSync(join(sources, name), 'utf8')])
  const publish = vi.spyOn(f.controller.events, 'publish')
  await expect(orchestra.command(cap, { action: 'rename', threadId: 'worker', name: '  Worker QA  ' })).resolves.toMatchObject({ name: 'Worker QA' })
  expect(f.rpc).toHaveBeenCalledWith('thread/name/set', { threadId: 'worker', name: 'Worker QA' }, 10_000)
  expect(publish).toHaveBeenCalledWith('codex', { method: 'thread/name/updated', params: { threadId: 'worker', threadName: 'Worker QA' } })
  await expect(f.controller.readThread('worker')).resolves.toMatchObject({ thread: { name: 'Worker QA' } })
  await expect(orchestra.command(cap, { action: 'archive', threadId: 'worker', requestId: 'remove-worker' })).resolves.toMatchObject({ archived: true })
  expect(f.vault.groupFor('worker')).toBeNull()
  expect(publish).toHaveBeenCalledWith('codex', { method: 'thread/archived', params: { threadId: 'worker' } })
  expect(readFileSync(note, 'utf8')).toContain('Useful knowledge survives archival.')
  expect(readdirSync(sources).map(name => [name, readFileSync(join(sources, name), 'utf8')])).toEqual(before)
  expect(f.rpc.mock.calls.filter(([method]) => method === 'thread/archive')).toHaveLength(1)
  expect(f.rpc.mock.calls.some(([method]) => ['thread/resume', 'turn/start', 'turn/interrupt'].includes(method))).toBe(false)
})

it.each(['rename', 'archive'])('rechecks %s authority after metadata reads, before any mutating RPC', async action => {
  const f = setup()
  f.vault.setLeader(f.group.id, 'leader')
  const orchestra = f.controller.orchestration!, cap = orchestra.context('leader', { fullAccess: false }, true).match(/--capability ([\w-]+)/)![1]
  f.rpc.mockImplementation(async (method, input) => {
    if (method === 'thread/read') {
      f.vault.setLeader(f.group.id, 'second')
      return { thread: { id: (input as { threadId: string }).threadId, cwd: f.root, status: { type: 'idle' }, turns: [] } }
    }
    throw Error('Mutation must never dispatch')
  })
  await expect(orchestra.command(cap, { action, threadId: 'worker', name: 'No', requestId: 'no' })).rejects.toMatchObject({ status: 403 })
  expect(f.rpc.mock.calls.every(([method]) => method === 'thread/read')).toBe(true)
  expect(orchestra.snapshot('second').archives).toEqual([])
  f.vault.setLeader(f.group.id, 'leader')
  await expect(orchestra.command(cap, { action, threadId: 'worker', name: 'Still no', requestId: 'no' })).rejects.toMatchObject({ status: 403 })
})

it.each(['active', 'systemError', 'unknown', 'turn', 'pending', 'manual', 'move'])('rejects archive on fresh %s state without sending archive or interrupt', async scenario => {
  const f = setup()
  f.vault.setLeader(f.group.id, 'leader')
  const orchestra = f.controller.orchestration!, cap = orchestra.context('leader', { fullAccess: false }, true).match(/--capability ([\w-]+)/)![1]
  f.rpc.mockImplementation(async (method, input) => {
    if (method === 'thread/read') {
      if (scenario === 'pending') f.app.emit('serverRequest', { id: 'needs-answer', method: 'item/tool/requestUserInput', params: { threadId: 'worker' } })
      if (scenario === 'manual') orchestra.userStop('worker')
      if (scenario === 'move') f.vault.assignThread('worker', null)
      return { thread: { id: (input as { threadId: string }).threadId, cwd: f.root,
        status: { type: ['active', 'systemError', 'unknown'].includes(scenario) ? scenario : 'idle' },
        turns: scenario === 'turn' ? [{ id: 'running', status: 'inProgress' }] : [] } }
    }
    throw Error('No mutating RPC expected')
  })
  await expect(orchestra.command(cap, { action: 'archive', threadId: 'worker', requestId: scenario })).rejects.toMatchObject({ status: scenario === 'move' ? 403 : 409 })
  expect(f.rpc.mock.calls.every(([method]) => method === 'thread/read')).toBe(true)
  expect(orchestra.snapshot('leader').archives).toEqual([])
})

it.each(['role', 'move', 'manual'])('excludes new turns while archiving and flags a mid-RPC %s change without overwriting newer state', async scenario => {
  const f = setup(), original = f.rpc.getMockImplementation()!
  f.vault.setLeader(f.group.id, 'leader')
  const orchestra = f.controller.orchestration!, cap = orchestra.context('leader', { fullAccess: false }, true).match(/--capability ([\w-]+)/)![1]
  let release!: () => void, dispatched!: () => void
  const started = new Promise<void>(resolve => { dispatched = resolve }), waiting = new Promise<void>(resolve => { release = resolve })
  f.rpc.mockImplementation(async (method, params, timeout) => {
    if (method === 'thread/archive') { dispatched(); await waiting; return {} }
    return original(method, params, timeout)
  })
  const command = { action: 'archive', threadId: 'worker', requestId: 'race' }
  const operation = orchestra.command(cap, command), failure = expect(operation).rejects.toMatchObject({ status: scenario === 'manual' ? 409 : 403 })
  await started
  await expect(f.controller.startTurn('worker', 'Direct user message')).rejects.toMatchObject({ status: 409 })
  await expect(f.controller.renameThread('worker', 'User title')).rejects.toMatchObject({ status: 409 })
  if (scenario === 'move') f.vault.assignThread('worker', f.vault.createGroup('Other').groups.at(-1)!.id)
  if (scenario === 'role') f.vault.setLeader(f.group.id, 'second')
  if (scenario === 'manual') orchestra.userStop('worker')
  release(); await failure
  expect(f.vault.groupFor('worker')?.name).toBe(scenario === 'move' ? 'Other' : 'Project')
  expect(orchestra.snapshot('leader').archives[0].status).toBe('review')
  await expect(orchestra.command(cap, command)).rejects.toMatchObject({ status: scenario === 'role' ? 403 : 409 })
  expect(f.rpc.mock.calls.filter(([method]) => method === 'thread/archive')).toHaveLength(1)
  expect(f.rpc.mock.calls.some(([method]) => ['turn/start', 'turn/interrupt'].includes(method))).toBe(false)
})


it('renames the active leader itself without clearing the live-turn lock from stale cached metadata', async () => {
  const f = setup()
  f.vault.setLeader(f.group.id, 'leader')
  await f.controller.readThread('leader') // Authoritative idle metadata before the turn started.
  f.app.emit('notification', { method: 'turn/started', params: { threadId: 'leader', turn: { id: 'live', status: 'inProgress' } } })
  const orchestra = f.controller.orchestration!, cap = orchestra.context('leader', { fullAccess: false }, true).match(/--capability ([\w-]+)/)![1]
  await expect(orchestra.command(cap, { action: 'rename', threadId: 'leader', name: 'Project coordinator' })).resolves.toMatchObject({ name: 'Project coordinator' })
  await expect(f.controller.startTurn('leader', 'Must not overlap')).rejects.toMatchObject({ status: 409 })
  expect(f.rpc.mock.calls.some(([method]) => ['turn/start', 'turn/interrupt', 'thread/resume'].includes(method))).toBe(false)
})

it('preserves a live turn when self-rename must reload evicted metadata', async () => {
  const f = setup()
  f.vault.setLeader(f.group.id, 'leader')
  f.app.emit('notification', { method: 'turn/started', params: { threadId: 'leader', turn: { id: 'live', status: 'inProgress' } } })
  // No cached metadata (also possible after eviction); the read returns an older idle snapshot.
  const orchestra = f.controller.orchestration!, cap = orchestra.context('leader', { fullAccess: false }, true).match(/--capability ([\w-]+)/)![1]
  await orchestra.command(cap, { action: 'rename', threadId: 'leader', name: 'Coordinator' })
  await expect(f.controller.startTurn('leader', 'Must not overlap')).rejects.toMatchObject({ status: 409 })
  expect(f.rpc.mock.calls.some(([method]) => method === 'turn/start')).toBe(false)
})

it('does not archive after a live-turn notification overtakes the idle metadata response', async () => {
  const f = setup(), original = f.rpc.getMockImplementation()!
  f.vault.setLeader(f.group.id, 'leader')
  const orchestra = f.controller.orchestration!, cap = orchestra.context('leader', { fullAccess: false }, true).match(/--capability ([\w-]+)/)![1]
  f.rpc.mockImplementation(async (method, input, timeout) => {
    const snapshot = await original(method, input, timeout)
    if (method === 'thread/read') f.app.emit('notification', { method: 'turn/started', params: { threadId: 'worker', turn: { id: 'live', status: 'inProgress' } } })
    return snapshot
  })
  await expect(orchestra.command(cap, { action: 'archive', threadId: 'worker', requestId: 'newer-turn' })).rejects.toMatchObject({ status: 409 })
  expect(f.rpc.mock.calls.some(([method]) => ['thread/archive', 'turn/interrupt'].includes(method))).toBe(false)
  expect(f.vault.groupFor('worker')?.id).toBe(f.group.id)
  expect(orchestra.snapshot('leader').archives).toEqual([])
})
