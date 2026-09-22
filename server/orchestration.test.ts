import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { ContextVault } from './context-vault.js'
import { ConversationOrchestrator, MAX_CONCURRENT_WORKERS, type ConversationTask, type OrchestrationDriver } from './orchestration.js'
import { normalizeThreadName } from './controller.js'
import { listenOrchestration } from './orchestration-socket.js'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const settings = { model: 'gpt-6-astra', effort: 'high', fullAccess: false }
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
    models: vi.fn(async () => ({ data: [
      { model: 'gpt-6-astra', supportedReasoningEfforts: ['high', 'xhigh', 'max'].map(reasoningEffort => ({ reasoningEffort })) },
      { model: 'gpt-5.6-sol', supportedReasoningEfforts: ['low', 'high', 'xhigh'].map(reasoningEffort => ({ reasoningEffort })) },
    ] })),
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

it('starts the eighth worker, queues the ninth, and reports the same limit in status and help', async () => {
  const f = setup(), cap = f.token()
  f.threads.get('leader')!.status = { type: 'active' }
  for (let i = 0; i < 9; i++) { f.add(`worker-${i}`); await f.delegate(cap, `worker-${i}`, `task-${i}`) }
  await f.orchestra.start(); await f.orchestra.pump()
  expect(f.driver.start).toHaveBeenCalledTimes(8)
  expect(f.orchestra.snapshot('leader').tasks.map(task => task.status)).toEqual([...Array(8).fill('running'), 'queued'])
  const help = f.orchestra.context('leader', settings, false)
  expect(MAX_CONCURRENT_WORKERS).toBe(8)
  expect(help).toContain(`Maximum ${MAX_CONCURRENT_WORKERS} delegated worker turns per folder at a time (leader excluded)`)
  expect(f.orchestra.snapshot('leader').limits).toEqual({ concurrent: MAX_CONCURRENT_WORKERS, dispatchesLeft: 11, wakeupsLeft: 8 })
})

it.each(['complete', 'cancel'])('releases exactly one of eight slots on %s', async action => {
  const f = setup(), cap = f.token()
  f.threads.get('leader')!.status = { type: 'active' }
  for (let i = 0; i < 10; i++) { f.add(`worker-${i}`); await f.delegate(cap, `worker-${i}`, `task-${i}`) }
  await f.orchestra.start(); await f.orchestra.pump()
  const first = f.orchestra.snapshot('leader').tasks[0]
  if (action === 'complete') f.finish(first.threadId, first.turnId!)
  else await f.orchestra.cancel(first.id)
  await f.orchestra.pump(); await f.orchestra.pump()
  expect(f.driver.start).toHaveBeenCalledTimes(9)
  expect(f.orchestra.snapshot('leader').tasks.filter(task => task.status === 'running')).toHaveLength(8)
  expect(f.orchestra.snapshot('leader').tasks.at(-1)?.status).toBe('queued')
})

it('reserves starting and stopping slots while concurrent pumps share the same work', async () => {
  const f = setup(), cap = f.token(), start = f.driver.start, interrupt = f.driver.interrupt
  f.threads.get('leader')!.status = { type: 'active' }
  for (let i = 0; i < 9; i++) { f.add(`worker-${i}`); await f.delegate(cap, `worker-${i}`, `task-${i}`) }
  let releaseStart!: () => void, releaseStop!: () => void
  const startGate = new Promise<void>(resolve => { releaseStart = resolve })
  const stopGate = new Promise<void>(resolve => { releaseStop = resolve })
  f.driver.start = vi.fn(async (...args) => { if (args[0] === 'worker-7') await startGate; return start(...args) })
  await f.orchestra.start()
  await vi.waitFor(() => expect(f.driver.start).toHaveBeenCalledTimes(8))
  expect(f.orchestra.snapshot('leader').tasks[7].status).toBe('starting')
  const pumps = Array.from({length: 12}, () => f.orchestra.pump())
  expect(new Set(pumps).size).toBe(1)
  releaseStart(); await Promise.all(pumps)
  f.driver.interrupt = vi.fn(async (...args) => { await stopGate; return interrupt(...args) })
  const cancelling = f.orchestra.cancel(f.orchestra.snapshot('leader').tasks[0].id)
  await vi.waitFor(() => expect(f.orchestra.snapshot('leader').tasks[0].status).toBe('stopping'))
  await Promise.all(Array.from({length: 12}, () => f.orchestra.pump()))
  expect(f.driver.start).toHaveBeenCalledTimes(8)
  expect(f.orchestra.snapshot('leader').tasks[8].status).toBe('queued')
  releaseStop(); await cancelling; await f.orchestra.pump()
  expect(f.driver.start).toHaveBeenCalledTimes(9)
})

it('counts recovered workers during startup before admitting the ninth queued task', async () => {
  const f = setup(), cap = f.token()
  f.threads.get('leader')!.status = { type: 'active' }
  for (let i = 0; i < 9; i++) { f.add(`worker-${i}`); await f.delegate(cap, `worker-${i}`, `task-${i}`) }
  await f.orchestra.start(); await f.orchestra.pump(); f.orchestra.stop()
  const resumed = new ConversationOrchestrator(f.vault, f.driver)
  cleanups.push(() => resumed.stop())
  await Promise.all([resumed.start(), ...Array.from({length: 8}, () => resumed.pump())])
  expect(f.driver.start).toHaveBeenCalledTimes(8)
  expect(resumed.snapshot('leader').tasks.filter(task => task.status === 'running')).toHaveLength(8)
  expect(resumed.snapshot('leader').tasks.at(-1)?.status).toBe('queued')
  expect(resumed.snapshot('leader').limits).toEqual({concurrent: 8, dispatchesLeft: 11, wakeupsLeft: 8})
})

it('gives each folder its own eight worker slots without counting either leader', async () => {
  const f = setup(), cap = f.token(), other = f.vault.createGroup('Other').groups.find(group => group.name === 'Other')!
  f.add('other-leader'); f.vault.assignThread('other-leader', other.id); f.vault.setLeader(other.id, 'other-leader')
  const otherCap = f.token('other-leader')
  f.threads.get('leader')!.status = f.threads.get('other-leader')!.status = {type: 'active'}
  for (let i = 0; i < 9; i++) {
    f.add(`worker-${i}`); await f.delegate(cap, `worker-${i}`, `task-${i}`)
    f.add(`other-${i}`); f.vault.assignThread(`other-${i}`, other.id); await f.delegate(otherCap, `other-${i}`, `other-task-${i}`)
  }
  await f.orchestra.start(); await f.orchestra.pump()
  expect(f.driver.start).toHaveBeenCalledTimes(16)
  for (const leader of ['leader', 'other-leader']) {
    expect(f.orchestra.snapshot(leader).tasks.filter(task => task.status === 'running')).toHaveLength(8)
    expect(f.orchestra.snapshot(leader).tasks.filter(task => task.status === 'queued')).toHaveLength(1)
  }
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

it('filters the live model catalog and exposes only safe fields', async () => {
  const f = setup(), cap = f.token()
  f.driver.models = vi.fn(async () => ({ data: [
    { model: 'gpt-6-astra', secret: 'private', supportedReasoningEfforts: [{ reasoningEffort: 'max', description: 'private' }] },
    { model: 'gpt-5.6-sol', hidden: true },
    { model: 'other', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] },
  ] }))
  expect(await f.orchestra.command(cap, { action: 'models' })).toEqual({
    models: [{ model: 'gpt-6-astra', supportedReasoningEfforts: ['max'] }],
  })
})

it.each([
  { model: 'other', effort: 'high' },
  { model: 'gpt-5.6-sol', effort: 'max' },
  { model: '', effort: 'high' },
  { model: 'gpt-6-astra', effort: null },
])('rejects invalid settings before creating, reserving or spending budgets: %j', async override => {
  const f = setup(), cap = f.token()
  await expect(f.orchestra.command(cap, { action: 'spawn', requestId: 'invalid', title: 'Task', text: 'Task', ...override })).rejects.toMatchObject({ status: 400 })
  expect(f.driver.create).not.toHaveBeenCalled()
  expect(f.orchestra.snapshot('leader')).toMatchObject({ tasks: [], limits: { dispatchesLeft: 20 } })
})

it('rejects missing or disallowed inherited settings without defaults', async () => {
  const f = setup()
  for (const inherited of [{ fullAccess: false }, { model: 'gpt-6-astra', fullAccess: false }, { model: 'other', effort: 'high', fullAccess: false }]) {
    const cap = f.orchestra.context('leader', inherited, true).match(/--capability ([\w-]+)/)![1]
    await expect(f.delegate(cap)).rejects.toMatchObject({ status: 400 })
  }
  expect(f.orchestra.snapshot('leader').tasks).toEqual([])
})

it('pins overridden task settings across simultaneous retries and leaves leader wakeups unchanged', async () => {
  const f = setup(), inherited = { ...settings, mode: 'plan' as const }, cap = f.token('leader', inherited)
  const command = { action: 'spawn', requestId: 'override', title: 'Task', text: 'Task', model: 'gpt-5.6-sol', effort: 'low', fullAccess: true, mode: 'default' }
  const [first, retry] = await Promise.all([f.orchestra.command(cap, command), f.orchestra.command(cap, command)]) as Array<{ task: ConversationTask }>
  expect(first.task.id).toBe(retry.task.id)
  const chosen = { ...inherited, model: 'gpt-5.6-sol', effort: 'low' }
  expect(first.task.settings).toEqual(chosen)
  expect(f.driver.create).toHaveBeenCalledExactlyOnceWith('0', f.group.id, chosen)
  await f.orchestra.start(); await f.orchestra.pump()
  expect(f.driver.start).toHaveBeenCalledWith(first.task.threadId, expect.any(String), chosen, expect.any(Function))
  expect(await f.orchestra.command(cap, { ...command, model: 'other', effort: 'invalid' })).toMatchObject({ duplicate: true, task: { settings: chosen } })
  expect(f.orchestra.snapshot('leader').tasks[0].settings).toEqual({ model: chosen.model, effort: chosen.effort })
  f.finish(first.task.threadId, first.task.turnId!)
  await f.orchestra.pump()
  expect(f.driver.start).toHaveBeenLastCalledWith('leader', expect.any(String), inherited, expect.any(Function))
})

it('rechecks role and manual control after asynchronous catalog reads before reservation', async () => {
  for (const change of ['role', 'manual']) {
    const f = setup(), cap = f.token(), models = f.driver.models
    if (change === 'manual') await f.delegate(cap, 'worker', 'earlier')
    f.driver.models = async () => {
      if (change === 'role') f.vault.setLeader(f.group.id, 'second')
      else f.orchestra.userTurn('worker', 'Direct control')
      return models()
    }
    await expect(f.delegate(cap)).rejects.toMatchObject({ status: change === 'role' ? 403 : 409 })
    expect(f.orchestra.snapshot('leader').tasks).toHaveLength(change === 'manual' ? 1 : 0)
  }
})

it('fails queued tasks if the pinned effort disappears instead of lowering it at dispatch', async () => {
  const f = setup(), cap = f.token()
  await f.delegate(cap)
  f.driver.models = async () => ({ data: [{ model: settings.model, supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }] })
  await f.orchestra.start(); await f.orchestra.pump()
  expect(vi.mocked(f.driver.start).mock.calls.filter(([id]) => id === 'worker')).toHaveLength(0)
  expect(f.orchestra.snapshot('leader').tasks[0]).toMatchObject({ status: 'failed', settings: { effort: 'high' } })
})

it.each([[], [{ model: 'gpt-6-astra' }]])('rejects unavailable models or unknown effort support before reservation', async data => {
  const f = setup(), cap = f.token()
  f.driver.models = async () => ({ data })
  await expect(f.delegate(cap)).rejects.toMatchObject({ status: 400 })
  expect(f.orchestra.snapshot('leader').tasks).toEqual([])
  expect(f.driver.start).not.toHaveBeenCalled()
})

it('inherits effort for a model-only override and model for an effort-only override', async () => {
  const f = setup(), cap = f.token()
  const base = { action: 'delegate', threadId: 'worker', title: 'Task', text: 'Task' }
  expect(await f.orchestra.command(cap, { ...base, requestId: 'model-only', model: 'gpt-5.6-sol' }))
    .toMatchObject({ task: { settings: { ...settings, model: 'gpt-5.6-sol' } } })
  expect(await f.orchestra.command(cap, { ...base, requestId: 'effort-only', effort: 'max' }))
    .toMatchObject({ task: { settings: { ...settings, effort: 'max' } } })
})

it('does not schedule a reserved delegate until its asynchronous admission finishes', async () => {
  const f = setup(), cap = f.token(), read = f.driver.read
  await f.orchestra.start(); await f.orchestra.pump()
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { entered = resolve })
  f.driver.read = async id => { entered(); await gate; return read(id) }
  const admitted = f.delegate(cap)
  await ready; await f.orchestra.pump()
  const startedBeforeAdmission = vi.mocked(f.driver.start).mock.calls.length
  const stateBeforeAdmission = f.orchestra.snapshot('leader').tasks[0].status
  release(); await admitted; await f.orchestra.pump()
  expect(startedBeforeAdmission).toBe(0)
  expect(stateBeforeAdmission).toBe('creating')
  expect(f.driver.start).toHaveBeenCalledTimes(1)
  expect(f.orchestra.snapshot('leader').tasks[0].status).toBe('running')
})

it.each(['start-first', 'pump-first'])('reconciles uncertain accepted turns before admitting new work (%s)', async order => {
  const f = setup(), cap = f.token()
  f.threads.get('leader')!.status = {type: 'active'}
  for (let i = 0; i < 9; i++) { f.add(`recover-${i}`); await f.delegate(cap, `recover-${i}`, `recover-${i}`) }
  await f.orchestra.start(); await f.orchestra.pump(); f.orchestra.stop()
  const path = join(f.root, '.state/Orchestration.json'), state = JSON.parse(readFileSync(path, 'utf8'))
  // Only fake state: simulate eight accepted turns whose final reservation write was lost.
  for (const task of state.tasks) if (task.status === 'running') task.status = 'creating'
  writeFileSync(path, JSON.stringify(state))
  const resumed = new ConversationOrchestrator(f.vault, f.driver)
  cleanups.push(() => resumed.stop())
  const firstPump = order === 'pump-first' ? resumed.pump() : Promise.resolve()
  await Promise.all([firstPump, resumed.start(), ...Array.from({length: 12}, () => resumed.pump())])
  await resumed.pump()
  expect(f.driver.start).toHaveBeenCalledTimes(8)
  expect(resumed.snapshot('leader').tasks.filter(task => task.status === 'running')).toHaveLength(8)
  expect(resumed.snapshot('leader').tasks.at(-1)?.status).toBe('queued')
})

it('retains queued model settings across restart and retries even if leader defaults change', async () => {
  const f = setup(), cap = f.token()
  const command = {action: 'delegate', requestId: 'persist-model', threadId: 'worker', title: 'Task', text: 'Task', model: 'gpt-5.6-sol', effort: 'low'}
  const {task} = await f.orchestra.command(cap, command) as {task: ConversationTask}
  const resumed = new ConversationOrchestrator(f.vault, f.driver)
  cleanups.push(() => resumed.stop())
  const next = resumed.context('leader', {...settings, effort: 'max'}, true).match(/--capability ([\w-]+)/)![1]
  const retry = await resumed.command(next, {...command, model: 'gpt-6-astra', effort: 'max'}) as {task: ConversationTask; duplicate: boolean}
  expect(retry.duplicate).toBe(true); expect(retry.task.id).toBe(task.id)
  expect(retry.task.settings).toEqual({...settings, model: 'gpt-5.6-sol', effort: 'low'})
  await resumed.start(); await resumed.pump()
  expect(f.driver.start).toHaveBeenCalledWith('worker', expect.any(String), retry.task.settings, expect.any(Function))
})

it('rechecks scoped authority during catalog discovery and dispatch validation', async () => {
  const f = setup(), cap = f.token(), models = f.driver.models
  await f.delegate(cap)
  f.driver.models = async () => { f.vault.setLeader(f.group.id, 'second'); return models() }
  await f.orchestra.start(); await f.orchestra.pump()
  expect(vi.mocked(f.driver.start).mock.calls.filter(([id]) => id === 'worker')).toHaveLength(0)
  expect(f.orchestra.snapshot('second').tasks[0].status).toBe('failed')
  const next = f.token('second')
  f.driver.models = async () => { f.orchestra.revoke('second'); return models() }
  await expect(f.orchestra.command(next, {action: 'models'})).rejects.toMatchObject({status: 403})
})

it('does not revive an admitted task cancelled while the worker read was pending', async () => {
  const f = setup(), cap = f.token(), read = f.driver.read
  f.threads.get('leader')!.status = {type: 'active'}
  await f.orchestra.start(); await f.orchestra.pump()
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { entered = resolve })
  f.driver.read = async id => { entered(); await gate; return read(id) }
  const admission = f.delegate(cap), rejected = expect(admission).rejects.toMatchObject({status: 409})
  await ready
  await f.orchestra.command(cap, {action: 'cancel', taskId: f.orchestra.snapshot('leader').tasks[0].id})
  release(); await rejected; await f.orchestra.pump()
  expect(f.orchestra.snapshot('leader').tasks[0].status).toBe('cancelled')
  expect(f.driver.start).not.toHaveBeenCalled()
})

it.each(['failed', 'interrupted'])('records recovery of a %s attempt without replacing history or dispatching work', async status => {
  const f = setup(), cap = f.token()
  f.threads.get('leader')!.status = { type: 'active' }
  const { task } = await f.delegate(cap)
  await f.orchestra.start(); await f.orchestra.pump()
  f.finish('worker', task.turnId!, 'Original error report', status)
  await f.orchestra.pump()
  const calls = vi.mocked(f.driver.start).mock.calls.length
  const before = f.orchestra.snapshot('leader')
  const command = { action: 'resolve', taskId: task.id, summary: 'Leader finished the deployment', evidence: 'Release marker complete; health verified' }
  await expect(f.orchestra.command(cap, command)).resolves.toMatchObject({ duplicate: false, task: {
    status, result: 'Original error report', resolution: { resolvedBy: 'leader', summary: command.summary, evidence: command.evidence },
  } })
  const resolved = f.orchestra.snapshot('leader').tasks[0]
  await expect(f.orchestra.command(cap, command)).resolves.toMatchObject({ duplicate: true })
  await expect(f.orchestra.command(cap, { ...command, evidence: 'different' })).rejects.toMatchObject({ status: 409 })
  expect(f.orchestra.snapshot('leader').tasks[0]).toEqual(resolved)
  expect(new ConversationOrchestrator(f.vault, f.driver).snapshot('leader').tasks[0]).toEqual(resolved)
  f.orchestra.completed('worker', task.turnId!, 'completed', 'Late duplicate notification')
  expect(f.orchestra.snapshot('leader').tasks[0]).toEqual(resolved)
  expect(f.orchestra.snapshot('leader').pendingResults).toBe(before.pendingResults)
  expect(f.driver.start).toHaveBeenCalledTimes(calls)
})

it('requires a current Code leader, a same-folder task and bounded recovery evidence', async () => {
  const f = setup(), cap = f.token(), { task } = await f.delegate(cap)
  const command = { action: 'resolve', taskId: task.id, summary: 'Recovered', evidence: 'Verified reference' }
  await expect(f.orchestra.command(cap, command)).rejects.toMatchObject({ status: 409 })
  f.orchestra.userTurn('worker', 'Direct user control')
  for (const patch of [{ summary: '' }, { evidence: ' ' }, { summary: 'x'.repeat(4001) }, { evidence: 'x'.repeat(2001) }]) {
    await expect(f.orchestra.command(cap, { ...command, ...patch })).rejects.toMatchObject({ status: 400 })
  }
  const planCap = f.token('leader', { ...settings, mode: 'plan' })
  await expect(f.orchestra.command(planCap, command)).rejects.toMatchObject({ status: 403 })
  await expect(f.orchestra.command(cap, command)).rejects.toMatchObject({ status: 403 })
  const other = f.vault.createGroup('Other').groups.find(group => group.name === 'Other')!
  f.vault.assignThread('second', other.id); f.vault.setLeader(other.id, 'second')
  await expect(f.orchestra.command(f.token('second'), command)).rejects.toMatchObject({ status: 404 })
  await expect(f.orchestra.command(f.token(), command, 'worker')).rejects.toMatchObject({ status: 403 })
  await expect(f.orchestra.command(f.token(), command)).resolves.toMatchObject({ task: { status: 'cancelled', resolution: { resolvedBy: 'leader' } } })
  expect(f.orchestra.snapshot('leader').paused).toContain('worker')
  expect(f.driver.interrupt).not.toHaveBeenCalled()
})

it('allows the replacement leader to resolve an old attempt but rejects stale leader epochs', async () => {
  const f = setup(), cap = f.token(), { task } = await f.delegate(cap)
  await f.orchestra.cancel(task.id)
  const epoch = f.vault.groupFor('leader')!.leaderEpoch
  const command = { action: 'resolve', taskId: task.id, summary: 'Taken over', evidence: 'Tests and deploy verified' }
  f.vault.setLeader(f.group.id, 'second')
  await expect(f.orchestra.command(cap, command)).rejects.toMatchObject({ status: 403 })
  expect(() => f.orchestra.resolveTask('leader', epoch, task.id, command.summary, command.evidence)).toThrow(/current folder leader/)
  expect(() => f.orchestra.resolveTask('second', epoch, task.id, command.summary, command.evidence)).toThrow(/Leader changed/)
  await expect(f.orchestra.command(f.token('second'), command)).resolves.toMatchObject({ task: { leaderId: 'leader', resolution: { resolvedBy: 'second' } } })
})

it('rejects resolution of a successful attempt', async () => {
  const f = setup(), cap = f.token(), { task } = await f.delegate(cap)
  f.threads.get('leader')!.status = { type: 'active' }
  await f.orchestra.start(); await f.orchestra.pump()
  f.finish('worker', task.turnId!)
  await expect(f.orchestra.command(cap, { action: 'resolve', taskId: task.id, summary: 'Done', evidence: 'Verified' })).rejects.toMatchObject({ status: 409 })
})

it('waits for a cancelled in-flight dispatch to settle before recording recovery', async () => {
  const f = setup(), cap = f.token(), { task } = await f.delegate(cap), start = f.driver.start
  f.threads.get('leader')!.status = { type: 'active' }
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { entered = resolve })
  f.driver.start = async (...args) => { const id = await start(...args); entered(); await gate; return id }
  await f.orchestra.start(); await ready
  f.orchestra.userTurn('worker', 'Take control while turn/start is returning')
  const command = { action: 'resolve', taskId: task.id, summary: 'Verified recovery', evidence: 'Fixture evidence' }
  await expect(f.orchestra.command(cap, command)).rejects.toMatchObject({ status: 409 })
  release(); await f.orchestra.pump()
  await expect(f.orchestra.command(cap, command)).resolves.toMatchObject({ task: { status: 'cancelled', resolution: { summary: command.summary } } })
  const resolved = f.orchestra.snapshot('leader').tasks[0]
  f.finish('worker', task.turnId!, 'Late completion after cancellation')
  expect(f.orchestra.snapshot('leader').tasks[0]).toEqual(resolved)
})

it('returns retained history without clipping active tasks or unresolved errors behind a positional limit', async () => {
  const f = setup(), { task } = await f.delegate(f.token())
  const path = join(f.root, '.state/Orchestration.json'), state = JSON.parse(readFileSync(path, 'utf8'))
  // A private fixture models older state whose task array was not sorted by status.
  state.tasks = Array.from({ length: 150 }, (_, i) => ({ ...task, id: `retained-${i}`, status: 'completed' }))
  state.tasks[0].status = 'failed'; state.tasks[1].status = 'queued'; state.tasks[2].status = 'running'
  state.tasks.push({ ...task, id: 'other-folder', groupId: 'elsewhere' })
  writeFileSync(path, JSON.stringify(state))
  const restored = new ConversationOrchestrator(f.vault, f.driver)
  cleanups.push(() => restored.stop())
  const snapshot = restored.snapshot('leader')
  expect(snapshot.tasks).toHaveLength(150)
  expect(snapshot.tasks.slice(0, 3).map(item => item.status)).toEqual(['failed', 'queued', 'running'])
  expect(snapshot.tasks.some(item => item.id === 'other-folder')).toBe(false)
  expect(JSON.parse(readFileSync(path, 'utf8')).tasks).toEqual(state.tasks)
})

// Independent review controls converted to acceptance as each finding is fixed.
// No production task/state or native model turn is used.
it('L1: restart retains unresolved dispatch settlement until the exact accepted turn ends', async () => {
  const f = setup(), cap = f.token(), { task } = await f.delegate(cap), start = f.driver.start
  f.threads.get('leader')!.status = { type: 'active' }
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { entered = resolve })
  f.driver.start = async (...args) => {
    await start(...args) // Native accepted the fake turn; reply is still in flight.
    entered(); await gate
    throw new Error('Fixture old gateway lost the reply at restart')
  }
  await f.orchestra.start(); await ready
  try {
    expect(JSON.parse(readFileSync(join(f.root, '.state/Orchestration.json'), 'utf8')).tasks[0].dispatchPending).toBe(true)
    await f.orchestra.cancel(task.id) // No turnId yet; cancelled is written durably.
    const command = { action: 'resolve', taskId: task.id, summary: 'Claimed recovery', evidence: 'Fixture only' }
    await expect(f.orchestra.command(cap, command)).rejects.toMatchObject({ status: 409 })
    expect(f.threads.get('worker')!.status).toEqual({ type: 'active' })
    f.orchestra.stop()
    const recovered = new ConversationOrchestrator(f.vault, f.driver)
    cleanups.push(() => recovered.stop())
    await recovered.start(); await recovered.pump()
    const checkpoint = recovered.snapshot('leader').tasks[0], original = f.threads.get('worker')!.turns![0]
    expect(checkpoint.status).toBe('cancelled'); expect(checkpoint.turnId).toBe(original.id)
    expect(checkpoint.dispatchPending).toBe(true)
    const resolve = () => recovered.resolveTask('leader', f.vault.groupFor('leader')!.leaderEpoch, task.id, command.summary, command.evidence)
    expect(resolve).toThrow(/settling/)
    expect(f.threads.get('worker')!.turns?.at(-1)?.status).toBe('inProgress')
    expect(f.driver.interrupt).not.toHaveBeenCalled()
    original.status = 'interrupted'
    // Another user turn may stay active; settlement concerns only the original turn.
    f.threads.get('worker')!.turns!.push({ id: 'user-owned', status: 'inProgress', items: [] })
    await recovered.reconcile()
    expect(resolve())
      .toMatchObject({ duplicate: false, task: { status: 'cancelled', resolution: { summary: command.summary } } })
    expect(resolve()).toMatchObject({ duplicate: true })
    const settled = recovered.snapshot('leader').tasks[0]
    expect(settled.result).toBe(checkpoint.result)
    recovered.completed('worker', original.id, 'completed', 'Late completion must not replace the original cancel or recovery')
    expect(recovered.snapshot('leader').tasks[0]).toEqual(settled)
    expect(f.driver.interrupt).not.toHaveBeenCalled()
  } finally { release(); await f.orchestra.pump() }
})

it.each([true, undefined])('L1: missing or ambiguous native identity remains blocked after restart (marker %s)', async marker => {
  const f = setup(), { task } = await f.delegate(f.token())
  f.threads.get('leader')!.status = { type: 'active' }
  const path = join(f.root, '.state/Orchestration.json'), state = JSON.parse(readFileSync(path, 'utf8'))
  Object.assign(state.tasks[0], { status: 'cancelled', dispatchPending: marker, result: 'Original cancel' })
  writeFileSync(path, JSON.stringify(state))
  const original = { id: 'original', status: 'inProgress', items: [{ type: 'userMessage', content: [{ type: 'text', text: `[Codex Remote · Giao việc từ leader leader]\nTask-ID: ${task.id}\nTask` }] }] }
  // A quote or a substring in another user's turn is not the original dispatch.
  const worker = f.threads.get('worker')!
  worker.turns = [{ id: 'user-owned', status: 'completed', items: [{ type: 'agentMessage', text: `Task-ID: ${task.id}` }] }]
  const recovered = new ConversationOrchestrator(f.vault, f.driver); cleanups.push(() => recovered.stop())
  await recovered.start(); await recovered.pump()
  const resolve = () => recovered.resolveTask('leader', f.vault.groupFor('leader')!.leaderEpoch, task.id, 'Recovery', 'Exact settlement verified')
  expect(resolve).toThrow(/settling/)
  worker.turns.push(original, { ...original, id: 'duplicate-marker' })
  await recovered.reconcile(); expect(resolve).toThrow(/settling/)
  worker.turns.pop(); original.status = 'unknown'
  await recovered.reconcile(); expect(resolve).toThrow(/settling/)
  original.status = 'inProgress'; await recovered.reconcile(); expect(resolve).toThrow(/settling/)
  original.status = 'completed'; await recovered.reconcile()
  expect(resolve()).toMatchObject({ task: { status: 'cancelled', result: 'Original cancel', dispatchPending: false } })
  expect(resolve()).toMatchObject({ duplicate: true })
  expect(f.driver.start).not.toHaveBeenCalled(); expect(f.driver.interrupt).not.toHaveBeenCalled()
})

it('L1: unresolved cancelled dispatch retains one of eight slots and manual control after restart', async () => {
  const f = setup(), cap = f.token()
  f.threads.get('leader')!.status = { type: 'active' }
  for (let i = 0; i < 9; i++) { f.add(`worker-${i}`); await f.delegate(cap, `worker-${i}`, `task-${i}`) }
  await f.orchestra.start(); await f.orchestra.pump()
  const first = f.orchestra.snapshot('leader').tasks[0]
  f.orchestra.userTurn(first.threadId, 'Manual takeover'); f.orchestra.stop()
  const resumed = new ConversationOrchestrator(f.vault, f.driver); cleanups.push(() => resumed.stop())
  await Promise.all([resumed.start(), ...Array.from({ length: 10 }, () => resumed.pump())]); await resumed.pump()
  expect(f.driver.start).toHaveBeenCalledTimes(8)
  expect(resumed.snapshot('leader').paused).toContain(first.threadId)
  expect(resumed.snapshot('leader').tasks.find(task => task.id === first.id)).toMatchObject({ status: 'cancelled', dispatchPending: true })
  f.threads.get(first.threadId)!.turns![0].status = 'interrupted'
  await resumed.reconcile(); await resumed.pump()
  expect(f.driver.start).toHaveBeenCalledTimes(9)
  expect(resumed.snapshot('leader').tasks.filter(task => task.dispatchPending)).toHaveLength(8)
  expect(resumed.snapshot('leader').paused).toContain(first.threadId)
  expect(f.driver.interrupt).not.toHaveBeenCalled()
})

it('L1: failed compensation preserves cancellation and blocks recovery until exact settlement', async () => {
  const f = setup(), cap = f.token(), { task } = await f.delegate(cap), start = f.driver.start
  f.threads.get('leader')!.status = { type: 'active' }
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { entered = resolve })
  f.driver.start = async (...args) => { const id = await start(...args); entered(); await gate; return id }
  vi.mocked(f.driver.interrupt).mockRejectedValueOnce(Error('Uncertain interrupt'))
  await f.orchestra.start(); await ready
  f.orchestra.userTurn('worker', 'Preserve my instruction')
  const cancelled = f.orchestra.snapshot('leader').tasks[0]
  release(); await f.orchestra.pump()
  const resolve = () => f.orchestra.resolveTask('leader', f.vault.groupFor('leader')!.leaderEpoch, task.id, 'Recovery', 'Verified evidence')
  expect(resolve).toThrow(/settling/)
  expect(f.orchestra.snapshot('leader').tasks[0]).toMatchObject({ status: 'cancelled', result: cancelled.result, dispatchPending: true })
  expect(f.driver.interrupt).toHaveBeenCalledWith('worker', task.turnId, expect.any(Function))
  f.finish('worker', task.turnId!, 'Exact completion', 'interrupted')
  expect(resolve()).toMatchObject({ task: { status: 'cancelled', result: cancelled.result, dispatchPending: false } })
})

it('L1: late start reply from a stopped instance does not overwrite recovered state or interrupt user work', async () => {
  const f = setup(), { task } = await f.delegate(f.token()), start = f.driver.start
  f.threads.get('leader')!.status = { type: 'active' }
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { entered = resolve })
  f.driver.start = async (...args) => { const id = await start(...args); entered(); await gate; return id }
  await f.orchestra.start(); await ready; await f.orchestra.cancel(task.id); f.orchestra.stop()
  const original = f.threads.get('worker')!.turns![0]; original.status = 'interrupted'
  const recovered = new ConversationOrchestrator(f.vault, f.driver); cleanups.push(() => recovered.stop())
  await recovered.start(); await recovered.pump()
  recovered.resolveTask('leader', f.vault.groupFor('leader')!.leaderEpoch, task.id, 'Recovered after restart', 'Exact terminal')
  const path = join(f.root, '.state/Orchestration.json'), before = readFileSync(path, 'utf8')
  release(); await f.orchestra.pump()
  expect(readFileSync(path, 'utf8')).toBe(before)
  expect(f.driver.interrupt).not.toHaveBeenCalled()
})

it('CR2 inverse: the next completion evicts a recovery just recorded on the oldest retained task', async () => {
  const f = setup(), { task } = await f.delegate(f.token())
  const path = join(f.root, '.state/Orchestration.json'), state = JSON.parse(readFileSync(path, 'utf8'))
  const stale = '2026-01-01T00:00:00.000Z'
  // Normal retention layout: 200 terminal entries followed by unfinished work.
  state.tasks = Array.from({ length: 200 }, (_, i) => ({ ...task, id: `old-${i}`, status: i ? 'completed' : 'failed', updatedAt: stale, result: 'Original retained result' }))
  state.tasks.push({ ...task, id: 'busy', status: 'running', turnId: 'pending-finish' })
  writeFileSync(path, JSON.stringify(state))
  const recovered = new ConversationOrchestrator(f.vault, f.driver)
  cleanups.push(() => recovered.stop())
  recovered.resolveTask('leader', f.vault.groupFor('leader')!.leaderEpoch, 'old-0', 'Fresh verified recovery', 'Fixture check passed')
  expect(recovered.snapshot('leader').tasks.find(item => item.id === 'old-0')?.resolution?.summary).toBe('Fresh verified recovery')
  expect(recovered.snapshot('leader').tasks.find(item => item.id === 'busy')?.status).toBe('running')
  recovered.completed('worker', 'pending-finish', 'completed', 'Another task just finished')
  // Defect: slice(-200) drops the freshly updated record, retaining 199 stale ones.
  expect(recovered.snapshot('leader').tasks.some(item => item.id === 'old-0')).toBe(false)
  expect(recovered.snapshot('leader').tasks.find(item => item.id === 'busy')?.result).toBe('Another task just finished')
  expect(new ConversationOrchestrator(f.vault, f.driver).snapshot('leader').tasks.some(item => item.id === 'old-0')).toBe(false)
})
