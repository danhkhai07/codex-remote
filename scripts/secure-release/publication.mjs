import { join } from 'node:path'
import { assert, atomicBytes, fileHash, json, record } from './common.mjs'
/** Separate immutable proof precedes any bookkeeping dispatch. All output is nonsecret. */
export class Publication {
  constructor(directory, identity) { this.directory = directory; this.identity = identity; this.proof = undefined }
  persist(evidence) {
    const path = join(this.directory, 'postverify.json')
    assert(record(path).absent, 'postverify-receipt-already-exists')
    atomicBytes(path, JSON.stringify({ ...this.identity, evidence }) + '\n', 0o600)
    this.proof = { path, sha256: fileHash(path) }
    for (const name of ['services', 'vault']) this.status(name, 'pending')
    return this.proof
  }
  status(name, status, details = {}) {
    assert(['services', 'vault'].includes(name) && this.proof, 'bookkeeping-without-proof')
    assert(fileHash(this.proof.path) === this.proof.sha256, 'postverify-proof-drift')
    atomicBytes(join(this.directory, name + '.json'), JSON.stringify({ status, at: new Date().toISOString(), proof: this.proof, ...details }) + '\n', 0o600)
  }
  references() {
    if (!this.proof) return {}
    return { publication: this.proof, bookkeeping: Object.fromEntries(['services', 'vault'].map(name => {
      const path = join(this.directory, name + '.json')
      return [name, { path, status: record(path).absent ? 'not-started' : json(path).status }]
    })) }
  }
}
