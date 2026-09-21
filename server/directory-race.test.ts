import { mkdtemp, mkdir, writeFile, rename, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { listDirectory } from './directory-listing.js'
const boundary = vi.hoisted(() => ({ beforeRead: undefined as (() => Promise<void>) | undefined }))
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, readdir: async (...args: Parameters<typeof fs.readdir>) => { await boundary.beforeRead?.(); return fs.readdir(...args) } }
})
it('does not enumerate private names after an authorized directory is replaced by a symlink', async () => {
  const root = await mkdtemp(join(tmpdir(), 'directory-race-')), folder = join(root, 'folder')
  try {
    await mkdir(folder); await writeFile(join(folder, 'allowed.txt'), 'public')
    await mkdir(join(root, '.ssh')); await writeFile(join(root, '.ssh', 'CANARY_PRIVATE_NAME.txt'), 'fake')
    boundary.beforeRead = async () => { boundary.beforeRead = undefined; await rename(folder, join(root, 'old')); await symlink(join(root, '.ssh'), folder) }
    const listing = await listDirectory(new URLSearchParams({ path: folder }), [root])
    expect(JSON.stringify(listing)).not.toContain('CANARY_PRIVATE_NAME')
    expect(listing.entries.map(entry => entry.name)).toEqual(['allowed.txt'])
  } finally { boundary.beforeRead = undefined; await rm(root, { recursive: true, force: true }) }
})
