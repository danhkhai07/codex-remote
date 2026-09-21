import { constants } from 'node:fs'
import { open, readdir, realpath, type FileHandle } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { ServerFileError } from './server-files.js'

import { allowedFilePath as allowed, deniedFilePath } from './file-policy.js'

export async function listDirectory(query: URLSearchParams, roots: string[]) {
  const input = query.get('path')
  const offset = Number(query.get('offset') ?? 0)
  const limit = Number(query.get('limit') ?? 100)
  const search = (query.get('search') ?? '').trim().toLocaleLowerCase()
  if (!input || input.length > 4096 || input.includes('\0') || !isAbsolute(input)) throw new ServerFileError(400, 'Directory path must be an absolute path')
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200 || search.length > 255) throw new ServerFileError(400, 'Invalid directory listing parameters')
  if (!allowed(input, roots)) throw new ServerFileError(403, 'Directory access is not allowed')
  let directory: FileHandle | undefined
  try {
    const path = await realpath(resolve(input))
    if (!allowed(path, roots)) throw new ServerFileError(403, 'Directory is outside the configured file roots')
    directory = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const descriptor = `/proc/self/fd/${directory.fd}`
    if (!allowed(await realpath(descriptor), roots)) throw new ServerFileError(403, 'Directory access is not allowed')
    if (!(await directory.stat()).isDirectory()) throw new ServerFileError(400, 'Path is not a directory')
    const hidden = query.get('hidden') === '1'
    const children = (await readdir(descriptor, { withFileTypes: true }))
      .filter(entry => !deniedFilePath(join(path, entry.name)) && (hidden || !entry.name.startsWith('.')) && (!search || entry.name.toLocaleLowerCase().includes(search)))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, 'en', { numeric: true }) || a.name.localeCompare(b.name))
    const entries = await Promise.all(children.slice(offset, offset + limit).map(async entry => {
      const child = join(path, entry.name)
      const base = { name: entry.name, path: child, symlink: entry.isSymbolicLink() }
      try {
        const target = await realpath(join(descriptor, entry.name))
        if (!allowed(target, roots)) return { ...base, kind: 'unavailable' as const, size: null, modifiedAt: null }
        const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
        try {
          if (!allowed(await realpath(`/proc/self/fd/${handle.fd}`), roots)) return { ...base, kind: 'unavailable' as const, size: null, modifiedAt: null }
          const info = await handle.stat()
          return { ...base, kind: info.isDirectory() ? 'directory' as const : info.isFile() ? 'file' as const : 'unavailable' as const, size: info.isFile() ? info.size : null, modifiedAt: info.mtime.toISOString() }
        } finally { await handle.close() }
      } catch {
        return { ...base, kind: 'unavailable' as const, size: null, modifiedAt: null }
      }
    }))
    const parent = dirname(path)
    return { path, parentPath: parent !== path && allowed(parent, roots) ? parent : null, entries, total: children.length, offset, limit }
  } catch (error) {
    if (error instanceof ServerFileError) throw error
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') throw new ServerFileError(404, 'Directory not found')
    if (code === 'EACCES' || code === 'EPERM' || code === 'ELOOP') throw new ServerFileError(403, 'Directory is not readable')
    throw error
  } finally { await directory?.close() }
}
