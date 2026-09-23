import { chmod, mkdtemp, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { afterEach, expect, it } from 'vitest'
import { allowedFilePath, fileAccessMode } from './file-policy.js'
import { loadConfig } from './config.js'
import { readOwnerKey } from './secure-key.js'
import { inspectServerFile, readInspectedFile } from './server-files.js'
import { listDirectory } from './directory-listing.js'
import { randomId } from './secure-wire.js'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'owner-files-')); roots.push(root); return root }
it('enables full Files only explicitly with required owner proof, preserving workspace scope', () => {
  const env = { CODEX_REMOTE_PASSWORD: 'FAKE test-only password', CODEX_REMOTE_SESSION_SECRET: 'fixture'.repeat(8), CODEX_REMOTE_PUBLIC_ORIGIN: 'https://example.test', CODEX_REMOTE_WORKSPACE_ROOTS: '/tmp', CODEX_REMOTE_FILE_ROOTS: '/' }
  expect(() => loadConfig(env)).toThrow(/explicit project/)
  expect(() => loadConfig({ ...env, CODEX_REMOTE_FILE_ACCESS: 'owner-full' })).toThrow(/encrypted owner/)
  const config = loadConfig({ ...env, CODEX_REMOTE_FILE_ACCESS: 'owner-full', CODEX_REMOTE_SECURE_API: 'required' })
  expect(config.fileRoots).toEqual(['/']); expect(config.workspaceRoots).toEqual(['/tmp'])
  expect(() => fileAccessMode({ fileAccess: 'owner-full' })).toThrow(/encrypted owner/)
  expect(() => loadConfig({ ...env, CODEX_REMOTE_FILE_ACCESS: 'typo', CODEX_REMOTE_SECURE_API: 'required' })).toThrow(/Invalid Files/)
  for (const path of ['/', '/root', '/root/.env', '/root/.codex/auth.json', '/root/.local/state/app/secure-owner/owner-key.json', '/etc/hosts']) {
    expect(allowedFilePath(path, ['/'], 'owner-full')).toBe(true)
    expect(allowedFilePath(path, ['/'])).toBe(false)
  }
  for (const path of ['relative', '/tmp/has\0null']) expect(allowedFilePath(path, ['/'], 'owner-full')).toBe(false)
})
it('lists and reads hidden, outside-workspace and private-name canaries including symlinks', async () => {
  const root = await fixture(), project = join(root, 'project'), home = join(root, 'root')
  await mkdir(project); await mkdir(home)
  for (const relative of ['.env', '.codex/auth.json', '.state/state.json', '.local/state/app/secure-owner/owner-key.json', '.ssh/id_ed25519']) {
    const path = join(home, relative); await mkdir(dirname(path), { recursive: true }); await writeFile(path, 'FAKE OWNER CANARY', { mode: 0o600 })
    const file = await inspectServerFile(path, [project], 'owner-full')
    expect(file.kind).toBe('text'); expect((await readInspectedFile(file)).toString()).toBe('FAKE OWNER CANARY')
    await expect(inspectServerFile(path, [root])).rejects.toMatchObject({ status: 403 })
  }
  const target = join(home, '.env'), link = join(project, 'linked.env'); await symlink(target, link)
  expect((await inspectServerFile(link, [project], 'owner-full')).path).toBe(target)
  const listing = await listDirectory(new URLSearchParams({ path: home, hidden: '1' }), [project], 'owner-full')
  expect(listing.entries.map(e => e.name)).toEqual(expect.arrayContaining(['.env', '.local', '.state', '.codex', '.ssh']))
  expect(listing.parentPath).toBe(root)
  expect((await listDirectory(new URLSearchParams({ path: home }), [project], 'owner-full')).total).toBe(0)
  expect((await listDirectory(new URLSearchParams({ path: project }), [project], 'owner-full')).entries[0]).toMatchObject({ kind: 'file', symlink: true })
})
it('retains descriptor identity on reopen and bounds buffered preview allocation', async () => {
  const root = await fixture(), path = join(root, '.env')
  await writeFile(path, 'ORIGINAL')
  const file = await inspectServerFile(path, ['/'], 'owner-full')
  await expect(readInspectedFile(file, 4)).rejects.toMatchObject({ status: 413 })
  await rename(path, join(root, 'old')); await writeFile(path, 'REPLACED')
  await expect(readInspectedFile(file)).rejects.toMatchObject({ status: 409 })
  const replaced = await inspectServerFile(path, ['/'], 'owner-full'); await rm(path)
  await expect(readInspectedFile(replaced)).rejects.toMatchObject({ status: 409 })
})
it('rejects FIFOs/devices/kernel pseudo files without reading their content', async () => {
  const root = await fixture(), fifo = join(root, 'fifo')
  execFileSync('mkfifo', [fifo])
  for (const path of [fifo, '/dev/zero', '/dev/random', '/proc/self/status', '/proc/self/mem']) await expect(inspectServerFile(path, ['/'], 'owner-full')).rejects.toMatchObject({ status: 415 })
  await symlink('/proc/self/status', join(root, 'pseudo.txt'))
  await expect(inspectServerFile(join(root, 'pseudo.txt'), ['/'], 'owner-full')).rejects.toMatchObject({ status: 415 })
}, 3000)
it('allows the existing private key inside owner Files while retaining physical validation', async () => {
  const root = await fixture(), path = join(root, 'owner.json')
  const material = { version: 1, app: randomId(), generation: randomId(), key: randomId(32) }
  await writeFile(path, JSON.stringify(material), { mode: 0o600 })
  expect(() => readOwnerKey(path, ['/'])).toThrow(/outside/)
  expect(readOwnerKey(path, ['/'], 'owner-full')).toEqual(material)
  await symlink(path, join(root, 'alias.json'))
  expect(() => readOwnerKey(join(root, 'alias.json'), ['/'], 'owner-full')).toThrow(/invalid/)
  await chmod(path, 0o644)
  expect(() => readOwnerKey(path, ['/'], 'owner-full')).toThrow(/invalid/)
})
