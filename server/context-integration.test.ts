import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it, vi } from 'vitest'
import { ContextVault } from './context-vault.js'
import { RemoteController } from './controller.js'
import { CodexAppServer } from './codex-app-server.js'
import { createRemoteHttpServer } from './http-app.js'
import { createSession, sessionCookieName } from './auth.js'
import type { RemoteConfig } from './config.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'remote-context-integration-'))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  const config: RemoteConfig = {
    host: '127.0.0.1', port: 5173, publicOrigin: new URL('http://127.0.0.1:5173'),
    password: 'a sufficiently long password', sessionSecret: 's'.repeat(48), sessionTtlSeconds: 600,
    codexBin: 'unused', workspaceRoots: ['/tmp'], production: true,
  }
  const app = new CodexAppServer('unused')
  const request = vi.spyOn(app, 'request').mockImplementation(async (method, params) => {
    const p = params as { threadId?: string; includeTurns?: boolean }
    if (method === 'thread/start') return { thread: { id: 'new-chat', cwd: '/tmp' } }
    if (method === 'thread/read' && p.includeTurns) throw new Error('list_turns is not supported')
    if (method === 'thread/resume' || method === 'thread/read') return { thread: { id: p.threadId, cwd: p.threadId === 'outside' ? '/outside' : '/tmp' } }
    if (method === 'turn/start') return { turn: { id: 'new-turn', status: 'inProgress' } }
    return {}
  })
  const vault = new ContextVault(root, () => controller.events.publish('codex', { method: 'conversation-groups/changed', params: {} }))
  const controller = new RemoteController(config, app, vault)
  return { root, config, app, request, vault, controller }
}

it('injects fresh shared and group context separately on every turn and preserves the original prompt', async () => {
  const { root, app, request, vault, controller } = setup()
  const group = vault.createGroup('Project').groups[0]
  writeFileSync(group.contextPath, 'Group decision A')
  await controller.createThread('0', false, group.id)
  const literal = '<html><script>example()</script></html>\n  preserve spacing'
  await controller.startTurn('new-chat', literal)
  const calls = request.mock.calls
  const injected = calls.find(([method]) => method === 'thread/inject_items')![1] as { items: Array<{ role: string; content: Array<{ text: string }> }> }
  expect(injected.items[0].role).toBe('developer')
  expect(injected.items[0].content[0].text).toContain('Group decision A')
  expect(calls.find(([method]) => method === 'turn/start')![1]).toMatchObject({
    cwd: '/tmp', input: [{ type: 'text', text: literal, text_elements: [] }],
    sandboxPolicy: { writableRoots: expect.arrayContaining(['/tmp', join(root, 'Profile'), join(root, 'Patterns'), join(root, 'Projects'), join(root, 'Ideas'), join(root, 'Decisions'), join(root, 'References'), join(root, 'Inbox'), join(root, 'Shared'), join(root, 'Conversations/new-chat'), join(root, 'Groups', group.id)]) },
  })
  expect(calls.findIndex(([method]) => method === 'thread/inject_items')).toBeLessThan(calls.findIndex(([method]) => method === 'turn/start'))
  vault.assignThread('new-chat', null)
  writeFileSync(join(root, 'Shared/Context.md'), 'Updated common fact')
  app.emit('notification', { method: 'turn/completed', params: { threadId: 'new-chat', turn: { id: 'new-turn', status: 'completed' } } })
  request.mockClear()
  await controller.startTurn('new-chat', 'Next')
  const next = JSON.stringify(request.mock.calls.find(([method]) => method === 'thread/inject_items')![1])
  expect(next).toContain('Updated common fact')
  expect(next).not.toContain('Group decision A')
  expect(request.mock.calls.filter(([method]) => method === 'thread/resume')).toHaveLength(0)
})

it('exports complete live messages even when native full history is unavailable', async () => {
  const { root, app, controller } = setup()
  await controller.createThread('0')
  const answer = 'long reply '.repeat(1000)
  for (const item of [
    { id: 'u', type: 'userMessage', content: [{ type: 'text', text: 'A question' }] },
    { id: 'a', type: 'agentMessage', text: answer, phase: 'final_answer' },
    { id: 'secret', type: 'commandExecution', output: 'SECRET_TOOL_OUTPUT' },
  ]) app.emit('notification', { method: 'item/completed', params: { threadId: 'new-chat', turnId: 'turn', item } })
  app.emit('notification', { method: 'turn/completed', params: { threadId: 'new-chat', turn: { id: 'turn', status: 'completed' } } })
  const exported = readFileSync(join(root, 'Conversations/new-chat/Turns/turn.md'), 'utf8')
  expect(exported).toContain(answer)
  expect(exported).toContain('A question')
  expect(exported).toContain('Status: completed')
  expect(exported).not.toContain('SECRET_TOOL_OUTPUT')
})

it('rejects an unknown folder before creating a conversation and stops a turn if injection fails', async () => {
  const { request, controller } = setup()
  await expect(controller.createThread('0', false, 'missing')).rejects.toThrow('folder not found')
  expect(request).not.toHaveBeenCalled()
  await controller.createThread('0')
  request.mockClear()
  request.mockRejectedValueOnce(new Error('Injection unavailable'))
  await expect(controller.startTurn('new-chat', 'Prompt')).rejects.toThrow('Injection unavailable')
  expect(request.mock.calls.map(([method]) => method)).toEqual(['thread/inject_items'])
})

it('shares folder state between authenticated sessions, protects mutations, and preserves context on removal', async () => {
  const { root, config, controller, vault } = setup()
  const server = createRemoteHttpServer(config, controller, root, null)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  config.publicOrigin = new URL(origin)
  cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())))
  const one = createSession(config.sessionSecret, 600, config.password), two = createSession(config.sessionSecret, 600, config.password)
  const send = (path: string, method = 'GET', body?: unknown, session = one, csrf = true) => fetch(origin + path, {
    method, headers: { Origin: origin, Cookie: `${sessionCookieName(config.publicOrigin.protocol === 'https:')}=${session.token}`, 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': session.payload.csrf } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  expect((await fetch(origin + '/api/conversation-groups')).status).toBe(401)
  expect((await send('/api/conversation-groups', 'POST', { name: 'Project' }, one, false)).status).toBe(403)
  const created = await send('/api/conversation-groups', 'POST', { name: 'Project' })
  expect(created.status).toBe(201)
  const group = (await created.json()).groups[0]
  expect((await send('/api/conversation-groups', 'GET', undefined, two)).status).toBe(200)
  expect((await send('/api/threads/chat/group', 'PUT', { groupId: group.id })).status).toBe(200)
  expect((await (await send('/api/conversation-groups', 'GET', undefined, two)).json()).assignments.chat).toBe(group.id)
  expect((await send('/api/threads/chat/group', 'PUT', { groupId: 'missing' })).status).toBe(404)
  expect(vault.groupFor('chat')?.id).toBe(group.id)
  expect((await send('/api/threads/outside/group', 'PUT', { groupId: group.id })).status).toBe(500)
  expect(vault.snapshot().assignments.outside).toBeUndefined()
  expect((await send(`/api/conversation-groups/${group.id}`, 'PATCH', { name: 'Delivery' })).status).toBe(200)
  writeFileSync(group.contextPath, 'Preserve decisions')
  expect((await send('/api/files/content?path=' + encodeURIComponent(group.contextPath))).status).toBe(200)
  const removed = await send(`/api/conversation-groups/${group.id}`, 'DELETE')
  expect((await removed.json()).assignments).toEqual({})
  expect(readFileSync(group.contextPath, 'utf8')).toBe('Preserve decisions')
})

it('captures current folder, explicit name and current leader at completion without transcript previews', async () => {
  const { vault, controller, app } = setup()
  const first = vault.createGroup('Group A').groups[0]
  await controller.createThread('0', false, first.id)
  await controller.renameThread('new-chat', 'Named leader')
  vault.setLeader(first.id, 'new-chat')
  controller.onTurnCompleted = vi.fn()
  const complete = (turnId: string) => app.emit('notification', { method: 'turn/completed', params: {
    threadId: 'new-chat', turn: { id: turnId, status: 'completed', items: [{ type: 'agentMessage', text: 'PRIVATE ANSWER' }] },
  } })
  complete('leader-turn')
  expect(controller.onTurnCompleted).toHaveBeenLastCalledWith('new-chat', 'leader-turn', 'PRIVATE ANSWER', {
    threadName: 'Named leader', groupName: 'Group A', isLeader: true, outcome: 'completed',
  })
  vault.setLeader(first.id, null)
  app.emit('notification', { method: 'thread/name/updated', params: { threadId: 'new-chat', threadName: 'Renamed worker' } })
  complete('worker-turn')
  expect(controller.onTurnCompleted).toHaveBeenLastCalledWith('new-chat', 'worker-turn', 'PRIVATE ANSWER', {
    threadName: 'Renamed worker', groupName: 'Group A', isLeader: false, outcome: 'completed',
  })
  vault.assignThread('new-chat', null)
  app.emit('notification', { method: 'thread/name/updated', params: { threadId: 'new-chat', threadName: null } })
  complete('solo-turn')
  expect(controller.onTurnCompleted).toHaveBeenLastCalledWith('new-chat', 'solo-turn', 'PRIVATE ANSWER', {
    threadName: null, groupName: undefined, isLeader: false, outcome: 'completed',
  })
  await controller.archiveThread('new-chat')
  const calls = vi.mocked(controller.onTurnCompleted!).mock.calls.length
  complete('archived-turn')
  expect(controller.onTurnCompleted).toHaveBeenCalledTimes(calls)
})
