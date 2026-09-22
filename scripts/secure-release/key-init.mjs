// Cutover-only creator. No rotation, reuse, deletion, service control or secret output.
// The parent adapter proves the full service/cgroup/TCP boundary before invocation.
import { constants, closeSync, fstatSync, fsyncSync, mkdirSync, openSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'
import { APP, SOURCE, assert, json, fileHash, hash, record, same } from './common.mjs'
import { processStart, provisionPlan } from './key-state.mjs'
import { receiptBinding } from './cutover-ops.mjs'

const [release] = process.argv.slice(2), outside = release + '.activation'
assert(release && process.argv.length === 3, 'usage: key-init.mjs SEALED_RELEASE')
const meta = json(join(release, 'metadata.json')), permit = json(join(outside, 'key-cutover-permit.json')), seal = fileHash(join(release, 'seal.json'))
const { assertKeyLocation } = await import(pathToFileURL(join(release, 'operator/dist-server/secure-key.js')).href)
assert(meta.app === APP && meta.sourceTarget === SOURCE && meta.requiredEncryption && meta.activationEligible, 'creator-release-contract')
assert(permit.release === release && permit.app === APP && permit.seal === seal, 'creator-permit-mismatch')
assert(processStart(permit.runner.pid) === permit.runner.start, 'creator-runner-not-alive')
same(json(permit.lock + '/owner.json'), { release, pid: permit.runner.pid }, 'creator-lock-owner-drift')
const attempt = json(join(outside, 'attempt.json')), state = json(join(outside, 'key-cutover-state.json'))
assert(attempt.status === 'running' && attempt.phase === 'old-watcher-restart' && state.status === 'running' && state.phase === 'generate-owner-key', 'creator-phase-invalid')
assert(processStart(permit.old.pid) !== permit.old.start, 'creator-old-process-survives')
const authority = json(join(outside, 'authorization.json')), evidence = json(join(outside, 'evidence.json')), now = Date.now()
same(receiptBinding(outside, evidence), permit.receipts, 'creator-receipts-drift')
assert(now >= Date.parse(authority.at) && now - Date.parse(authority.at) < 60 * 60_000, 'creator-readiness-expired')
for (const value of Object.values(evidence)) assert(now >= Date.parse(value.at) && now - Date.parse(value.at) <= 24 * 60 * 60_000, 'creator-evidence-expired')
same(provisionPlan(meta, assertKeyLocation), permit.provision, 'creator-provision-drift')
const receipt = join(outside, 'key-created.json')
assert(record(receipt).absent && record(join(outside, 'key-binding.json')).absent, 'creator-prior-key-receipt')

const path = meta.keyFile
mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
const directory = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
try {
  const dir = fstatSync(directory), anchored = `/proc/self/fd/${directory}`
  assertKeyLocation(resolve(realpathSync(anchored), basename(path)), meta.fileRoots)
  assert((dir.mode & 0o077) === 0 && dir.uid === process.getuid(), 'creator-directory-permissions')
  const value = { version: 1, app: randomBytes(18).toString('base64url'), generation: randomBytes(18).toString('base64url'), key: randomBytes(32).toString('base64url') }
  const bytes = Buffer.from(JSON.stringify(value) + '\n')
  const fd = openSync(anchored + '/' + basename(path), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  let info
  try { writeFileSync(fd, bytes); fsyncSync(fd); info = fstatSync(fd) } finally { closeSync(fd) }
  fsyncSync(directory)
  assert(info.size === bytes.length, 'creator-incomplete-key')
  // Identity comes from the generated value and open descriptors, never a reread
  // of a pathname that may have been concurrently replaced after creation.
  const key = { app: value.app, generation: value.generation, digest: hash(JSON.stringify(value)),
    metadata: { mode: info.mode & 0o7777, uid: info.uid, gid: info.gid, size: bytes.length, sha256: hash(bytes) },
    directory: { mode: dir.mode & 0o7777, uid: dir.uid, gid: dir.gid, directory: true } }
  const created = { version: 1, release, seal, app: APP, keyFile: path, old: permit.old, at: new Date().toISOString(), key }
  const output = openSync(receipt, 'wx', 0o600)
  try { writeFileSync(output, JSON.stringify(created) + '\n'); fsyncSync(output) } finally { closeSync(output) }
  const parent = openSync(outside, 'r')
  try { fsyncSync(parent) } finally { closeSync(parent) }
} finally { closeSync(directory) }
