import { constants, closeSync, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'
export type OwnerKeyFile = { version: 1; app: string; generation: string; key: string }
const insideRoots = (path: string, roots: string[]) => roots.some(root => {
  const lexical = resolve(root)
  let canonical = lexical
  try { canonical = realpathSync(lexical) } catch { /* Missing roots still have a lexical boundary. */ }
  return [lexical, canonical].some(base => base === sep || path === base || path.startsWith(base + sep))
})
export function assertKeyLocation(file: string, roots: string[]) { if (!isAbsolute(file) || insideRoots(resolve(file), roots)) throw Error('Secure key must be outside allowed file roots') }
/** Never include secret contents in exceptions/logs. Reload allows local rotation. */
export function readOwnerKey(file: string, roots: string[]): OwnerKeyFile {
  assertKeyLocation(file, roots)
  let fd: number | undefined
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const info = fstatSync(fd), canonical = realpathSync(`/proc/self/fd/${fd}`)
    if (!info.isFile() || (info.mode & 0o777) !== 0o600 || info.uid !== process.getuid?.() || info.size > 2048 || insideRoots(canonical, roots)) throw Error()
    const value = JSON.parse(readFileSync(fd, 'utf8')) as OwnerKeyFile
    if (value.version !== 1 || !/^[A-Za-z0-9_-]{20,64}$/.test(value.app) || !/^[A-Za-z0-9_-]{20,64}$/.test(value.generation) || !/^[A-Za-z0-9_-]{43}$/.test(value.key) || Buffer.from(value.key, 'base64url').length !== 32 || Buffer.from(value.key, 'base64url').toString('base64url') !== value.key) throw Error()
    return value
  } catch { throw Error('Secure key file unavailable or invalid (requires owner-only 0600 regular file)') }
  finally { if (fd !== undefined) closeSync(fd) }
}
