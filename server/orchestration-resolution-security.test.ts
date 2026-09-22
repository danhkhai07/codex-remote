import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it, vi } from 'vitest'
import { createSession } from './auth.js'
import { CodexAppServer } from './codex-app-server.js'
import { ContextVault, ContextVaultError } from './context-vault.js'
import { RemoteController } from './controller.js'
import { createRemoteHttpServer } from './http-app.js'
import { SecureTransport } from './secure-client.js'
import { randomId } from './secure-wire.js'
import type { RemoteConfig } from './config.js'
import type { ConversationTask } from './orchestration.js'

const cleanups: Array<() => void | Promise<unknown>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const settings = { model: 'gpt-6-astra', effort: 'max', fullAccess: false }
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'resolution-security-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const files = join(root, 'files'); await mkdir(files)
  const material = { version: 1, app: randomId(), generation: randomId(), key: randomId(32) }, keyFile = join(root, 'owner.json')
  await writeFile(keyFile, JSON.stringify(material), { mode: 0o600 })
  const config: RemoteConfig = { host: '127.0.0.1', port: 0, publicOrigin: new URL('http://localhost'),
    password: 'FAKE resolution password', sessionSecret: 'fake-resolution-secret'.repeat(3), sessionTtlSeconds: 600,
    codexBin: 'UNUSED', production: true, workspaceRoots: [files], fileRoots: [files], secureApiRequired: true,
    secureKeyFile: keyFile, sessionStateFile: join(root, 'sessions.json') }
  const vault = new ContextVault(join(root, 'vault')), group = vault.createGroup('Fixture').groups[0]
  for (const id of ['leader', 'worker']) vault.assignThread(id, group.id)
  vault.setLeader(group.id, 'leader')
  const app = new CodexAppServer('UNUSED'), rpc = vi.spyOn(app, 'request').mockImplementation(async (method, params, _timeout, live) => {
    live?.()
    if (method === 'model/list') return { data: [{ model: settings.model, supportedReasoningEfforts: [{ reasoningEffort: settings.effort }] }] }
    if (method === 'thread/read') return { thread: { id: (params as { threadId: string }).threadId, cwd: files, status: { type: 'idle' }, turns: [] } }
    throw Error(`Unexpected fake RPC: ${method}`)
  })
  const controller = new RemoteController(config, app, vault)
  cleanups.push(() => controller.stop())
  const orchestra = controller.orchestration!, token = orchestra.context('leader', settings, true).match(/--capability ([\w-]+)/)![1]
  const { task } = await orchestra.command(token, { action: 'delegate', requestId: 'fixture', threadId: 'worker', title: 'Fixture only', text: 'No model turns' }) as { task: ConversationTask }
  await orchestra.cancel(task.id, 'Original unsuccessful attempt')
  const recovery = { action: 'resolve', taskId: task.id, leaderEpoch: vault.groupFor('leader')!.leaderEpoch, summary: 'Recovery verified', evidence: 'FAKE verification evidence' }
  const server = createRemoteHttpServer(config, controller, root, null)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  config.publicOrigin = new URL('http://127.0.0.1:' + (server.address() as AddressInfo).port)
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const issued = createSession(config.sessionSecret, 600, config.password)
  const headers = { Cookie: 'codex_remote_session=' + issued.token, Origin: config.publicOrigin.origin }
  const client = new SecureTransport(fetch, config.publicOrigin.origin, headers)
  cleanups.push(() => client.lock())
  await client.unlock(material.key)
  const call = async (body = recovery, csrf = issued.payload.csrf, id = 'leader') => (await client.request(`/api/threads/${id}/orchestration`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body),
  })).response
  return { config, controller, orchestra, vault, client, issued, recovery, call, keyFile, material, headers, rpc }
}

it('resolves through encrypted HTTP only with current Code leader, access, CSRF and epoch checks', async () => {
  const f = await fixture(), path = '/api/threads/leader/orchestration'
  expect((await fetch(f.config.publicOrigin.origin + path, { method: 'POST', headers: { ...f.headers, 'content-type': 'application/json', 'x-csrf-token': f.issued.payload.csrf }, body: JSON.stringify(f.recovery) })).status).toBe(403)
  expect((await f.call(f.recovery, 'wrong')).status).toBe(403)
  expect((await f.call(f.recovery, undefined, 'worker')).status).toBe(403)
  expect((await f.call({ ...f.recovery, leaderEpoch: -1 })).status).toBe(409)
  const access = vi.spyOn(f.controller, 'assertThreadAccess').mockRejectedValueOnce(new ContextVaultError(403, 'Outside allowed workspace'))
  expect((await f.call()).status).toBe(403); access.mockRestore()
  f.orchestra.context('leader', { ...settings, mode: 'plan' }, true)
  expect((await f.call()).status).toBe(403)
  f.orchestra.context('leader', settings, true)
  const before = f.orchestra.snapshot('leader')
  const response = await f.call()
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ tasks: [{ status: 'cancelled', result: 'Original unsuccessful attempt', resolution: { summary: f.recovery.summary, evidence: f.recovery.evidence, resolvedBy: 'leader' } }] })
  expect((await f.call()).status).toBe(200)
  expect((await f.call({ ...f.recovery, summary: 'Conflicting outcome' })).status).toBe(409)
  const reread = await (await f.client.request(path)).response.json()
  expect(reread.tasks).toEqual(f.orchestra.snapshot('leader').tasks)
  expect(reread.pendingResults).toBe(before.pendingResults)
  expect(f.rpc.mock.calls.every(([method]) => ['model/list', 'thread/read'].includes(method))).toBe(true)
})

it.each(['logout', 'expiry', 'rotation'] as const)('never resolves after %s while encrypted thread access is awaiting', async reason => {
  const f = await fixture()
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { entered = resolve })
  vi.spyOn(f.controller, 'assertThreadAccess').mockImplementation(async () => { entered(); await gate })
  const resolve = vi.spyOn(f.orchestra, 'resolveTask'), before = f.orchestra.snapshot('leader')
  const pending = f.call().catch(() => null)
  await ready
  if (reason === 'logout') {
    const result = await f.client.request('/api/session/logout', { method: 'POST', headers: { 'x-csrf-token': f.issued.payload.csrf } })
    await result.response.arrayBuffer()
  } else if (reason === 'expiry') vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 601_000)
  else await writeFile(f.keyFile, JSON.stringify({ ...f.material, generation: randomId(), key: randomId(32) }))
  release(); await pending; await new Promise(resolve => setImmediate(resolve))
  expect(resolve).not.toHaveBeenCalled()
  expect(f.orchestra.snapshot('leader')).toEqual(before)
})

it.each(['leader-replaced', 'epoch-roundtrip', 'plan-mode'] as const)('CR2: rejects %s changed during encrypted access and still permits a fresh authorized retry', async reason => {
  const f = await fixture()
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { entered = resolve })
  const access = vi.spyOn(f.controller, 'assertThreadAccess').mockImplementationOnce(async () => { entered(); await gate })
  const pending = f.call(); await ready
  if (reason === 'plan-mode') f.orchestra.context('leader', { ...settings, mode: 'plan' }, true)
  else { f.vault.setLeader(f.vault.groupFor('leader')!.id, 'worker'); if (reason === 'epoch-roundtrip') f.vault.setLeader(f.vault.groupFor('leader')!.id, 'leader') }
  release()
  expect((await pending).status).toBe(reason === 'epoch-roundtrip' ? 409 : 403)
  expect(f.orchestra.snapshot('leader').tasks[0].resolution).toBeUndefined()
  access.mockRestore()
  if (reason === 'leader-replaced') f.vault.setLeader(f.vault.groupFor('leader')!.id, 'leader')
  f.orchestra.context('leader', settings, true)
  const current = { ...f.recovery, leaderEpoch: f.vault.groupFor('leader')!.leaderEpoch }
  expect((await f.call(current)).status).toBe(200)
  expect((await f.call(current)).status).toBe(200)
  expect(f.orchestra.snapshot('leader').tasks[0]).toMatchObject({ status: 'cancelled', result: 'Original unsuccessful attempt', resolution: { summary: current.summary, leaderEpoch: current.leaderEpoch } })
  expect(f.rpc.mock.calls.every(([method]) => ['model/list', 'thread/read'].includes(method))).toBe(true)
})
