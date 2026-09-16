import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectServerFile } from './server-files.js'
import { listDirectory } from './directory-listing.js'

const temporary: string[] = []
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'remote-directory-test-'))
  temporary.push(base)
  const root = join(base, 'workspace')
  await mkdir(root)
  await mkdir(join(root, 'folder'))
  await writeFile(join(root, 'notes.md'), '# Test')
  await writeFile(join(root, '.hidden'), 'hidden')
  await writeFile(join(base, 'outside.txt'), 'outside')
  await symlink(join(base, 'outside.txt'), join(root, 'escape'))
  await symlink(join(root, 'missing'), join(root, 'broken'))
  await symlink(join(root, 'folder'), join(root, 'folder-link'))
  return { base, root }
}
const query = (path: string, options = {}) => new URLSearchParams({ path, ...options })

describe('workspace directory browsing', () => {
  it('lists folders first, hides dotfiles, and resolves only allowed links', async () => {
    const { root } = await fixture()
    const result = await listDirectory(query(root), [root])
    expect(result.parentPath).toBeNull()
    expect(result.entries[0]).toMatchObject({ name: 'folder', kind: 'directory' })
    expect(result.entries.some(entry => entry.name === '.hidden')).toBe(false)
    expect(result.entries.find(entry => entry.name === 'notes.md')).toMatchObject({ kind: 'file', size: 6 })
    expect(result.entries.find(entry => entry.name === 'escape')).toMatchObject({ kind: 'unavailable', size: null })
    expect(result.entries.find(entry => entry.name === 'broken')).toMatchObject({ kind: 'unavailable' })
    expect(result.entries.find(entry => entry.name === 'folder-link')).toMatchObject({ kind: 'directory', symlink: true })
    expect((await listDirectory(query(join(root, 'folder')), [root])).parentPath).toBe(root)
  })

  it('searches and paginates the whole directory instead of truncating it', async () => {
    const { root } = await fixture()
    await Promise.all(Array.from({ length: 205 }, (_, i) => writeFile(join(root, `page-${i}.txt`), 'text')))
    const first = await listDirectory(query(root, { search: 'PAGE-', limit: '100' }), [root])
    const last = await listDirectory(query(root, { search: 'page-', offset: '200', limit: '100' }), [root])
    expect(first.total).toBe(205)
    expect(first.entries).toHaveLength(100)
    expect(last.entries).toHaveLength(5)
    expect(last.entries[0].name).toBe('page-200.txt')
    expect((await listDirectory(query(root, { search: 'hidden', hidden: '1' }), [root])).entries).toHaveLength(1)
    expect((await listDirectory(query(root, { search: 'no match' }), [root])).total).toBe(0)
  })

  it('rejects outside roots, traversal, file paths, missing paths and invalid paging', async () => {
    const { base, root } = await fixture()
    for (const path of [base, join(root, '..'), join(root, 'escape')]) {
      await expect(listDirectory(query(path), [root])).rejects.toMatchObject({ status: 403 })
    }
    await expect(listDirectory(query(join(root, 'notes.md')), [root])).rejects.toMatchObject({ status: 400 })
    await expect(listDirectory(query(join(root, 'missing')), [root])).rejects.toMatchObject({ status: 404 })
    await expect(listDirectory(query('relative'), [root])).rejects.toMatchObject({ status: 400 })
    for (const options of [{ offset: '-1' }, { limit: '201' }, { limit: '0' }, { offset: 'abc' }]) {
      await expect(listDirectory(query(root, options), [root])).rejects.toMatchObject({ status: 400 })
    }
  })
})

it('supports filesystem root for browsing, reading files and following links outside the workspace', async () => {
  const { root, base } = await fixture()
  const listing = await listDirectory(query(root), ['/'])
  expect(listing.parentPath).toBe(base)
  expect(listing.entries.find(entry => entry.name === 'escape')).toMatchObject({ kind: 'file' })
  expect((await listDirectory(query('/'), ['/'])).parentPath).toBeNull()
  expect(await inspectServerFile(join(base, 'outside.txt'), ['/'])).toMatchObject({ kind: 'text', previewable: true })
  expect(await inspectServerFile(join(root, 'escape'), ['/'])).toMatchObject({ path: join(base, 'outside.txt') })
  await expect(inspectServerFile(join(base, 'outside.txt'), [root])).rejects.toMatchObject({ status: 403 })
})
