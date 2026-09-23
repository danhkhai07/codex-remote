import { mkdtemp, mkdir, writeFile, rename, symlink, rm } from 'node:fs/promises'
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { inspectServerFile, readInspectedFile, serveServerFile } from './server-files.js'
import { listDirectory } from './directory-listing.js'
const hooks = vi.hoisted(() => ({ afterOpen: undefined as ((path: string) => Promise<void>) | undefined, beforeRead: undefined as (() => Promise<void>) | undefined }))
vi.mock('node:fs/promises', async original => {
  const fs = await original<typeof import('node:fs/promises')>()
  return { ...fs,
    open: async (...args: Parameters<typeof fs.open>) => { const handle = await fs.open(...args); await hooks.afterOpen?.(String(args[0])); return handle },
    readdir: async (...args: Parameters<typeof fs.readdir>) => { await hooks.beforeRead?.(); return fs.readdir(...args) },
  }
})
const roots: string[] = []
afterEach(async () => { hooks.afterOpen = undefined; hooks.beforeRead = undefined; for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'owner-lifetime-')); roots.push(root); return root }
it('full access does not adopt a replaced parent after file inspection', async () => {
  const root = await fixture(), folder = join(root, 'folder'), replacement = join(root, '.local')
  await mkdir(folder); await mkdir(replacement)
  await writeFile(join(folder, 'note.txt'), 'ORIGINAL'); await writeFile(join(replacement, 'note.txt'), 'REPLACED')
  const file = await inspectServerFile(join(folder, 'note.txt'), ['/'], 'owner-full')
  await rename(folder, join(root, 'moved')); await symlink(replacement, folder)
  await expect(readInspectedFile(file)).rejects.toMatchObject({ status: 409 })
})
it('directory enumeration stays on the opened directory during a parent replacement', async () => {
  const root = await fixture(), folder = join(root, 'folder'), replacement = join(root, '.state')
  await mkdir(folder); await mkdir(replacement); await writeFile(join(folder, 'original'), 'one'); await writeFile(join(replacement, 'replacement'), 'two')
  hooks.beforeRead = async () => { hooks.beforeRead = undefined; await rename(folder, join(root, 'moved')); await symlink(replacement, folder) }
  const result = await listDirectory(new URLSearchParams({ path: folder, hidden: '1' }), ['/'], 'owner-full')
  expect(result.entries.map(e => e.name)).toEqual(['original'])
})
it('revalidates session after file descriptor awaits and before streaming any content', async () => {
  const root = await fixture(), path = join(root, 'note.txt'); await writeFile(path, 'PRIVATE TEST CANARY')
  const file = await inspectServerFile(path, ['/'], 'owner-full')
  let revoked = false
  hooks.afterOpen = async opened => { if (opened === path) revoked = true }
  const response = { setHeader: vi.fn(), end: vi.fn() }
  await expect(serveServerFile({ headers: {}, method: 'GET' } as IncomingMessage, response as unknown as ServerResponse, file, true, () => { if (revoked) throw Error('revoked') })).rejects.toThrow('revoked')
  expect(response.setHeader).not.toHaveBeenCalled(); expect(response.end).not.toHaveBeenCalled()
})
it('a concurrent append after validation cannot enlarge buffered output', async () => {
  const root = await fixture(), path = join(root, 'note.txt'); await writeFile(path, 'INITIAL')
  const file = await inspectServerFile(path, ['/'], 'owner-full')
  // live() is invoked after descriptor identity/size validation but before allocation/read.
  let once = false
  const bytes = await readInspectedFile(file, 100, () => { if (!once) { once = true; appendFileSync(path, Buffer.alloc(8192, 65)) } })
  expect(bytes.length).toBe(file.size)
})
