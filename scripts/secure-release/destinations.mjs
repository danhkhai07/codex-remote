// Cooperative writer guard, not atomic CAS against root. Shared deployment lock is required.
import { dirname } from 'node:path'
import { mkdirSync, renameSync, symlinkSync } from 'node:fs'
import { assert, preimage, parentIdentity, same, atomicBytes, record } from './common.mjs'
export class Destinations {
  constructor(entries, parents) { this.entries = structuredClone(entries); this.parents = structuredClone(parents) }
  check(path) {
    assert(Object.hasOwn(this.entries, path), 'destination-not-allowlisted')
    for (let parent = dirname(path); ; parent = dirname(parent)) {
      assert(Object.hasOwn(this.parents, parent), 'unsealed-destination-parent')
      same(parentIdentity(parent), this.parents[parent], 'destination-parent-drift:' + parent)
      if (parent === dirname(parent)) break
    }
    same(preimage(path), this.entries[path], 'destination-preimage-drift:' + path)
  }
  all() { for (const path of Object.keys(this.entries)) this.check(path) }
  adopt(path) { this.entries[path] = preimage(path) }
  write(path, bytes, mode = 0o644) {
    this.check(path)
    mkdirSync(dirname(path), { recursive: true })
    for (let parent = dirname(path); ; parent = dirname(parent)) {
      if (this.parents[parent]?.absent) this.parents[parent] = parentIdentity(parent)
      if (parent === dirname(parent)) break
    }
    this.check(path) // After owned directory creation, before actual replacement.
    assert(!this.entries[path].link && !this.entries[path].directory, 'destination-not-regular-file')
    atomicBytes(path, bytes, mode); this.adopt(path)
  }
  dependencySwap(path, backup, staged, checkTree) {
    this.check(path); checkTree(); this.check(path)
    assert(this.entries[path].directory && record(backup).absent, 'dependency-swap-preimage')
    renameSync(path, backup); this.adopt(path)
    this.check(path); assert(record(path).absent, 'dependency-pointer-race')
    symlinkSync(staged, path); this.adopt(path)
  }
}
export function destinationSnapshot(paths) {
  const entries = {}, parents = {}
  for (const path of paths) {
    entries[path] = preimage(path)
    for (let parent = dirname(path); ; parent = dirname(parent)) {
      parents[parent] = parentIdentity(parent)
      if (parent === dirname(parent)) break
    }
  }
  return { entries, parents }
}
