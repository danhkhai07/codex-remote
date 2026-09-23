import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { workflow, atomic, publicationLock, hash, same } from './core.mjs'
import { allReadiness, orchestrationBusy } from './readiness.mjs'

const ready = { ready: true, busy: 0, pending: 0, incomplete: false, queued: 0 }
function fixture() {
  const events = [], statuses = []
  const ops = { limit: 3, preflight: async () => events.push('preflight'),
    assertBaseline: () => events.push('baseline'), assertPublished: () => events.push('published-check'),
    readiness: async () => ({ ...ready }), sleep: async () => events.push('sleep'),
    acquirePublication: () => events.push('lock'), releasePublication: () => events.push('unlock'),
    backup: () => events.push('backup'), publish: () => events.push('publish'),
    restart: async () => events.push('restart'), verify: async () => { events.push('verify'); return { healthy: true } },
    finalize: async () => events.push('finalize'), state: (name, value) => statuses.push([name, value]) }
  return { ops, events, statuses }
}
test('waits for own queued work to really finish and restarts exactly once', async () => {
  const f = fixture(); let reads = 0
  f.ops.readiness = async () => ++reads < 3 ? { ...ready, queued: 1, ready: false } : ready
  await workflow(f.ops)
  assert.equal(f.events.filter(x => x === 'restart').length, 1)
  assert(f.events.indexOf('lock') < f.events.indexOf('backup'))
  assert(f.events.indexOf('backup') < f.events.indexOf('publish'))
  assert(f.events.indexOf('publish') < f.events.indexOf('restart'))
  assert.equal(f.statuses.at(-1)[0], 'complete'); assert.equal(f.events.at(-1), 'unlock')
})
test('never exempts a permanently queued own task', async () => {
  const f = fixture(); f.ops.readiness = async () => ({ ...ready, queued: 1, ready: false })
  await assert.rejects(workflow(f.ops), /deadline/)
  assert(!f.events.includes('publish')); assert(!f.events.includes('restart'))
})
test('rechecks baseline inside acquired lock before backup or writes', async () => {
  const f = fixture(); let locked = false
  f.ops.acquirePublication = () => { locked = true }
  f.ops.assertBaseline = () => { if (locked) throw Error('drift') }
  await assert.rejects(workflow(f.ops), /drift/)
  assert(!f.events.includes('backup')); assert(!f.events.includes('publish'))
})
test('rechecks encrypted idle immediately before publication', async () => {
  const f = fixture(); let calls = 0
  f.ops.readiness = async () => ++calls === 3 ? { ...ready, pending: 1, ready: false } : ready
  await assert.rejects(workflow(f.ops), /before publication/)
  assert(!f.events.includes('publish')); assert(!f.events.includes('restart'))
})
test('partial publication failure is durable evidence, never restart or automatic rollback', async () => {
  const f = fixture(); f.ops.publish = () => { f.events.push('one-file-written'); throw Error('write failure') }
  await assert.rejects(workflow(f.ops), /write failure/)
  assert(!f.events.includes('restart'))
  assert.deepEqual(f.statuses.at(-1), ['failed', { published: true, restarted: false, reason: 'Error: write failure' }])
})
test('new work after publication blocks restart until genuinely completed', async () => {
  const f = fixture(); let calls = 0
  f.ops.readiness = async () => [4, 5].includes(++calls) ? { ...ready, ready: false, busy: 1 } : ready
  await workflow(f.ops); assert.equal(calls, 8)
  assert.equal(f.events.filter(x => x === 'restart').length, 1)
})
test('drift after publishing prevents restart and retains staged code', async () => {
  const f = fixture(); f.ops.assertPublished = () => { throw Error('foreign runtime change') }
  await assert.rejects(workflow(f.ops), /foreign runtime/); assert(!f.events.includes('restart'))
  assert.equal(f.statuses.at(-1)[1].published, true)
})
test('ambiguous restart/verification failures are not retried', async () => {
  for (const failure of ['restart', 'verify']) {
    const f = fixture(); f.ops[failure] = async () => { f.events.push(failure); throw Error('failure') }
    await assert.rejects(workflow(f.ops), /failure/)
    assert.equal(f.events.filter(x => x === 'restart').length, 1)
    assert.equal(f.events.at(-1), 'unlock')
  }
})
test('private atomic code write and lock refuse foreign ownership/drift', () => {
  const root = mkdtempSync(join(tmpdir(), 'push-runner-'))
  try {
    const file = join(root, 'code.js'); atomic(file, 'before'); const before = hash(file)
    atomic(file, 'after'); assert.equal(readFileSync(file, 'utf8'), 'after'); assert.equal(statSync(file).mode & 0o777, 0o600)
    assert.throws(() => same(hash(file), before, 'payload'), /drift/)
    const lock = join(root, 'lock'), release = publicationLock(lock, { task: 'fake', pid: process.pid })
    assert.throws(() => publicationLock(lock, { task: 'other' }), /EEXIST/)
    writeFileSync(join(lock, 'owner.json'), '{}'); assert.throws(release, /drift/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('global state catches queued/starting/orphaned dispatch and pending/sending results', () => {
  for (const status of ['creating', 'queued', 'starting', 'running', 'stopping']) assert(orchestrationBusy({ tasks: [{ status, dispatchPending: false }], notices: [] }) > 0)
  assert.equal(orchestrationBusy({ tasks: [{ status: 'completed', dispatchPending: false }], notices: [{ status: 'sent' }] }), 0)
  assert(orchestrationBusy({ tasks: [{ status: 'completed', dispatchPending: true }], notices: [] }) > 0)
  for (const status of ['pending', 'sending']) assert(orchestrationBusy({ tasks: [], notices: [{ status }] }) > 0)
  assert.throws(() => orchestrationBusy({ tasks: [] }), /Incomplete/)
  assert.throws(() => orchestrationBusy({ tasks: [], notices: [{ status: 'future' }] }), /Unknown/)
})
test('API and global guard jointly fail closed on incomplete, active or queued data', async () => {
  const state = { tasks: [], notices: [] }
  const team = { groupId: 'g', tasks: [], pendingResults: 0 }
  const api = async p => p === '/api/conversation-groups' ? { groups: [{ id: 'g', leaderThreadId: 'leader' }], assignments: { leader: 'g' } } : team
  assert.equal((await allReadiness(api, async () => ready, () => state)).ready, true)
  team.tasks.push({ status: 'queued', dispatchPending: false }); assert.equal((await allReadiness(api, async () => ready, () => state)).ready, false)
  team.tasks = []; state.notices.push({ status: 'sending' }); assert.equal((await allReadiness(api, async () => ready, () => state)).ready, false)
  await assert.rejects(allReadiness(async () => ({}), async () => ready, () => state), /Incomplete/)
  assert.equal((await allReadiness(api, async () => ({ ...ready, incomplete: true, ready: false }), () => state)).ready, false)
})
