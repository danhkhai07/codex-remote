import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KnowledgeStore, noteDiff } from './knowledge-store.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function setup() { const root = mkdtempSync(join(tmpdir(), 'knowledge-')); roots.push(root); return { root, store: new KnowledgeStore(root) } }
const path = 'Projects/Example.md'
const initial = '---\nstatus: confirmed\nscope: Example\nsources: ["[[Conversations/chat/Index]]"]\n---\n# Example\n\nFirst decision.'

it('rejects stale writers and restores an old version without erasing the newer history', () => {
  const { root, store } = setup()
  const first = store.save(path, initial, '', 'convo-a')
  const other = new KnowledgeStore(root).read(path)
  const second = store.save(path, initial + '\n\nSecond decision.', first.revision, 'convo-b')
  expect(() => store.save(path, 'Would lose second decision', other.revision, 'convo-a')).toThrow(/changed since/)
  expect(store.read(path).content).toBe(second.content)
  const versions = store.versions(path)
  expect(versions).toHaveLength(2)
  expect(() => store.restore(path, versions[1].id, first.revision)).toThrow(/changed since/)
  expect(store.restore(path, versions[1].id, second.revision).content).toBe(initial)
  expect(store.versions(path)[0].origin).toBe('restore')
  expect(new KnowledgeStore(root).versions(path)).toHaveLength(3)
})

it('records observed filesystem edits and deletions and can recover a deleted note', () => {
  const { root, store } = setup()
  store.save(path, initial, '')
  writeFileSync(join(root, path), initial + '\nExternal change')
  store.captureExternal()
  expect(store.versions(path)[0].origin).toBe('external')
  const latest = store.versions(path)[0]
  rmSync(join(root, path))
  store.captureExternal()
  expect(store.versions(path)[0].deleted).toBe(true)
  expect(store.restore(path, latest.id, '').content).toContain('External change')
})

it('blocks escapes, generated paths and symlinks for notes and version files', () => {
  const { root, store } = setup()
  for (const path of ['../secret.md', '/tmp/secret.md', 'Projects/../README.md', 'Index.md', 'Projects/Index.md', 'Conversations/chat/Turns/a.md', '.state/a.md']) expect(() => store.save(path, 'bad', '')).toThrow()
  const outside = mkdtempSync(join(tmpdir(), 'knowledge-outside-')); roots.push(outside)
  mkdirSync(join(root, 'Projects'))
  symlinkSync(outside, join(root, 'Projects', 'Link'))
  expect(() => store.save('Projects/Link/Secret.md', 'bad', '')).toThrow(/symbolic/)
  mkdirSync(join(root, '.state'))
  symlinkSync(outside, join(root, '.state', 'Knowledge'))
  expect(() => store.save(path, initial, '')).toThrow(/symbolic/)
})

it('flags ambiguous decisions without replacing either note and shows reviewable differences', () => {
  const { store } = setup()
  const text = initial.replace('scope: Example', 'scope: Example\ndecision-key: review-link')
  store.save(path, text, '')
  store.save('Decisions/Other.md', text + '\nUse another endpoint', '')
  expect(store.snapshot().issues.filter(issue => issue.message.includes('Cùng khóa'))).toHaveLength(2)
  expect(noteDiff('a\nold\nz', 'a\nnew\nz')).toEqual({ changed: true, startLine: 2, before: 'old', after: 'new' })
})
