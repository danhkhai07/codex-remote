import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ContextVault, ContextVaultError } from './context-vault.js'

const directories: string[] = []
function setup() {
  const parent = mkdtempSync(join(tmpdir(), 'context-vault-test-'))
  directories.push(parent)
  const root = join(parent, 'Codex-Context')
  const changed = vi.fn()
  return { parent, root, changed, vault: new ContextVault(root, changed) }
}
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { force: true, recursive: true }) })
const user = (id: string, text: string) => ({ id, type: 'userMessage', content: [{ type: 'text', text }] })
const assistant = (id: string, text: string) => ({ id, type: 'agentMessage', text })

it('persists groups and assignments, publishes only effective grouping changes, and preserves human notes', () => {
  const { root, vault, changed } = setup()
  const first = vault.createGroup('Khách hàng')
  const group = first.groups[0]
  writeFileSync(group.contextPath, 'Keep these carefully written notes.\n')
  writeFileSync(join(root, 'Shared', 'Context.md'), 'User shared notes.\n')
  expect(vault.assignThread('thread-a', group.id).revision).toBe(2)
  expect(vault.assignThread('thread-a', group.id).revision).toBe(2)
  vault.recordThread({ id: 'thread-a', name: 'Project A', cwd: '/root/project' })
  expect(changed).toHaveBeenCalledTimes(2)
  expect(vault.renameGroup(group.id, 'Delivery').groups[0].contextPath).toBe(group.contextPath)
  expect(vault.renameGroup(group.id, 'Delivery').revision).toBe(3)
  const restored = new ContextVault(root)
  expect(restored.snapshot()).toEqual(vault.snapshot())
  expect(readFileSync(group.contextPath, 'utf8')).toBe('Keep these carefully written notes.\n')
  expect(readFileSync(join(root, 'Shared', 'Context.md'), 'utf8')).toBe('User shared notes.\n')
  expect(readFileSync(join(root, 'Index.md'), 'utf8')).toContain('Project A')
  expect(readFileSync(join(root, 'Groups', group.id, 'Index.md'), 'utf8')).toContain('thread-a')
})

it('reassigns and deletes groups without deleting context or any conversation history', () => {
  const { root, vault } = setup()
  const a = vault.createGroup('A').groups[0]
  const b = vault.createGroup('B').groups[1]
  vault.assignThread('chat', a.id)
  vault.recordThread({ id: 'chat', turns: [{ id: 'turn-one', status: 'completed', items: [user('u1', 'Question'), assistant('a1', 'Answer')] }] })
  writeFileSync(a.contextPath, 'Preserve after deletion')
  vault.assignThread('chat', b.id)
  expect(readFileSync(join(root, 'Groups', a.id, 'Index.md'), 'utf8')).not.toContain('(chat)')
  expect(readFileSync(join(root, 'Groups', b.id, 'Index.md'), 'utf8')).toContain('(chat)')
  vault.deleteGroup(a.id)
  expect(readFileSync(a.contextPath, 'utf8')).toBe('Preserve after deletion')
  vault.deleteGroup(b.id)
  expect(vault.snapshot().assignments).toEqual({})
  expect(vault.groupFor('chat')).toBeNull()
  expect(readFileSync(join(root, 'Conversations', 'chat', 'Turns', 'turn-one.md'), 'utf8')).toContain('Answer')
  expect(readFileSync(b.contextPath, 'utf8')).toContain('Group Context')
})

it('rejects invalid names, traversal IDs, and symlinks without writing outside the vault', () => {
  const { root, parent, vault } = setup()
  for (const name of ['', ' ', '../escape', 'a/b', 'a\\b', 'x\ny', '.', '..', 'x'.repeat(121), null]) expect(() => vault.createGroup(name)).toThrow(ContextVaultError)
  for (const id of ['../escape', 'foo/bar', '..', '__proto__', 'constructor']) {
    expect(() => vault.assignThread(id, null)).toThrow(ContextVaultError)
    expect(() => vault.contextFor(id)).toThrow(ContextVaultError)
    expect(() => vault.recordThread({ id })).toThrow(ContextVaultError)
  }
  const group = vault.createGroup('A').groups[0]
  expect(() => vault.createGroup('a')).toThrow(/already exists/)
  expect(() => vault.assignThread('chat', 'missing')).toThrow(/not found/)
  const external = join(parent, 'external.md')
  writeFileSync(external, 'Never touch this')
  rmSync(join(root, 'Shared', 'Context.md'))
  symlinkSync(external, join(root, 'Shared', 'Context.md'))
  expect(() => vault.contextFor('chat')).toThrow(/symbolic links/)
  expect(() => new ContextVault(root)).toThrow(/symbolic links/)
  expect(readFileSync(external, 'utf8')).toBe('Never touch this')
  rmSync(join(root, 'Groups', group.id), { recursive: true })
  symlinkSync(parent, join(root, 'Groups', group.id))
  expect(() => vault.renameGroup(group.id, 'B')).toThrow(/symbolic links/)
})

it('preserves full history during later partial reads and excludes tools and developer context', () => {
  const { root, vault, changed } = setup()
  const fullText = 'A complete detailed answer, with its original beginning and ending.'
  const first = { id: 'turn-first', status: 'completed', items: [{ type: 'developerMessage', text: 'Private duplicate context' }, user('user-first', 'Question'), assistant('answer-first', fullText), { type: 'commandExecution', output: 'TOOL_SECRET' }] }
  vault.recordThread({ id: 'chat', turns: [first, { id: 'turn-second', status: 'completed', items: [user('user-second', 'Follow-up'), assistant('answer-second', 'Second answer')] }] })
  const file = join(root, 'Conversations', 'chat', 'Turns', 'turn-first.md')
  const content = readFileSync(file, 'utf8'), modified = lstatSync(file).mtimeMs
  expect(content).toContain(fullText)
  expect(content).toContain('Question')
  expect(content).not.toContain('Private duplicate context')
  expect(content).not.toContain('TOOL_SECRET')
  vault.recordThread({ id: 'chat', historyCacheTruncated: true, turns: [{ id: 'turn-first', status: 'inProgress', items: [assistant('answer-first', 'ending.')] }] })
  vault.recordThread({ id: 'chat', turns: [] })
  expect(readFileSync(file, 'utf8')).toBe(content)
  expect(lstatSync(file).mtimeMs).toBe(modified)
  expect(readFileSync(join(root, 'Conversations', 'chat', 'Index.md'), 'utf8')).toContain('turn-second')
  expect(readdirSync(join(root, 'Conversations', 'chat', 'Turns'))).toHaveLength(2)
  expect(changed).not.toHaveBeenCalled()
})

it('recovers earlier turns from a later full read and extends a streamed response without duplicates', () => {
  const { root, vault } = setup()
  vault.recordThread({ id: 'chat', turns: [{ id: 'new', status: 'inProgress', items: [{ type: 'userMessage', content: [{ type: 'text', text: 'Question' }] }, assistant('a', 'Partial')] }] })
  vault.recordThread({ id: 'chat', turns: [{ id: 'old', status: 'completed', items: [assistant('old-answer', 'Earlier answer')] }, { id: 'new', status: 'completed', items: [user('canonical-user', 'Question'), assistant('a', 'Partial becomes complete')] }] })
  const index = readFileSync(join(root, 'Conversations', 'chat', 'Index.md'), 'utf8')
  expect(index.indexOf('[old]')).toBeLessThan(index.indexOf('[new]'))
  const content = readFileSync(join(root, 'Conversations', 'chat', 'Turns', 'new.md'), 'utf8')
  expect(content.match(/## User/g)).toHaveLength(1)
  expect(content).toContain('Partial becomes complete')
  expect(content).toContain('Status: completed')
})

it('provides actual bounded notes with correct shared/group/own paths and scoped writable roots', () => {
  const { root, vault } = setup()
  const a = vault.createGroup('Alpha').groups[0], b = vault.createGroup('Beta').groups[1]
  vault.assignThread('chat', a.id)
  writeFileSync(join(root, 'Shared', 'Context.md'), 'Global policy. ' + '🦊'.repeat(8_000))
  writeFileSync(a.contextPath, 'Alpha decisions.')
  writeFileSync(b.contextPath, 'Beta private working notes.')
  writeFileSync(join(root, 'Conversations', 'chat', 'Context.md'), 'Own handoff.')
  const instructions = vault.contextFor('chat')
  expect(instructions).toContain(join(root, 'README.md'))
  expect(instructions).toContain(join(root, 'Index.md'))
  expect(instructions).toContain(a.contextPath)
  expect(instructions).toContain('Global policy.')
  expect(instructions).toContain('Alpha decisions.')
  expect(instructions).toContain('Own handoff.')
  expect(instructions).toContain('Excerpt capped')
  expect(instructions).not.toContain('\ufffd')
  expect(instructions).not.toContain('Beta private working notes.')
  expect(Buffer.byteLength(instructions)).toBeLessThan(28_000)
  expect(vault.writableRoots('chat')).toEqual([join(root, 'Shared'), join(root, 'Conversations', 'chat'), join(root, 'Groups', a.id)])
  vault.assignThread('chat', null)
  expect(vault.contextFor('chat')).not.toContain('Alpha decisions.')
  expect(vault.contextFor('chat')).toContain('Global policy.')
  expect(vault.writableRoots('chat')).toHaveLength(2)
})

it('orders previously missing user messages before their assistant reply and preserves literal user markup', () => {
  const { root, vault } = setup()
  vault.recordThread({ id: 'chat', turns: [{ id: 'turn', status: 'completed', items: [assistant('answer', 'Final answer')] }] })
  const literal = '<codex-remote-context>Code example</codex-remote-context>'
  vault.recordThread({ id: 'chat', turns: [{ id: 'turn', status: 'completed', items: [user('question', literal), assistant('answer', 'Final answer')] }] })
  const text = readFileSync(join(root, 'Conversations', 'chat', 'Turns', 'turn.md'), 'utf8')
  expect(text.indexOf('## User')).toBeLessThan(text.indexOf('## Assistant'))
  expect(text).toContain(literal)
})
