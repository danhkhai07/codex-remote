import { mkdirSync, unlinkSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { atomicBytes, preimage, parentIdentity, same } from './common.mjs'
/** Cooperative shared lock. Never reclaim a stale/foreign owner automatically. */
export class DeploymentLock {
  constructor(path, owner) { this.path = path; this.owner = owner; this.held = false }
  acquire() {
    mkdirSync(this.path, { mode: 0o700 })
    // Failure keeps the directory for explicit inspection, including incomplete owner writes.
    atomicBytes(join(this.path, 'owner.json'), JSON.stringify(this.owner) + '\n', 0o600)
    this.directory = parentIdentity(this.path); this.receipt = preimage(join(this.path, 'owner.json')); this.held = true
  }
  release() {
    if (!this.held) return
    same(parentIdentity(this.path), this.directory, 'deployment-lock-directory-drift')
    same(preimage(join(this.path, 'owner.json')), this.receipt, 'deployment-lock-owner-drift')
    unlinkSync(join(this.path, 'owner.json')); rmdirSync(this.path); this.held = false
  }
}
