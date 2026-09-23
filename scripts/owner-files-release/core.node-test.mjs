import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { atomic, ownerEnv, workflow, hash, same, identity, publicationLock, backendDelta } from './core.mjs'
const yes = { ready: true, busy: 0, pending: 0, incomplete: false }, no = { ...yes, ready: false, busy: 1 }
function fixture(checks = [yes, yes, yes, yes, yes, yes]) {
  const root = mkdtempSync(join(tmpdir(), 'owner-rollout-')), target = join(root, 'module.js'), calls = [], states = []
  writeFileSync(target, 'OLD')
  const original = hash(target), key = join(root, 'key.json'); writeFileSync(key, 'FAKE KEY', { mode: 0o600 }); const keyIdentity = identity(key)
  let index = 0
  const ops = {
    preflight: async () => { calls.push('preflight') }, assertBaseline: () => { calls.push('baseline'); assert.equal(hash(target), original); same(identity(key), keyIdentity, 'key') },
    readiness: async () => { calls.push('idle'); return checks[index++] ?? yes }, sleep: async ms => { calls.push('sleep:' + ms) },
    state: (status, data) => states.push({ status, ...data }), backup: () => { calls.push('backup'); atomic(join(root, 'backup'), readFileSync(target)) },
    publish: () => { calls.push('publish'); atomic(target, Buffer.from('NEW')) }, assertPublished: () => { calls.push('published-check'); assert.equal(readFileSync(target, 'utf8'), 'NEW'); same(identity(key), keyIdentity, 'key') },
    restart: async () => { calls.push('restart') }, verify: async () => { calls.push('verify'); return { verified: true } },
    finalize: async () => { calls.push('finalize') },
  }
  return { root, target, key, ops, calls, states, close: () => rmSync(root, { recursive: true, force: true }) }
}
test('owner env changes only two fields, keeps secret bytes/values, rejects another instance', () => {
  const original = 'CODEX_REMOTE_PUBLIC_ORIGIN="https://remote.danhkhai.io.vn"\nCODEX_REMOTE_PORT=5174\nCODEX_REMOTE_SECURE_API=required\nCODEX_REMOTE_PASSWORD="FAKE=x#y"\nCODEX_REMOTE_FILE_ROOTS=/tmp\n'
  const changed = ownerEnv(original); assert(changed.includes('CODEX_REMOTE_PASSWORD="FAKE=x#y"')); assert(changed.includes('CODEX_REMOTE_FILE_ACCESS="owner-full"')); assert(changed.includes('CODEX_REMOTE_FILE_ROOTS="/"'))
  assert.equal(ownerEnv(changed), changed)
  for (const text of [original.replace('remote.danhkhai', 'codex.danhkhai'), original.replace('5174', '5173'), original.replace('required', 'off')]) assert.throws(() => ownerEnv(text))
})
test('publication waits for complete idle twice, backs up before copy and checks again before restart', async () => {
  const f = fixture([no, yes, yes, yes, yes, yes, yes]); try {
    await workflow(f.ops)
    assert.equal(readFileSync(join(f.root, 'backup'), 'utf8'), 'OLD'); assert.equal(readFileSync(f.target, 'utf8'), 'NEW')
    assert(f.calls.indexOf('publish') > f.calls.indexOf('sleep:5000')); assert(f.calls.indexOf('publish') > f.calls.indexOf('backup'))
    assert.equal(f.calls.filter(c => c === 'restart').length, 1); assert.equal(f.states.at(-1).status, 'complete'); assert(f.calls.indexOf('finalize') > f.calls.indexOf('verify'))
  } finally { f.close() }
})
test('unknown/pending/incomplete threads cannot authorize publication', async () => {
  for (const value of [{ ...yes, ready: false }, { ...yes, pending: 1 }, { ...yes, incomplete: true }, null]) {
    const f = fixture([value]); try { f.ops.sleep = async () => { throw Error('fixture wait stopped') }; await assert.rejects(workflow(f.ops)); assert.equal(readFileSync(f.target, 'utf8'), 'OLD'); assert(!f.calls.includes('restart')) } finally { f.close() }
  }
})
test('baseline/key drift during awaited idle fails before publication', async () => {
  const f = fixture(); try {
    f.ops.sleep = async () => { atomic(f.key, Buffer.from('UNEXPECTED')) }
    await assert.rejects(workflow(f.ops)); assert.equal(readFileSync(f.target, 'utf8'), 'OLD'); assert.equal(readFileSync(f.key, 'utf8'), 'UNEXPECTED'); assert(!f.calls.includes('restart'))
  } finally { f.close() }
})
test('new work at the last check does not overwrite or restart', async () => {
  const f = fixture([yes, yes, no]); try { await assert.rejects(workflow(f.ops)); assert.equal(readFileSync(f.target, 'utf8'), 'OLD'); assert(!f.calls.includes('restart')) } finally { f.close() }
})
test('a turn arriving during publication waits instead of being interrupted', async () => {
  const f = fixture([yes, yes, yes, no, yes, yes, yes]); try { await workflow(f.ops); assert(f.states.some(s => s.status === 'published-waiting-idle' && s.readiness.busy === 1)); assert.equal(f.calls.filter(c => c === 'restart').length, 1) } finally { f.close() }
})
test('partial publication and post-restart verification failure preserve evidence, never auto-rollback', async () => {
  for (const phase of ['publish', 'verify', 'finalize']) {
    const f = fixture(); try {
      if (phase === 'publish') f.ops.publish = () => { atomic(f.target, Buffer.from('PARTIAL')); throw Error('simulated copy failure') }
      else f.ops[phase] = async () => { throw Error('simulated ' + phase) }
      await assert.rejects(workflow(f.ops)); assert.equal(f.states.at(-1).status, 'failed'); assert.equal(f.states.at(-1).published, true)
      assert.notEqual(readFileSync(f.target, 'utf8'), 'OLD'); assert.equal(readFileSync(join(f.root, 'backup'), 'utf8'), 'OLD'); assert(!f.states.some(s => s.status === 'complete'))
    } finally { f.close() }
  }
})
test('ordinary restart fixture replaces only its owned gateway child and preserves key/state', async () => {
  const f = fixture(); let child
  try {
    const start = async () => { const p = spawn(process.execPath, ['-e', 'console.log("READY");setInterval(()=>{},1000)'], { stdio: ['ignore', 'pipe', 'pipe'] }); await once(p.stdout, 'data'); return p }
    child = await start(); const before = child.pid, state = join(f.root, 'hours.json'); writeFileSync(state, '{"revision":9,"autoPaused":true}'); const stateHash = hash(state), keyHash = hash(f.key)
    f.ops.restart = async () => { const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended; child = await start() }
    f.ops.verify = async () => { assert.notEqual(child.pid, before); assert.equal(hash(state), stateHash); assert.equal(hash(f.key), keyHash); return { pid: child.pid } }
    await workflow(f.ops); assert.equal(f.states.at(-1).status, 'complete'); assert(existsSync(join(f.root, 'backup')))
  } finally { if (child && child.exitCode === null) { const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended } f.close() }
})

test('atomic publication never deletes a pre-existing temporary file or its evidence', () => {
  const f = fixture(); try {
    const temporary = f.target + '.owner-files-' + process.pid
    writeFileSync(temporary, 'EXISTING EVIDENCE')
    assert.throws(() => atomic(f.target, Buffer.from('NEW')))
    assert.equal(readFileSync(temporary, 'utf8'), 'EXISTING EVIDENCE')
    assert.equal(readFileSync(f.target, 'utf8'), 'OLD')
  } finally { f.close() }
})
test('published files survive a late busy final restart check without interrupting the child', async () => {
  const f = fixture([yes, yes, yes, yes, yes, no]); try {
    await assert.rejects(workflow(f.ops))
    assert.equal(readFileSync(f.target, 'utf8'), 'NEW'); assert.equal(readFileSync(join(f.root, 'backup'), 'utf8'), 'OLD')
    assert(!f.calls.includes('restart')); assert.equal(f.states.at(-1).published, true); assert.equal(f.states.at(-1).restarted, false)
  } finally { f.close() }
})

test('shared publication lock refuses another deployment and never reclaims a changed owner', () => {
  const f = fixture(); try {
    const path = join(f.root, 'deployment.lock'), release = publicationLock(path, { pid: process.pid, task: 'FAKE' })
    assert.throws(() => publicationLock(path, { task: 'OTHER' })); assert(existsSync(join(path, 'owner.json')))
    release(); assert(!existsSync(path))
    const second = publicationLock(path, { task: 'SECOND' }); atomic(join(path, 'owner.json'), Buffer.from('FOREIGN RECEIPT'))
    assert.throws(second); assert.equal(readFileSync(join(path, 'owner.json'), 'utf8'), 'FOREIGN RECEIPT')
  } finally { f.close() }
})

test('only the known pre-existing EventHub map discrepancy is excluded; executable or new map drift fails', () => {
  const base = { 'event-hub.js': 'SAME EXECUTABLE', 'event-hub.js.map': 'a9f820a365e6cca09a1cbce123381795f1eba328b6f5572b70a6503c64f08c33', 'config.js': 'OLD' }
  const compiled = { ...base, 'event-hub.js.map': 'ad743999f176f42d0277b3122bcc17ad0f1d51f60831468c1fed9bf024747fa2', 'config.js': 'NEW' }
  const result = backendDelta(base, compiled); assert.deepEqual(result.changed, ['dist-server/config.js']); assert.equal(result.preserved['event-hub.js.map'].installed, base['event-hub.js.map'])
  assert.throws(() => backendDelta(base, { ...compiled, 'event-hub.js': 'CHANGED' }))
  assert.throws(() => backendDelta(base, { ...compiled, 'event-hub.js.map': 'UNKNOWN' }))
  assert.throws(() => backendDelta({ ...base, 'event-hub.js.map': 'UNEXPECTED BASE' }, compiled))
  assert(backendDelta(base, { ...compiled, 'unrelated.js': 'NEW' }).changed.includes('dist-server/unrelated.js'))
})
