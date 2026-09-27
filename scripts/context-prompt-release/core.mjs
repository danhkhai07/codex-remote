import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, lstatSync, writeFileSync, renameSync, mkdirSync, openSync, closeSync, fsyncSync, unlinkSync, rmdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
export const sha = bytes => createHash('sha256').update(bytes).digest('hex')
export const hash = path => sha(readFileSync(path))
export const same = (a, b, label) => { if (!isDeepStrictEqual(a, b)) throw Error(label + ' drift; abort') }
export const idle = value => value?.ready === true && value.busy === 0 && value.pending === 0 && value.incomplete === false
export function tree(root) {
  const result = {}
  const walk = relative => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(relative, entry.name)
      if (entry.isDirectory()) walk(path)
      else { assert(entry.isFile() && !entry.isSymbolicLink(), 'Unexpected deployment file type'); result[path] = hash(join(root, path)) }
    }
  }
  walk(''); return result
}
export function identity(path) {
  const s = lstatSync(path, { bigint: true }); assert(s.isFile() && !s.isSymbolicLink(), 'Expected regular identity file')
  return Object.fromEntries(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'uid', 'gid'].map(k => [k, String(s[k])]))
}
export function atomic(path, bytes, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = path + '.push-release-' + process.pid
  let fd, created = false
  try { fd = openSync(temp, 'wx', mode); created = true; writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined; renameSync(temp, path); const dir = openSync(dirname(path), 'r'); try { fsyncSync(dir) } finally { closeSync(dir) } }
  finally { if (fd !== undefined) closeSync(fd); if (created) { try { unlinkSync(temp) } catch { /* Only our created temporary file. */ } } }
}
// Compatible with the host's cooperative deployment.lock directory protocol.
// No automatic reclamation of a stale or foreign owner.
export function publicationLock(path, owner) {
  mkdirSync(path, { mode: 0o700 })
  const receipt = join(path, 'owner.json')
  atomic(receipt, JSON.stringify(owner) + '\n')
  const stat = lstatSync(path), expected = { dev: stat.dev, ino: stat.ino, mode: stat.mode, uid: stat.uid, gid: stat.gid }, receiptIdentity = identity(receipt), receiptHash = hash(receipt)
  return () => {
    const now = lstatSync(path)
    same({ dev: now.dev, ino: now.ino, mode: now.mode, uid: now.uid, gid: now.gid }, expected, 'Shared lock directory')
    same(identity(receipt), receiptIdentity, 'Shared lock owner'); same(hash(receipt), receiptHash, 'Shared lock receipt')
    unlinkSync(receipt); rmdirSync(path)
  }
}
/** Same complete-thread/zero-pending policy as restart-when-idle; target supplied only by fixed NEW adapter. */
export async function workflow(ops) {
  let published = false, restarted = false
  try {
    await ops.preflight()
    const waitIdle = async check => {
      for (let n = 0; n < (ops.limit ?? 4320); n++) {
        check()
        const first = await ops.readiness()
        ops.state(published ? 'published-waiting-idle' : 'waiting-for-idle', { readiness: first })
        if (idle(first)) {
          await ops.sleep(5000); check()
          if (idle(await ops.readiness())) return
        }
        await ops.sleep(10000)
      }
      throw Error('Idle wait deadline reached')
    }
    await waitIdle(() => ops.assertBaseline())
    ops.acquirePublication?.()
    ops.assertBaseline(); ops.backup(); ops.assertBaseline()
    if (!idle(await ops.readiness())) throw Error('New work arrived before publication; nothing installed')
    ops.assertBaseline() // Last synchronous drift check before any writes.
    ops.state('publishing'); published = true; ops.publish()
    // A turn arriving during publication must finish before ordinary restart.
    await waitIdle(() => ops.assertPublished())
    if (!idle(await ops.readiness())) throw Error('New work arrived before restart; published bytes retained for recovery')
    ops.assertPublished(); ops.state('restarting'); await ops.restart(); restarted = true
    const evidence = await ops.verify(); await ops.finalize(evidence)
    ops.state('complete', { evidence })
    return evidence
  } catch (error) {
    ops.state('failed', { published, restarted, reason: String(error) })
    // Never restore data/key/config or plaintext automatically after ambiguous failure.
    throw error
  } finally { ops.releasePublication?.() }
}

