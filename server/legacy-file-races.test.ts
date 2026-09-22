import { mkdtemp, mkdir, writeFile, rename, symlink, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { inspectServerFile, openInspectedFile, readInspectedFile, serveServerFile } from './server-files.js'
import { convertPptx } from './pptx-preview.js'

const seam = vi.hoisted(() => ({ beforeOpen: undefined as ((path: string) => Promise<void>) | undefined, opened: [] as number[], exec: vi.fn() }))
vi.mock('node:fs/promises', async original => {
  const fs = await original<typeof import('node:fs/promises')>()
  return { ...fs, open: async (...args: Parameters<typeof fs.open>) => {
    if (typeof args[0] === 'string') await seam.beforeOpen?.(args[0])
    const handle = await fs.open(...args); seam.opened.push(handle.fd); return handle
  } }
})
vi.mock('node:child_process', () => ({ execFile: (...args: unknown[]) => seam.exec(...args) }))
const folders: string[] = []
afterEach(async () => { seam.beforeOpen = undefined; seam.opened = []; seam.exec.mockReset(); for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }) })
async function fixture(extension = '.txt') {
  const root = await mkdtemp(join(tmpdir(), 'legacy-file-race-')); folders.push(root)
  const parent = join(root, 'folder'), secret = join(root, '.local'), path = join(parent, 'file' + extension)
  await mkdir(parent); await mkdir(secret)
  const bytes = extension === '.pptx' ? Buffer.from([0x50, 0x4b, 3, 4, 1, 2]) : Buffer.from('allowed')
  await writeFile(path, bytes); await writeFile(join(secret, 'file' + extension), 'FAKE PRIVATE CANARY')
  const swap = async () => { await rename(parent, join(root, 'old')); await symlink(secret, parent) }
  return { root, parent, secret, path, bytes, swap }
}
async function closed(fd: number) { await expect(realpath('/proc/self/fd/' + fd)).rejects.toMatchObject({ code: 'ENOENT' }) }

it('checks the opened descriptor when a parent changes after realpath but before open', async () => {
  const f = await fixture()
  seam.beforeOpen = async path => { if (path === f.path) { seam.beforeOpen = undefined; await f.swap() } }
  await expect(inspectServerFile(f.path, [f.root])).rejects.toMatchObject({ status: 403 })
  await closed(seam.opened.at(-1)!)
})

it('rejects parent swaps and final symlinks between inspection and HTML/content read', async () => {
  const f = await fixture('.html'), info = await inspectServerFile(f.path, [f.root])
  await f.swap()
  await expect(readInspectedFile(info)).rejects.toMatchObject({ status: 403 })
  const second = await fixture(), original = await inspectServerFile(second.path, [second.root])
  await rename(second.path, second.path + '.old'); await symlink(join(second.secret, 'file.txt'), second.path)
  await expect(readInspectedFile(original)).rejects.toMatchObject({ status: 403 })
})

it('rejects same-path inode replacement and an uninspected object before consuming bytes', async () => {
  const f = await fixture(), info = await inspectServerFile(f.path, [f.root])
  await rename(f.path, f.path + '.old'); await writeFile(f.path, f.bytes)
  await expect(openInspectedFile(info)).rejects.toMatchObject({ status: 409 })
  await closed(seam.opened.at(-1)!)
  await expect(readInspectedFile({ ...info })).rejects.toMatchObject({ status: 403 })
})

it('closes the descriptor if the HTTP response closes while validation is awaiting I/O', async () => {
  const f = await fixture(), info = await inspectServerFile(f.path, [f.root])
  const res = { destroyed: false, setHeader: vi.fn() }
  seam.beforeOpen = async () => { res.destroyed = true }
  await serveServerFile({ method: 'GET', headers: {}, aborted: false } as IncomingMessage, res as unknown as ServerResponse, info, false)
  expect(res.setHeader).not.toHaveBeenCalled(); await closed(seam.opened.at(-1)!)
})

it('denies changed PPTX parents before starting a converter', async () => {
  const f = await fixture('.pptx'), info = await inspectServerFile(f.path, [f.root])
  await f.swap()
  await expect(convertPptx(info)).rejects.toMatchObject({ status: 403 })
  expect(seam.exec).not.toHaveBeenCalled()
})

it('passes only inspected PPTX bytes into the private conversion directory', async () => {
  const f = await fixture('.pptx'), info = await inspectServerFile(f.path, [f.root])
  seam.exec.mockImplementation((_bin, args, _options, callback) => {
    const bind = (args as string[]).find(value => value.startsWith('BindPaths='))!
    const directory = bind.slice('BindPaths='.length, -':/work'.length)
    void import('node:fs/promises').then(async fs => {
      expect(await fs.readFile(join(directory, 'slides.pptx'))).toEqual(f.bytes)
      await fs.writeFile(join(directory, 'slides.pdf'), '%PDF-fixture')
      callback(null, '', '')
    }).catch(error => callback(error))
  })
  expect(await convertPptx(info)).toEqual(Buffer.from('%PDF-fixture'))
  expect(seam.exec).toHaveBeenCalledOnce()
})
