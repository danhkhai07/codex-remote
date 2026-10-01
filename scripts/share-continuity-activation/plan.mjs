import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { openSync, closeSync, writeFileSync, fsyncSync } from 'node:fs'
import { dirname } from 'node:path'

export const TARGET_SOURCE = 'cf292a496b6652cce378a75f9f7f4d98b9b7e69e'
export const PORTS = [2345, 5180, 5210, 5211, 5212, 5213, 5215, 5217, 5221, 5222]
export const PORT_VALUE = PORTS.join(',')
export const HOSTS = PORTS.map(port => `p${port}.danhkhai.io.vn`)
export const PAYLOAD = ['dist-server/services.js', 'dist-server/services.js.map', 'scripts/services.mjs']
export const ENV_KEY = 'CODEX_REMOTE_PREVIEW_SHARE_PORTS'

export function patchEnvironment(bytes, parse) {
  const text = bytes.toString(), lines = text.split(/(?<=\n)/)
  const matches = lines.flatMap((line, index) => line.startsWith(ENV_KEY + '=') ? [index] : [])
  assert.equal(matches.length, 1, `Expected exactly one ${ENV_KEY} assignment`)
  const before = parse(text), index = matches[0], ending = lines[index].endsWith('\n') ? '\n' : ''
  lines[index] = `${ENV_KEY}=${PORT_VALUE}${ending}`
  const patched = Buffer.from(lines.join('')), after = parse(patched.toString())
  assert.equal(after[ENV_KEY], PORT_VALUE)
  assert(isDeepStrictEqual({ ...after, [ENV_KEY]: before[ENV_KEY] }, before), 'Environment patch changed unrelated values')
  return patched
}

export function exclusive(path, value) {
  const fd = openSync(path, 'wx', 0o600)
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
  const directory = openSync(dirname(path), 'r')
  try { fsyncSync(directory) } finally { closeSync(directory) }
}

export function assertNoAttempt(exists) {
  assert(!exists, 'Activation attempt already exists; use verify-only or a reviewed forward fix')
}
