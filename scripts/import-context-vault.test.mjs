import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContextVault } from '../server/context-vault.ts'
import { importThreads, parseOptions, readRollout } from './import-context-vault.mjs'

let directory
let codexHome
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'context-import-'))
  codexHome = join(directory, 'codex')
  await mkdir(join(codexHome, 'sessions'), { recursive: true })
  await mkdir(join(codexHome, 'archived_sessions'))
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

const row = (type, payload) => ({ type, payload })
const event = (type, fields) => row('event_msg', { type, ...fields })
const message = (role, text, id) => row('response_item', { type: 'message', role, id, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }] })
const canonical = (type, text, id, turnId = 'turn-1') => event('item_completed', {
  turn_id: turnId, item: { type, id, content: [{ type: type === 'UserMessage' ? 'text' : 'Text', text }] },
})
const rpcTurn = (text = 'Assistant reply') => ({ id: 'turn-1', status: 'completed', items: [{ id: 'assistant-1', type: 'agentMessage', text }] })
async function rollout(id, rows, archived = false) {
  const path = join(codexHome, archived ? 'archived_sessions' : 'sessions', `${id}.jsonl`)
  await writeFile(path, [row('session_meta', { id, cwd: '/workspace' }), ...rows]
    .map(value => typeof value === 'string' ? value : JSON.stringify(value)).join('\n') + '\n')
  return { id, cwd: '/workspace', path }
}
function rpcApp(threads, read) {
  return { request: vi.fn(async (method, params) => {
    if (method === 'thread/list') return { data: params.archived ? [] : threads, nextCursor: null }
    if (method === 'thread/read') return await read(params.threadId)
    throw new Error(`Unexpected RPC: ${method}`)
  }) }
}
const options = (app, vault, extra = {}) => ({ app, vault, workspaceRoots: ['/workspace'], codexHome, ...extra })

describe('context vault importer', () => {
  it('paginates active and archived conversations, exports each allowed ID once, and only reads RPCs', async () => {
    const t1 = { id: 'active-1', cwd: '/workspace' }
    const t2 = { id: 'active-2', cwd: '/workspace' }
    const t3 = { id: 'archived-1', cwd: '/workspace' }
    const app = { request: vi.fn(async (method, params) => {
      if (method === 'thread/list') {
        if (params.archived) return { data: [t2, t3], nextCursor: null }
        if (params.cursor) return { data: [t2], nextCursor: null }
        return { data: [t1, { id: 'outside', cwd: '/outside' }], nextCursor: 'next-active' }
      }
      if (method === 'thread/read') return { thread: { id: params.threadId, cwd: '/workspace', turns: [rpcTurn()] } }
      throw new Error('Importer must never start a model turn')
    }) }
    const vault = { recordThread: vi.fn() }
    const snapshots = []
    const result = await importThreads(options(app, vault, { saveStatus: state => { snapshots.push(structuredClone(state)) } }))
    expect(result).toMatchObject({ state: 'complete', listed: 3, imported: 3, fromRpc: 3, skippedDisallowed: 1, failedThreads: [], listFailures: [] })
    expect(app.request.mock.calls.filter(([method]) => method === 'thread/list').map(([, params]) => [params.archived, params.cursor]))
      .toEqual([[false, undefined], [false, 'next-active'], [true, undefined]])
    expect(vault.recordThread.mock.calls.map(([thread]) => [thread.id, thread.archived])).toEqual([
      ['active-1', false], ['active-2', false], ['archived-1', true],
    ])
    expect(app.request.mock.calls.every(([method]) => ['thread/list', 'thread/read'].includes(method))).toBe(true)
    expect(snapshots[0].state).toBe('running')
    expect(snapshots.at(-1).state).toBe('complete')
    expect(JSON.stringify(snapshots)).not.toContain('Assistant reply')
  })

  it('exports verified user/assistant messages without duplicate response records, developer text or tool output', async () => {
    const thread = await rollout('verified', [
      event('task_started', { turn_id: 'turn-1' }),
      message('user', 'Generated user context'),
      canonical('UserMessage', 'Actual user request', 'user-1'),
      canonical('AgentMessage', 'Actual answer', 'assistant-1'),
      message('assistant', 'Actual answer', 'assistant-1'),
      message('developer', 'PRIVATE DEVELOPER'),
      message('system', 'PRIVATE SYSTEM'),
      event('item_completed', { turn_id: 'turn-1', item: { id: 'tool-1', type: 'CommandExecution', stdout: 'PRIVATE TOOL' } }),
      row('response_item', { type: 'function_call_output', output: 'PRIVATE FUNCTION OUTPUT' }),
      row('response_item', { type: 'reasoning', summary: 'PRIVATE REASONING' }),
      row('compacted', { message: 'PRIVATE COMPACTION' }),
      event('task_complete', { turn_id: 'turn-1' }),
      event('task_started', { turn_id: 'turn-2' }),
      message('user', 'Legacy user', 'user-2'),
      message('assistant', 'Legacy answer', 'assistant-2'),
      event('turn_aborted', { turn_id: 'turn-2' }),
    ], true)
    const result = await readRollout(thread, codexHome)
    expect(result).toMatchObject({ unsupportedMessages: 0, malformedLines: 0 })
    expect(result.turns.map(turn => turn.status)).toEqual(['completed', 'interrupted'])
    expect(result.turns.map(turn => turn.items.map(item => item.id))).toEqual([['user-1', 'assistant-1'], ['user-2', 'assistant-2']])
    expect(result.turns[0].items[0].content).toEqual([{ type: 'text', text: 'Actual user request' }])
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
    expect(JSON.stringify(result)).not.toContain('Generated user context')
  })

  it('rejects a mismatched session or workspace and a rollout symlink outside session storage', async () => {
    const thread = await rollout('correct', [event('task_started', { turn_id: 'turn-1' }), canonical('UserMessage', 'User', 'u1')])
    await expect(readRollout({ ...thread, id: 'wrong' }, codexHome)).rejects.toThrow('session-mismatch')
    await expect(readRollout({ ...thread, cwd: '/outside' }, codexHome)).rejects.toThrow('session-mismatch')
    const outside = join(directory, 'outside.jsonl')
    await writeFile(outside, await readFile(thread.path))
    const link = join(codexHome, 'sessions', 'linked.jsonl')
    await symlink(outside, link)
    await expect(readRollout({ ...thread, path: link }, codexHome)).rejects.toThrow('outside-session-storage')
    await expect(readRollout({ ...thread, path: '../relative.jsonl' }, codexHome)).rejects.toThrow('path-unavailable')
  })

  it('reports partial and unavailable history while retaining available text and metadata', async () => {
    const partial = await rollout('partial', [
      message('user', 'User with no known turn'),
      event('task_started', { turn_id: 'turn-1' }),
      canonical('UserMessage', 'Available request', 'u1'),
      '{incomplete-json',
    ])
    const unavailable = { id: 'unavailable', cwd: '/workspace' }
    const app = rpcApp([partial, unavailable], async () => { throw new Error('PRIVATE RPC ERROR') })
    const vault = { recordThread: vi.fn() }
    const result = await importThreads(options(app, vault))
    expect(result).toMatchObject({ state: 'partial', imported: 2, fromRollout: 1, metadataOnly: 1 })
    expect(result.failedThreads).toEqual([{ id: 'partial', code: 'history-partial' }, { id: 'unavailable', code: 'history-unavailable' }])
    expect(vault.recordThread.mock.calls[0][0]).toMatchObject({ historyUnavailable: true, historyCacheTruncated: true, turns: [{ items: [{ content: [{ text: 'Available request' }] }] }] })
    expect(vault.recordThread.mock.calls[1][0]).toMatchObject({ id: 'unavailable', turns: [], historyUnavailable: true })
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|Available request|User with no known turn/)
  })

  it('keeps repeated imports and a later native history read free of duplicate canonical or fallback messages', async () => {
    const thread = await rollout('repeated', [
      event('task_started', { turn_id: 'turn-1' }),
      canonical('UserMessage', 'User request', 'canonical-user'),
      canonical('AgentMessage', 'Assistant reply', undefined),
      message('assistant', 'Assistant reply'),
      event('task_complete', { turn_id: 'turn-1' }),
    ])
    const vaultPath = join(directory, 'vault')
    const vault = new ContextVault(vaultPath)
    const app = rpcApp([thread], async () => { throw new Error('Persisted history unavailable') })
    for (let index = 0; index < 2; index++) expect((await importThreads(options(app, vault))).state).toBe('complete')
    const native = rpcApp([thread], async () => ({ thread: { ...thread, turns: [{ id: 'turn-1', status: 'completed', items: [
      { id: 'canonical-user', type: 'userMessage', content: [{ type: 'text', text: 'User request' }] },
      { id: 'native-assistant', type: 'agentMessage', text: 'Assistant reply' },
    ] }] } }))
    for (let index = 0; index < 2; index++) expect((await importThreads(options(native, vault))).state).toBe('complete')
    const stored = JSON.parse(await readFile(join(vaultPath, '.state', 'Conversations', thread.id, 'Turns', 'turn-1.json'), 'utf8'))
    expect(stored.messages.map(item => [item.id, item.role, item.text])).toEqual([
      ['canonical-user', 'User', 'User request'], ['native-assistant', 'Assistant', 'Assistant reply'],
    ])
    const markdown = await readFile(join(vaultPath, 'Conversations', thread.id, 'Turns', 'turn-1.md'), 'utf8')
    expect(markdown.match(/^## User$/gm)).toHaveLength(1)
    expect(markdown.match(/^## Assistant$/gm)).toHaveLength(1)
  })

  it('honors a limit and stops repeated cursors instead of falsely reporting completion', async () => {
    const app = rpcApp([{ id: 'one', cwd: '/workspace' }, { id: 'two', cwd: '/workspace' }], async id => ({ thread: { id, cwd: '/workspace', turns: [rpcTurn()] } }))
    const limited = await importThreads(options(app, { recordThread() {} }, { limit: 1 }))
    expect(limited).toMatchObject({ state: 'limited', listed: 1, imported: 1, limited: true })
    expect(app.request.mock.calls.some(([method, params]) => method === 'thread/list' && params.archived)).toBe(false)
    const repeated = { request: vi.fn(async () => ({ data: [], nextCursor: 'same' })) }
    const result = await importThreads(options(repeated, { recordThread() {} }))
    expect(result.state).toBe('partial')
    expect(result.listFailures).toEqual([
      { archived: false, code: 'repeated-pagination-cursor' }, { archived: true, code: 'repeated-pagination-cursor' },
    ])
    expect(repeated.request).toHaveBeenCalledTimes(4)
  })

  it('reports list and write failures without exposing raw errors', async () => {
    const app = { request: vi.fn(async (method, params) => {
      if (method === 'thread/list' && params.archived) throw new Error('PRIVATE LIST ERROR')
      if (method === 'thread/list') return { data: [{ id: 'one', cwd: '/workspace' }] }
      return { thread: { id: 'one', cwd: '/workspace', turns: [rpcTurn()] } }
    }) }
    const result = await importThreads(options(app, { recordThread() { throw new Error('PRIVATE WRITE ERROR') } }))
    expect(result).toMatchObject({ state: 'partial', imported: 0, failedThreads: [{ id: 'one', code: 'vault-write-failed' }], listFailures: [{ archived: true, code: 'thread-list-failed' }] })
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
  })

  it('rejects invalid limits and relative vault paths before starting an import', () => {
    expect(parseOptions(['--limit', '2', '--vault', '/absolute/vault'])).toEqual({ limit: 2, vault: '/absolute/vault', help: false })
    expect(() => parseOptions(['--limit', '0'])).toThrow('positive integer')
    expect(() => parseOptions(['--limit', '1.5'])).toThrow('positive integer')
    expect(() => parseOptions(['--vault', 'relative'])).toThrow('absolute path')
  })
})
