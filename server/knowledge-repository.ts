import { constants, openSync, closeSync, fstatSync, readFileSync, lstatSync, realpathSync } from 'node:fs'
import { dirname, join, resolve, isAbsolute } from 'node:path'

function smallFile(path: string) {
  let fd: number | undefined
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const stat = fstatSync(fd)
    return stat.isFile() && stat.size <= 4096 ? readFileSync(fd, 'utf8').trim() : ''
  } catch { return '' } finally { if (fd !== undefined) closeSync(fd) }
}
/** Local trusted cwd metadata only; no shell, network, Git hooks or per-note subprocess. */
export function knowledgeRepository(cwd: string): string | undefined {
  if (!isAbsolute(cwd)) return
  let directory: string
  try { directory = realpathSync(cwd) } catch { return }
  for (let depth = 0; depth < 32; depth++) {
    const marker = join(directory, '.git')
    try {
      const stat = lstatSync(marker)
      if (stat.isDirectory()) return directory
      if (!stat.isFile()) return
      const gitdir = smallFile(marker).match(/^gitdir: (.+)$/)?.[1]
      if (!gitdir) return
      const git = realpathSync(resolve(directory, gitdir)), common = smallFile(join(git, 'commondir'))
      if (!common || realpathSync(resolve(git, smallFile(join(git, 'gitdir')))) !== realpathSync(marker)) return
      const shared = realpathSync(resolve(git, common))
      if (!shared.endsWith('/.git') || !lstatSync(shared).isDirectory()) return
      return dirname(shared)
    } catch { /* No valid Git metadata at this ancestor. */ }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
}
