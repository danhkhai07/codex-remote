import { fileAccessMode } from '../dist-server/file-policy.js'
// Local operator only. Never prints key material. No gateway or model calls.
import { constants, closeSync, fstatSync, fsyncSync, mkdirSync, openSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { loadConfig } from '../dist-server/config.js'
import { assertKeyLocation, readOwnerKey } from '../dist-server/secure-key.js'
const [command, destination] = process.argv.slice(2)
if (!['init', 'rotate'].includes(command) || !destination) throw Error('Usage: node scripts/secure-key.mjs init|rotate /private/path/owner-key.json')
const path = resolve(destination), config = loadConfig()
const roots = [...(config.fileRoots ?? config.workspaceRoots), ...(config.contextVaultPath ? [config.contextVaultPath] : [])]
assertKeyLocation(path, roots, fileAccessMode(config))
const old = command === 'rotate' ? readOwnerKey(path, roots, fileAccessMode(config)) : null
mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
const directory = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
try {
  const info = fstatSync(directory), anchored = `/proc/self/fd/${directory}`
  assertKeyLocation(resolve(realpathSync(anchored), basename(path)), roots, fileAccessMode(config))
  if ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw Error('Key directory requires owner-only permissions')
  const value = { version: 1, app: old?.app ?? randomBytes(18).toString('base64url'), generation: randomBytes(18).toString('base64url'), key: randomBytes(32).toString('base64url') }
  const destination = anchored + '/' + basename(path), target = old ? destination + '.' + randomBytes(12).toString('hex') + '.tmp' : destination
  const fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try { writeFileSync(fd, JSON.stringify(value) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
  if (old) renameSync(target, destination)
  fsyncSync(directory)
} finally { closeSync(directory) }
console.log('Owner key ' + (old ? 'rotated' : 'provisioned') + '. Retrieve it privately through your SSH/password manager workflow. No history was deleted.')
