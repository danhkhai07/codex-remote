import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

export class KnowledgeError extends Error { constructor(readonly status: number, message: string) { super(message) } }
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

/** All note and version IO stays inside the vault, including existing ancestor components. */
export class VaultFiles {
  readonly root: string
  constructor(root: string) { this.root = resolve(root) }
  path(local: string) {
    const path = resolve(this.root, local), part = relative(this.root, path)
    if (part === '..' || part.startsWith(`..${sep}`) || local.includes('\0')) throw new KnowledgeError(400, 'Path is outside the knowledge vault')
    return path
  }
  inspect(local: string) {
    const path = this.path(local), parts = path.split(sep).filter(Boolean)
    let current: string = sep
    for (let index = 0; index < parts.length; index++) {
      current = join(current, parts[index])
      let stat
      try { stat = lstatSync(current) } catch (error) { if (missing(error)) return undefined; throw error }
      if (stat.isSymbolicLink()) throw new KnowledgeError(400, 'Knowledge paths must not contain symbolic links')
      if (index < parts.length - 1 && !stat.isDirectory()) throw new KnowledgeError(400, 'Invalid knowledge directory')
      if (index === parts.length - 1) return stat
    }
  }
  read(local: string): string | undefined {
    const stat = this.inspect(local)
    if (!stat) return undefined
    if (!stat.isFile()) throw new KnowledgeError(400, 'Expected a knowledge file')
    return readFileSync(this.path(local), 'utf8')
  }
  list(local: string): string[] {
    const stat = this.inspect(local)
    if (!stat) return []
    if (!stat.isDirectory()) throw new KnowledgeError(400, 'Expected a knowledge directory')
    return readdirSync(this.path(local)).sort()
  }
  write(local: string, content: string) {
    this.inspect(local)
    const path = this.path(local)
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.inspect(relative(this.root, dirname(path)))
    const temporary = `${path}.${randomUUID()}.tmp`
    let fd: number | undefined
    try {
      fd = openSync(temporary, 'wx', 0o600)
      writeFileSync(fd, content); fsyncSync(fd); closeSync(fd); fd = undefined
      this.inspect(local)
      renameSync(temporary, path)
    } finally {
      if (fd !== undefined) closeSync(fd)
      try { unlinkSync(temporary) } catch { /* The completed note is already durable. */ }
    }
  }
}
