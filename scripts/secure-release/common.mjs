import { createHash } from 'node:crypto'
import { readFileSync, lstatSync, readdirSync, readlinkSync, mkdirSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
export const APP = '80843c0947c5e665a51a6207dbb871bf2c06a421'
export const BASE = '783b1e3ae0efd683458c9fa0b3518b2e476b06a9'
// APP identifies deployed executable bytes. SOURCE adds only independent tests/report.
export const SOURCE = '00f9e197285e9c918372367f626c0b744d47d0d6'
export const HOURS = 'b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93'
export const HOSTS = [2345, 5180, 5210, 5211, 5212, 5213, 5215].map(port => `p${port}.danhkhai.io.vn`)
export const MAIN = '/root/RUNNING-SERVICES/codex-remote'
export const INFRA = '/root/.local/state/codex-remote/security-infra-20260921'
export const assert = (ok, code) => { if (!ok) throw Error(code) }
export const hash = value => createHash('sha256').update(value).digest('hex')
export const json = path => JSON.parse(readFileSync(path, 'utf8'))
export const fileHash = path => hash(readFileSync(path))
export const command = (file, args, cwd = MAIN, env = process.env) => {
  try { return execFileSync(file, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, maxBuffer: 32 * 1024 * 1024 }).trim() }
  catch { throw Error('command-failed:' + file.split('/').at(-1)) } // No child output/env/credentials in errors.
}
export function record(path) {
  try {
    const stat = lstatSync(path), meta = { mode: stat.mode & 0o7777, uid: stat.uid, gid: stat.gid }
    if (stat.isSymbolicLink()) return { ...meta, link: readlinkSync(path) }
    if (stat.isDirectory()) return { ...meta, directory: true }
    assert(stat.isFile(), 'nonregular-file')
    return { ...meta, size: stat.size, sha256: fileHash(path) }
  } catch (error) { if (error.code === 'ENOENT') return { absent: true }; throw error }
}
export function preimage(path) {
  const value = record(path)
  if (value.absent) return value
  const stat = lstatSync(path)
  return { ...value, dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs }
}
export function parentIdentity(path) {
  const value = record(path)
  if (value.absent) return value
  assert(value.directory, 'destination-parent-not-directory')
  const stat = lstatSync(path)
  return { ...value, dev: stat.dev, ino: stat.ino }
}
export function tree(root, prefix = '', output = {}) {
  for (const name of readdirSync(join(root, prefix)).sort()) {
    const path = join(prefix, name), value = record(join(root, path))
    output[path] = value
    if (value.directory) tree(root, path, output)
  }
  return output
}
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
export function same(actual, expected, code) { assert(JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected)), code) }
export function inside(root, name) {
  assert(typeof name === 'string' && name && !name.startsWith('/') && !name.split('/').includes('..'), 'unsafe-artifact-path')
  const target = resolve(root, name)
  assert(relative(root, target) && !relative(root, target).startsWith('..'), 'unsafe-artifact-path')
  return target
}
export function writeJson(path, value) { writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }) }
export function atomicBytes(path, bytes, mode = 0o644) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = path + '.secure-release-' + process.pid
  const fd = openSync(temporary, 'wx', mode)
  try { writeFileSync(fd, bytes); fsyncSync(fd) } finally { closeSync(fd) }
  try { renameSync(temporary, path); const directory = openSync(dirname(path), 'r'); try { fsyncSync(directory) } finally { closeSync(directory) } }
  finally { try { unlinkSync(temporary) } catch { /* Successful rename removes this path; retain the original failure. */ } }
}
export const isIdle = value => value?.ready === true && value.busy === 0 && value.pending === 0 && value.incomplete === false
export function serviceIdentity(unit) { return command('systemctl', ['show', unit, '-p', 'MainPID', '-p', 'InvocationID', '-p', 'ExecMainStartTimestampMonotonic', '-p', 'ActiveState']) }
