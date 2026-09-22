import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { CodexAppServer } from './codex-app-server.js'
import { ContextVault } from './context-vault.js'
import { RemoteController } from './controller.js'
import type { ConversationTask } from './orchestration.js'
import type { RemoteConfig } from './config.js'

// CR3's 82b4367 inverse probes now assert acceptance at the actual native pipe.
// Exercise both same-object restart and replacement controller/orchestrator.
// Only this owned child, temporary Vault and synthetic identities are used.
const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop() })
const settings = { model: 'gpt-6-astra', effort: 'max', fullAccess: false }
const deferred = () => {
  let release!: () => void
  return { promise: new Promise<void>(resolve => { release = resolve }), release: () => release() }
}

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cr3-lifecycle-review-'))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  const native = join(root, 'native.mjs'), effectsPath = join(root, 'effects.jsonl')
  writeFileSync(effectsPath, '')
  writeFileSync(native, `
    import { createInterface } from 'node:readline';
    import { appendFileSync } from 'node:fs';
    createInterface({ input: process.stdin }).on('line', line => {
      const message = JSON.parse(line), p = message.params || {};
      const reply = result => process.stdout.write(JSON.stringify({ id: message.id, result }) + '\\n');
      if (message.method === 'initialized') return;
      if (['thread/start', 'thread/name/set', 'thread/archive', 'turn/start', 'turn/interrupt'].includes(message.method))
        appendFileSync(${JSON.stringify(effectsPath)}, JSON.stringify({ method: message.method, params: p }) + '\\n');
      if (message.method === 'turn/start') return process.stdout.write(JSON.stringify({ id: message.id,
        error: { code: -32601, message: 'Model turns forbidden by review fixture' } }) + '\\n');
      if (message.method === 'thread/start') return reply({ thread: { id: 'created-fixture', cwd: p.cwd, status: { type: 'idle' }, turns: [] } });
      if (message.method === 'thread/read' || message.method === 'thread/resume') return reply({ thread: {
        id: p.threadId, cwd: ${JSON.stringify(root)}, status: { type: p.threadId === 'leader' ? 'active' : 'idle' }, turns: [] } });
      return reply({});
    });
  `)
  const config: RemoteConfig = { host: '127.0.0.1', port: 0, publicOrigin: new URL('http://fixture.test'),
    password: 'synthetic-password-only', sessionSecret: 's'.repeat(48), sessionTtlSeconds: 600,
    codexBin: 'unused', workspaceRoots: [root], production: true }
  const vault = new ContextVault(join(root, 'vault')), group = vault.createGroup('Fixture').groups[0]
  vault.assignThread('leader', group.id); vault.setLeader(group.id, 'leader')
  const app = new CodexAppServer(process.execPath, [native])
  const controller = new RemoteController(config, app, vault), orchestra = controller.orchestration!
  cleanup.push(async () => {
    controller.stop()
    await vi.waitFor(() => expect(app.state).toBe('stopped'))
  })
  await app.start()
  vi.spyOn(controller, 'listModels').mockResolvedValue({ data: [{ model: settings.model,
    supportedReasoningEfforts: [{ reasoningEffort: settings.effort }] }] })
  const capability = orchestra.context('leader', settings, true).match(/--capability ([\w-]+)/)![1]
  const effects = () => readFileSync(effectsPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  const spawn = () => orchestra.command(capability, { action: 'spawn', requestId: 'owned-admission', title: 'Fixture', text: 'No actual work' }) as Promise<{ task: ConversationTask }>
  const restart = async (kind: 'same' | 'new') => {
    orchestra.stop()
    const current = kind === 'same' ? orchestra : new RemoteController(config, app, vault).orchestration!
    if (current !== orchestra) cleanup.push(() => current.stop())
    await current.start(); await current.pump()
    return current
  }
  return { root, vault, group, app, controller, orchestra, effects, spawn, restart, statePath: join(vault.root, '.state/Orchestration.json') }
}

// Independently observe the public cache behavior after a stale create. A cold
// access must reach metadata; silently adopting the reply would skip this read.
async function expectUnadopted(f: Awaited<ReturnType<typeof fixture>>) {
  const request = vi.spyOn(f.app, 'request').mockRejectedValueOnce(new Error('Owned cold metadata probe'))
  await expect(f.controller.assertThreadAccess('created-fixture')).rejects.toThrow('Owned cold metadata probe')
  const [method, params] = request.mock.calls.at(-1)!
  expect(method).toBe('thread/read'); expect(params).toMatchObject({ threadId: 'created-fixture' })
}

it.each(['startup', 'reply'])('L1 control: unchanged admission lifetime creates and names exactly once with delayed %s', async phase => {
  const f = await fixture(), gate = deferred(), entered = deferred()
  if (phase === 'startup') vi.spyOn(f.app, 'start').mockImplementationOnce(async () => { entered.release(); await gate.promise })
  else {
    const request = f.app.request.bind(f.app)
    vi.spyOn(f.app, 'request').mockImplementation(async (...args) => {
      const result = await request(...args)
      if (args[0] === 'thread/start') { entered.release(); await gate.promise }
      return result
    })
  }
  const pending = f.spawn()
  await entered.promise
  expect(f.effects().map(item => item.method)).toEqual(phase === 'startup' ? [] : ['thread/start'])
  gate.release()
  const { task } = await pending
  expect(task).toMatchObject({ status: 'queued', threadId: 'created-fixture' })
  expect(f.vault.groupFor('created-fixture')?.id).toBe(f.group.id)
  expect(f.effects().map(item => item.method)).toEqual(['thread/start', 'thread/name/set'])
})

it.each(['same', 'new'] as const)('L1 acceptance: stopped admission cannot dispatch after the real request startup await (%s instance)', async kind => {
  const f = await fixture(), gate = deferred(), entered = deferred()
  // Real CodexAppServer.request will await start, then invoke its optional
  // beforeDispatch hook and write to the actual owned fake-native stdin pipe.
  vi.spyOn(f.app, 'start').mockImplementationOnce(async () => { entered.release(); await gate.promise })
  const pending = f.spawn().then(value => ({ value }), error => ({ error }))
  await entered.promise
  expect(f.effects()).toEqual([])
  const current = await f.restart(kind)
  const task = current.snapshot('leader').tasks[0]
  current.resolveTask('leader', f.vault.groupFor('leader')!.leaderEpoch, task.id,
    'Admission stopped before the native effect', 'Fixture pipe log is empty')
  const before = readFileSync(f.statePath, 'utf8')
  const record = vi.spyOn(f.vault, 'recordThread'), assign = vi.spyOn(f.vault, 'assignThread')
  gate.release()
  expect(await pending).toMatchObject({ error: { status: 409 } })
  expect(readFileSync(f.statePath, 'utf8')).toBe(before)
  expect(f.effects()).toEqual([])
  expect(f.vault.groupFor('created-fixture')).toBeNull()
  expect(record).not.toHaveBeenCalled(); expect(assign).not.toHaveBeenCalled()
  expect(existsSync(join(f.vault.root, 'Conversations/created-fixture'))).toBe(false)
  expect(current.snapshot('leader').tasks[0]).toMatchObject({ threadId: '', status: 'interrupted',
    resolution: { summary: 'Admission stopped before the native effect' } })
  await expectUnadopted(f)
})

it.each(['same', 'new'] as const)('L1 acceptance: accepted create reply crossing restart preserves newer folder assignment (%s instance)', async kind => {
  const f = await fixture(), gate = deferred(), entered = deferred(), request = f.app.request.bind(f.app)
  vi.spyOn(f.app, 'request').mockImplementation(async (...args) => {
    const result = await request(...args)
    if (args[0] === 'thread/start') { entered.release(); await gate.promise }
    return result
  })
  const pending = f.spawn().then(value => ({ value }), error => ({ error }))
  await entered.promise
  expect(f.effects().map(item => item.method)).toEqual(['thread/start'])
  f.orchestra.stop()
  const other = f.vault.createGroup('New owner').groups.find(item => item.name === 'New owner')!
  f.vault.assignThread('created-fixture', other.id)
  const current = await f.restart(kind)
  expect(f.vault.groupFor('created-fixture')?.id).toBe(other.id)
  const recovered = current.snapshot('leader').tasks[0]
  current.resolveTask('leader', f.vault.groupFor('leader')!.leaderEpoch, recovered.id,
    'New recovery preserves the accepted native creation', 'Owned pipe confirms one create and no task turn')
  const before = readFileSync(f.statePath, 'utf8')
  const record = vi.spyOn(f.vault, 'recordThread'), assign = vi.spyOn(f.vault, 'assignThread')
  gate.release()
  expect(await pending).toMatchObject({ error: { status: 409 } })
  expect(readFileSync(f.statePath, 'utf8')).toBe(before)
  expect(f.effects().map(item => item.method)).toEqual(['thread/start']) // No replay or rename.
  // The native creation already happened legitimately; the stale subsequent
  // local assignment must not replace this newer user's ownership decision.
  expect(f.vault.groupFor('created-fixture')?.id).toBe(other.id)
  expect(record).not.toHaveBeenCalled(); expect(assign).not.toHaveBeenCalled()
  expect(current.snapshot('leader').tasks[0]).toMatchObject({ threadId: '', status: 'interrupted',
    resolution: { summary: 'New recovery preserves the accepted native creation' } })
  await expectUnadopted(f)
})

it('L1 control: direct creation without an admission callback preserves full access and local export', async () => {
  const f = await fixture()
  await expect(f.controller.createThread('0', true)).resolves.toMatchObject({ thread: { id: 'created-fixture' } })
  expect(f.effects()).toEqual([{ method: 'thread/start', params: expect.objectContaining({ sandbox: 'danger-full-access' }) }])
  expect(f.vault.groupFor('created-fixture')).toBeNull()
  expect(existsSync(join(f.vault.root, 'Conversations/created-fixture/Index.md'))).toBe(true)
})
