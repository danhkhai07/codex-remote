import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { ContextVault } from './context-vault.js'
import { ConversationOrchestrator, type ConversationTask, type OrchestrationDriver } from './orchestration.js'
import { normalizeThreadName } from './controller.js'
import { listenOrchestration } from './orchestration-socket.js'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const settings = { model: 'test-model', effort: 'high', fullAccess: false }
type Info = Awaited<ReturnType<OrchestrationDriver['read']>>
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'orchestra-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const vault = new ContextVault(root), group = vault.createGroup('Project').groups[0]
  const threads = new Map<string, Info>()
  const add = (id: string) => { const thread = { id, name: id, cwd: '/workspace', status: { type: 'idle' }, turns: [] }; threads.set(id, thread); vault.assignThread(id, group.id); return thread }
  add('leader'); add('worker'); add('second')
  vault.setLeader(group.id, 'leader')
  const read = vi.fn(async (id: string) => {
    const thread = threads.get(id)
    if (!thread) throw new Error('Missing conversation')
    return thread
  })
  let sequence = 0
  const driver: OrchestrationDriver = {
    workspaces: () => [{ id: '0', label: 'workspace', path: '/workspace' }], read, inspect: read,
    normalizeName: normalizeThreadName,
    archive: vi.fn(async (id, guard, onDispatch) => { guard(); onDispatch(); vault.assignThread(id, null) }),
    create: vi.fn(async () => add(`created-${++sequence}`)), rename: vi.fn(async (id, name, guard) => { guard?.(); threads.get(id)!.name = name }),
    start: vi.fn(async (id, text, _settings, guard) => {
      guard()
      const turnId = `turn-${++sequence}`, thread = threads.get(id)!
      thread.status = { type: 'active' }; thread.turns!.push({ id: turnId, status: 'inProgress', items: [{ type: 'userMessage', content: [{ type: 'text', text }] }] })
      return turnId
    }),
    interrupt: vi.fn(async (id, turnId) => { const thread = threads.get(id)!; thread.status = { type: 'idle' }; thread.turns!.find(turn => turn.id === turnId)!.status = 'interrupted' }),
    starting: () => false, changed: vi.fn(),
  }
  const orchestra = new ConversationOrchestrator(vault, driver)
  cleanups.push(() => orchestra.stop())
  const token = (id = 'leader', options = settings, user = true) => orchestra.context(id, options, user).match(/--capability ([\w-]+)/)?.[1] ?? ''
  const finish = (id: string, turnId: string, text = 'Done', status = 'completed') => {
    const thread = threads.get(id)!, turn = thread.turns!.find(turn => turn.id === turnId)!
    turn.status = status; turn.items!.push({ type: 'agentMessage', text }); thread.status = { type: 'idle' }
    orchestra.completed(id, turnId, status, text)
  }
  const delegate = (capability: string, id = 'worker', requestId = 'task-1') => orchestra.command(capability, { action: 'delegate', requestId, threadId: id, title: 'Implement change', text: 'Use a fresh worktree and verify the change.' }) as Promise<{ task: ConversationTask }>
  return { root, vault, group, threads, driver, orchestra, token, finish, delegate, add }
}

it('persists one leader per folder and invalidates old roles across moves and role round-trips', async () => {
  const f = setup(), cap = f.token()
  expect(f.token('worker')).toBe('')
  await expect(f.orchestra.command('worker', { action: 'status' })).rejects.toMatchObject({ status: 403 })
  f.vault.setLeader(f.group.id, 'second')
  await expect(f.delegate(cap)).rejects.toMatchObject({ status: 403 })
  f.vault.setLeader(f.group.id, 'leader')
  await expect(f.delegate(cap)).rejects.toMatchObject({ status: 403 })
  expect(new ContextVault(f.root).groupFor('leader')?.leaderThreadId).toBe('leader')
  f.vault.assignThread('leader', null)
  expect(f.vault.snapshot().groups[0].leaderThreadId).toBeUndefined()
  expect(() => f.vault.setLeader(f.group.id, 'leader')).toThrow(/belong/)
})

it('restricts all commands to the same folder, denies self-delegation and expires capabilities', async () => {
  const f = setup(), cap = f.token()
  f.vault.assignThread('second', null)
  await expect(f.delegate(cap, 'second')).rejects.toMatchObject({ status: 403 })
  await expect(f.delegate(cap, 'leader')).rejects.toMatchObject({ status: 400 })
  await expect(f.orchestra.command(cap, { action: 'read', threadId: 'second' })).rejects.toMatchObject({ status: 403 })
  f.orchestra.completed('leader', 'done', 'completed', 'Delegated')
  await expect(f.delegate(cap)).rejects.toMatchObject({ status: 403 })
  const next = f.token()
  expect(next).not.toBe(cap)
  await expect(f.orchestra.command(next, { action: 'status', threadId: 'worker' })).resolves.toMatchObject({ leaderId: 'leader' })
})

it('creates a normal grouped conversation once and inherits the validated turn settings', async () => {
  const f = setup(), cap = f.token()
  const command = { action: 'spawn', requestId: 'spawn-a', title: 'Check API', text: 'Verify endpoint', workspaceId: '0' }
  const [first, retry] = await Promise.all([f.orchestra.command(cap, command), f.orchestra.command(cap, command)]) as Array<{ task: ConversationTask }>
  expect(first.task.id).toBe(retry.task.id)
  expect(f.driver.create).toHaveBeenCalledTimes(1)
  expect(f.vault.groupFor(first.task.threadId)?.id).toBe(f.group.id)
  await f.orchestra.start(); await f.orchestra.pump()
  expect(f.driver.start).toHaveBeenCalledWith(first.task.threadId, expect.stringContaining('Task-ID:'), settings, expect.any(Function))
  expect(f.token(first.task.threadId)).toBe('')
  expect(readFileSync(join(f.root, '.state/Orchestration.json'), 'utf8')).not.toContain(cap)
})

it('checks role again after an asynchronous spawn and never dispatches a demoted leader’s task', async () => {
  const f = setup(), cap = f.token()
  f.driver.create = vi.fn(async () => { f.vault.setLeader(f.group.id, 'second'); return f.add('late-worker') })
  await expect(f.orchestra.command(cap, { action: 'spawn', requestId: 'late', title: 'Late task', text: 'Work' })).rejects.toMatchObject({ status: 403 })
  await f.orchestra.start(); await f.orchestra.pump()
  expect(f.driver.start).not.toHaveBeenCalledWith('late-worker', expect.anything(), expect.anything(), expect.anything())
  expect(f.orchestra.snapshot('second').tasks[0].status).toBe('failed')
})

it('waits for busy conversations and never starts two delegated turns in the same conversation', async () => {
  const f = setup(), cap = f.token()
  f.threads.get('worker')!.status = { type: 'active' }
  await f.delegate(cap); await f.delegate(cap, 'worker', 'task-2')
  await f.orchestra.start(); await f.orchestra.pump()
  expect(f.driver.start).not.toHaveBeenCalled()
  f.threads.get('worker')!.status = { type: 'idle' }
  await f.orchestra.pump()
  expect(f.driver.start).toHaveBeenCalledTimes(1)
  expect(f.orchestra.snapshot('leader').tasks.map(task => task.status)).toEqual(['running', 'queued'])
})

it('limits concurrent workers and preserves the dispatch budget during automatic leader turns', async () => {
  const f = setup(), cap = f.token()
  for (let i = 0; i < 4; i++) { f.add(`worker-${i}`); await f.delegate(cap, `worker-${i}`, `task-${i}`) }
  await f.orchestra.start(); await f.orchestra.pump()
  expect(f.driver.start).toHaveBeenCalledTimes(3)
  f.token('leader', settings, false)
  expect(f.orchestra.snapshot('leader').limits).toMatchObject({ dispatchesLeft: 16 })
})

it('routes completed results to the current leader once, deferring while that leader is busy', async () => {
  const f = setup(), cap = f.token()
  const { task } = await f.delegate(cap)
  await f.orchestra.start(); await f.orchestra.pump()
  f.vault.setLeader(f.group.id, 'second')
  f.threads.get('second')!.status = { type: 'active' }
  f.orchestra.changed(); await f.orchestra.pump()
  f.finish('worker', task.turnId!, 'Verified result')
  await f.orchestra.pump()
  expect(f.orchestra.snapshot('second').pendingResults).toBe(1)
  f.threads.get('second')!.status = { type: 'idle' }
  await f.orchestra.pump()
  expect(f.driver.start).toHaveBeenCalledWith('second', expect.stringContaining('Verified result'), { fullAccess: false }, expect.any(Function))
  await f.orchestra.pump()
  expect(f.driver.start).toHaveBeenCalledTimes(2)
})

it('gives direct user instructions priority and keeps the worker paused until the user releases it', async () => {
  const f = setup(), cap = f.token()
  await f.delegate(cap)
  f.orchestra.userTurn('worker', 'Only review, do not implement')
  expect(f.orchestra.snapshot('leader').tasks[0].status).toBe('cancelled')
  await expect(f.delegate(cap, 'worker', 'task-2')).rejects.toMatchObject({ status: 409 })
  await expect(f.orchestra.command(cap, { action: 'release', threadId: 'worker' })).rejects.toMatchObject({ status: 400 })
  expect(new ConversationOrchestrator(f.vault, f.driver).snapshot('worker').paused).toContain('worker')
  f.orchestra.release('worker')
  await expect(f.delegate(cap, 'worker', 'task-2')).resolves.toMatchObject({ task: { status: 'queued' } })
})

it('cancels queued work on leader change and refuses a dispatch if authority changes during preparation', async () => {
  const f = setup(), cap = f.token()
  await f.delegate(cap)
  f.driver.start = vi.fn(async (_id, _text, _settings, guard) => { f.vault.setLeader(f.group.id, 'second'); guard(); return 'unreachable' })
  await f.orchestra.start(); await f.orchestra.pump()
  expect(f.orchestra.snapshot('second').tasks[0].status).toBe('failed')
  const cap2 = f.token('second')
  await f.delegate(cap2, 'worker', 'other')
  f.vault.setLeader(f.group.id, 'leader'); f.orchestra.changed()
  expect(f.orchestra.snapshot('leader').tasks.every(task => !['queued', 'running'].includes(task.status))).toBe(true)
})

it('does not restart ambiguous work after a crash and recovers results already completed on the server', async () => {
  const f = setup(), cap = f.token()
  const { task } = await f.delegate(cap)
  await f.orchestra.start(); await f.orchestra.pump()
  f.orchestra.stop()
  const thread = f.threads.get('worker')!, turn = thread.turns![0]
  turn.status = 'completed'; turn.items!.push({ type: 'agentMessage', text: 'Recovered result' }); thread.status = { type: 'idle' }
  f.threads.get('leader')!.status = { type: 'active' }
  const resumed = new ConversationOrchestrator(f.vault, f.driver)
  cleanups.push(() => resumed.stop())
  await resumed.start(); await resumed.pump()
  expect(resumed.snapshot('leader').tasks.find(item => item.id === task.id)).toMatchObject({ status: 'completed', result: 'Recovered result' })
  expect(f.driver.start).toHaveBeenCalledTimes(1)
  resumed.stop()
  const state = JSON.parse(readFileSync(join(f.root, '.state/Orchestration.json'), 'utf8'))
  state.tasks.push({ ...task, id: 'ambiguous', turnId: undefined, status: 'starting', threadId: 'second' })
  writeFileSync(join(f.root, '.state/Orchestration.json'), JSON.stringify(state))
  const ambiguous = new ConversationOrchestrator(f.vault, f.driver)
  cleanups.push(() => ambiguous.stop())
  await ambiguous.start(); await ambiguous.pump()
  expect(ambiguous.snapshot('leader').tasks.find(item => item.id === 'ambiguous')?.status).toBe('interrupted')
  expect(f.driver.start).toHaveBeenCalledTimes(1)
})

it('a user stop suppresses automatic leader wakeups until another direct user turn', async () => {
  const f = setup(), cap = f.token()
  const { task } = await f.delegate(cap)
  await f.orchestra.start(); await f.orchestra.pump()
  f.orchestra.userStop('leader')
  f.finish('worker', task.turnId!)
  await f.orchestra.pump()
  expect(f.driver.start).toHaveBeenCalledTimes(1)
  expect(f.orchestra.snapshot('leader').limits.wakeupsLeft).toBe(0)
  f.token(); await f.orchestra.pump()
  expect(f.driver.start).toHaveBeenCalledTimes(2)
})

it('requires a current capability over local IPC and rejects another listener on the live socket', async () => {
  const f = setup(), cap = f.token(), server = await listenOrchestration(f.orchestra)
  cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())))
  const call = (token: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ socketPath: f.orchestra.socketPath, path: '/command', method: 'POST', headers: { Authorization: `Bearer ${token}` } }, res => {
      let body = ''; res.on('data', chunk => { body += chunk }); res.on('end', () => resolve({ status: res.statusCode!, body }))
    }); req.on('error', reject); req.end(JSON.stringify({ action: 'status' }))
  })
  expect((await call(cap)).status).toBe(200)
  expect((await call('x'.repeat(43))).status).toBe(403)
  f.vault.setLeader(f.group.id, 'second')
  expect((await call(cap)).status).toBe(403)
  await expect(listenOrchestration(f.orchestra)).rejects.toThrow(/already in use/)
})

it('uses the private file mailbox when sockets are unavailable and binds it to the caller', async () => {
  const f = setup()
  await f.orchestra.start()
  const context = f.orchestra.context('leader', settings, true, 'Build the requested feature')
  const cap = context.match(/--capability ([\w-]+)/)![1], mailbox = context.match(/--mailbox "([^"]+)"/)![1]
  const file = join(f.root, 'command.json')
  writeFileSync(file, JSON.stringify({ action: 'status' }))
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../scripts/conversations.mjs', import.meta.url)),
    '--socket', join(f.root, 'absent.sock'), '--mailbox', mailbox, '--capability', cap, '--file', file])
  expect(JSON.parse(stdout)).toMatchObject({ leaderId: 'leader' })
  await expect(f.orchestra.command(cap, { action: 'status' }, 'worker')).rejects.toMatchObject({ status: 403 })
  f.vault.setLeader(f.group.id, 'second'); f.orchestra.changed()
  expect(f.orchestra.context('second', settings, false)).toContain('Build the requested feature')
})

it('keeps a failed interrupt actionable instead of reporting the task stopped', async () => {
  const f = setup(), cap = f.token(), { task } = await f.delegate(cap)
  await f.orchestra.start(); await f.orchestra.pump()
  vi.mocked(f.driver.interrupt).mockRejectedValueOnce(Error('Transport unavailable'))
  await expect(f.orchestra.cancel(task.id)).rejects.toThrow('Transport unavailable')
  expect(f.orchestra.snapshot('leader').tasks[0]).toMatchObject({ status: 'running', result: expect.stringContaining('Retry') })
  await f.orchestra.cancel(task.id)
  expect(f.orchestra.snapshot('leader').tasks[0].status).toBe('cancelled')
})


it('allows scoped rename including the leader, validates names, and refuses worker/Plan/stale capabilities', async () => {
  const f = setup(), cap = f.token()
  const rename = (threadId: string, name: unknown, token = cap) => f.orchestra.command(token, { action: 'rename', threadId, name })
  await expect(rename('leader', '  Điều phối  ')).resolves.toEqual({ threadId: 'leader', name: 'Điều phối' })
  await expect(rename('worker', 'QA')).resolves.toEqual({ threadId: 'worker', name: 'QA' })
  expect(f.threads.get('worker')?.name).toBe('QA')
  const calls = vi.mocked(f.driver.rename).mock.calls.length
  for (const name of ['', ' ', 42, null, 'a'.repeat(201), 'two\nlines', 'bad\u0000name']) await expect(rename('worker', name)).rejects.toMatchObject({ status: 400 })
  expect(f.driver.rename).toHaveBeenCalledTimes(calls)
  for (const action of ['rename', 'archive']) {
    await expect(f.orchestra.command(f.token('worker'), { action, threadId: 'second', name: 'No', requestId: action })).rejects.toMatchObject({ status: 403 })
    f.vault.assignThread('second', null)
    await expect(f.orchestra.command(cap, { action, threadId: 'second', name: 'No', requestId: action })).rejects.toMatchObject({ status: 403 })
  }
  const planCap = f.orchestra.context('leader', { ...settings, mode: 'plan' }, true).match(/--capability ([\w-]+)/)![1]
  for (const action of ['rename', 'archive']) await expect(f.orchestra.command(planCap, { action, threadId: 'worker', name: 'No', requestId: action })).rejects.toMatchObject({ status: 403 })
  await expect(rename('worker', 'Stale')).rejects.toMatchObject({ status: 403 })
  expect(f.driver.archive).not.toHaveBeenCalled()
})

it('respects manual control and forbids self-archive or unfinished delegated tasks', async () => {
  const f = setup(), cap = f.token()
  const archive = (threadId: string) => f.orchestra.command(cap, { action: 'archive', threadId, requestId: threadId })
  await expect(archive('leader')).rejects.toMatchObject({ status: 400 })
  f.driver.starting = id => id === 'worker'
  await expect(archive('worker')).rejects.toMatchObject({ status: 409 })
  f.driver.starting = () => false
  f.orchestra.userStop('worker')
  await expect(archive('worker')).rejects.toMatchObject({ status: 409 })
  await expect(f.orchestra.command(cap, { action: 'rename', threadId: 'worker', name: 'No' })).rejects.toMatchObject({ status: 409 })
  f.orchestra.release('worker')
  await f.delegate(cap)
  await expect(archive('worker')).rejects.toMatchObject({ status: 409 })
  await f.orchestra.start(); await f.orchestra.pump()
  await expect(archive('worker')).rejects.toMatchObject({ status: 409 })
  expect(f.driver.archive).not.toHaveBeenCalled()
})

it('archives only after results are delivered, preserving completed task reports and bounded retry receipts', async () => {
  const f = setup(), cap = f.token(), { task } = await f.delegate(cap)
  const command = { action: 'archive', threadId: 'worker', requestId: 'archive-worker' }
  await f.orchestra.start(); await f.orchestra.pump()
  f.threads.get('leader')!.status = { type: 'active' }
  f.finish('worker', task.turnId!, 'Keep this report')
  await expect(f.orchestra.command(cap, command)).rejects.toMatchObject({ status: 409 })
  f.threads.get('leader')!.status = { type: 'idle' }
  await f.orchestra.pump()
  expect(f.orchestra.snapshot('leader').pendingResults).toBe(0)
  const report = f.orchestra.snapshot('leader').tasks[0]
  await expect(f.orchestra.command(cap, command)).resolves.toMatchObject({ threadId: 'worker', archived: true, duplicate: false })
  await expect(f.orchestra.command(cap, command)).resolves.toMatchObject({ archived: true, duplicate: true })
  expect(f.driver.archive).toHaveBeenCalledTimes(1)
  expect(f.vault.groupFor('worker')).toBeNull()
  expect(f.orchestra.snapshot('leader').tasks[0]).toEqual(report)
  await expect(f.orchestra.command(cap, { ...command, threadId: 'second' })).rejects.toMatchObject({ status: 409 })
  f.vault.assignThread('worker', f.group.id)
  await expect(f.orchestra.command(cap, command)).rejects.toMatchObject({ status: 409 })
  f.vault.setLeader(f.group.id, 'second')
  await expect(f.orchestra.command(cap, command)).rejects.toMatchObject({ status: 403 })
  expect(f.driver.archive).toHaveBeenCalledTimes(1)
})

it('reserves archives against concurrent management and delegation, retaining ambiguous outcomes without replay', async () => {
  const f = setup(), cap = f.token(), command = { action: 'archive', threadId: 'worker', requestId: 'stable' }
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  f.driver.archive = vi.fn(async (_id, check, dispatched) => { check(); dispatched(); await waiting; throw Error('Lost RPC response') })
  const call = f.orchestra.command(cap, command)
  const failure = expect(call).rejects.toThrow('Lost RPC response')
  await expect(f.orchestra.command(cap, command)).rejects.toMatchObject({ status: 409 })
  await expect(f.orchestra.command(cap, { action: 'rename', threadId: 'worker', name: 'No' })).rejects.toMatchObject({ status: 409 })
  await expect(f.delegate(cap)).rejects.toMatchObject({ status: 409 })
  release(); await failure
  expect(f.orchestra.snapshot('leader').archives[0].status).toBe('review')
  for (const requestId of ['stable', 'new-key']) await expect(f.orchestra.command(cap, { ...command, requestId })).rejects.toMatchObject({ status: 409 })
  expect(f.driver.archive).toHaveBeenCalledTimes(1)
  f.orchestra.stop()
  const restarted = new ConversationOrchestrator(f.vault, f.driver)
  cleanups.push(() => restarted.stop())
  await restarted.start()
  const newCap = restarted.context('leader', settings, true).match(/--capability ([\w-]+)/)![1]
  await expect(restarted.command(newCap, command)).rejects.toMatchObject({ status: 409 })
  expect(f.driver.archive).toHaveBeenCalledTimes(1)
})

it.each(['pending', 'sending', 'review', 'sent'])('blocks archive while a result is %s without a confirmed delivery turn', async status => {
  const f = setup(); f.token()
  const path = join(f.root, '.state/Orchestration.json'), state = JSON.parse(readFileSync(path, 'utf8'))
  state.notices.push({ id: 'notice', threadId: 'worker', groupId: f.group.id, text: 'Important result', status })
  writeFileSync(path, JSON.stringify(state))
  const restored = new ConversationOrchestrator(f.vault, f.driver)
  cleanups.push(() => restored.stop())
  const cap = restored.context('leader', settings, true).match(/--capability ([\w-]+)/)![1]
  await expect(restored.command(cap, { action: 'archive', threadId: 'worker', requestId: 'no' })).rejects.toMatchObject({ status: 409 })
  expect(f.driver.archive).not.toHaveBeenCalled()
})

it('recovers archive receipts without replaying sent requests and bounds completed receipts', async () => {
  const f = setup(), cap = f.token()
  await f.orchestra.command(cap, { action: 'archive', threadId: 'worker', requestId: 'original' })
  const path = join(f.root, '.state/Orchestration.json'), state = JSON.parse(readFileSync(path, 'utf8'))
  // Seed retained history directly; creating 100 extra vaults/conversation exports
  // would test unrelated indexing cost instead of receipt retention.
  state.archives = Array.from({ length: 100 }, (_, i) => ({ ...state.archives[0], requestId: `old-${i}`, threadId: `old-${i}` }))
  writeFileSync(path, JSON.stringify(state)); f.orchestra.stop()
  const full = new ConversationOrchestrator(f.vault, f.driver)
  cleanups.push(() => full.stop()); await full.start()
  const fullCap = full.context('leader', settings, true).match(/--capability ([\w-]+)/)![1]
  const command = { action: 'archive', threadId: 'second', requestId: 'latest' }
  await full.command(fullCap, command)
  expect(full.snapshot('leader').archives).toHaveLength(100)
  expect(full.snapshot('leader').archives.some(item => item.requestId === 'old-0')).toBe(false)
  const next = JSON.parse(readFileSync(path, 'utf8'))
  next.archives.push({ ...next.archives[0], requestId: 'interrupted', threadId: 'worker', status: 'sent' }, { ...next.archives[0], requestId: 'unsent', threadId: 'second', status: 'preparing' })
  writeFileSync(path, JSON.stringify(next)); full.stop()
  const restored = new ConversationOrchestrator(f.vault, f.driver)
  cleanups.push(() => restored.stop()); await restored.start()
  const newCap = restored.context('leader', settings, true).match(/--capability ([\w-]+)/)![1]
  await expect(restored.command(newCap, command)).resolves.toMatchObject({ duplicate: true })
  expect(restored.snapshot('leader').archives.find(item => item.requestId === 'interrupted')?.status).toBe('review')
  expect(restored.snapshot('leader').archives.find(item => item.requestId === 'unsent')).toBeUndefined()
  expect(f.driver.archive).toHaveBeenCalledTimes(2)
})


it('accepts rename/archive through the same private CLI transport and returns name validation errors', async () => {
  const f = setup(), cap = f.token(), server = await listenOrchestration(f.orchestra)
  cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())))
  const file = join(f.root, 'manage.json'), run = promisify(execFile)
  const command = async (body: Record<string, unknown>) => {
    writeFileSync(file, JSON.stringify(body))
    const { stdout } = await run(process.execPath, [fileURLToPath(new URL('../scripts/conversations.mjs', import.meta.url)), '--socket', f.orchestra.socketPath, '--capability', cap, '--file', file])
    return JSON.parse(stdout)
  }
  await expect(command({ action: 'rename', threadId: 'worker', name: '  CLI worker  ' })).resolves.toMatchObject({ name: 'CLI worker' })
  await expect(command({ action: 'rename', threadId: 'worker', name: '' })).rejects.toThrow('HTTP 400')
  const archive = { action: 'archive', threadId: 'worker', requestId: 'cli-archive' }
  await expect(command(archive)).resolves.toMatchObject({ archived: true, duplicate: false })
  await expect(command(archive)).resolves.toMatchObject({ archived: true, duplicate: true })
  expect(f.driver.archive).toHaveBeenCalledTimes(1)
})
