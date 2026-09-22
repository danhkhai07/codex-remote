import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { assert, record, parentIdentity, hash, same, json, fileHash } from './common.mjs'

export function processStart(pid) {
  try { return readFileSync('/proc/' + pid + '/stat', 'utf8').split(') ').at(-1).split(' ')[19] }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
export function provisionPlan(meta, assertKeyLocation) {
  assertKeyLocation(meta.keyFile, meta.fileRoots)
  assert(record(meta.keyFile).absent, 'owner-key-already-present-before-isolation')
  const parents = {}
  for (let parent = dirname(meta.keyFile); ; parent = dirname(parent)) {
    const value = parentIdentity(parent); parents[parent] = value
    if (parent === dirname(meta.keyFile) && !value.absent) assert(value.uid === 0 && (value.mode & 0o077) === 0, 'key-directory-permissions')
    if (parent === dirname(parent)) break
  }
  return { keyFile: meta.keyFile, fileRoots: meta.fileRoots, parents, key: { absent: true } }
}
export function ownerIdentity(meta, readOwnerKey) {
  const directory = record(dirname(meta.keyFile))
  assert(directory.directory && directory.uid === 0 && (directory.mode & 0o077) === 0, 'key-directory-permissions')
  const value = readOwnerKey(meta.keyFile, meta.fileRoots)
  return { app: value.app, generation: value.generation, digest: hash(JSON.stringify(value)), metadata: record(meta.keyFile), directory }
}
export function boundOwner(release, meta, seal, readOwnerKey) {
  const receipt = json(release + '.activation/key-binding.json')
  assert(receipt.release === release && receipt.seal === seal && receipt.app === meta.app && receipt.oldGone === true, 'key-binding-not-proven')
  const path = join(release + '.activation', 'key-created.json')
  assert(receipt.created?.path === path && receipt.created.sha256 === fileHash(path), 'key-creation-receipt-drift')
  const created = json(path)
  assert(created.version === 1 && created.release === release && created.seal === seal && created.app === meta.app && created.keyFile === meta.keyFile, 'key-creation-not-proven')
  same(created.old, receipt.old, 'key-creation-old-boundary-drift')
  same(created.key, receipt.key, 'key-creation-binding-drift')
  const key = ownerIdentity(meta, readOwnerKey)
  same(key, receipt.key, 'generated-owner-key-drift')
  return key
}
