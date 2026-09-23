// Init-once new-instance key. Caller must prove the live legacy Files boundary.
// Holds creator FDs across bind/start; no reuse/rotation/secret output/recovery.
import assert from 'node:assert/strict'
import { constants, openSync, closeSync, fstatSync, fsyncSync, writeFileSync, readFileSync, lstatSync, realpathSync } from 'node:fs'
import { dirname, basename, resolve } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
const hash = b => createHash('sha256').update(b).digest('hex')
const metadata = s => ({ dev: s.dev, ino: s.ino, mode: s.mode & 0o7777, uid: s.uid, gid: s.gid, size: s.size })
export async function createBoundOwner({ file, assertLocation, boundary, bind, start }) {
  file = resolve(file)
  assertLocation(file)
  const directory = openSync(dirname(file), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  let fd
  try {
    const parent = fstatSync(directory)
    assert.equal(realpathSync(`/proc/self/fd/${directory}`), dirname(file))
    assert.equal(parent.uid, process.getuid()); assert.equal(parent.mode & 0o077, 0)
    await boundary()
    const value = { version: 1, app: randomBytes(18).toString('base64url'), generation: randomBytes(18).toString('base64url'), key: randomBytes(32).toString('base64url') }
    const bytes = Buffer.from(JSON.stringify(value) + '\n')
    fd = openSync(`/proc/self/fd/${directory}/${basename(file)}`, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    writeFileSync(fd, bytes); fsyncSync(fd); fsyncSync(directory)
    const identity = { app: value.app, generation: value.generation, sha256: hash(bytes), metadata: metadata(fstatSync(fd)), directory: { dev: parent.dev, ino: parent.ino, uid: parent.uid, gid: parent.gid, mode: parent.mode & 0o7777 } }
    const verify = () => {
      const p = lstatSync(dirname(file)), s = lstatSync(file)
      assert(p.isDirectory() && s.isFile() && !s.isSymbolicLink() && s.nlink === 1)
      assert.deepEqual({ dev: p.dev, ino: p.ino, uid: p.uid, gid: p.gid, mode: p.mode & 0o7777 }, identity.directory)
      assert.deepEqual(metadata(s), identity.metadata)
      assert.deepEqual(metadata(fstatSync(fd)), identity.metadata)
      assert.equal(hash(readFileSync(file)), identity.sha256)
    }
    verify(); await bind(identity); verify()
    await start(verify, identity); verify()
    return identity
  } finally {
    if (fd !== undefined) closeSync(fd)
    closeSync(directory)
  }
}
