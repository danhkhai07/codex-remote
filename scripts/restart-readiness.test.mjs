import assert from 'node:assert/strict'
import { test } from 'node:test'
import { restartReadiness } from './restart-readiness.mjs'

const thread = (type, id = 'worker') => ({ id, status: { type } })
function fixture({ threads = [thread('systemError')], turns = [{ status: 'failed' }], detail,
  cursor = null, pending = [], list, pendingResponse, failRead = false } = {}) {
  const calls = []
  const api = async path => {
    calls.push(path)
    if (path === '/api/threads') return list ?? { data: threads, nextCursor: cursor }
    if (path === '/api/pending') return pendingResponse ?? { data: pending }
    if (failRead) throw Error('Read unavailable')
    return detail ?? { ...thread('systemError'), turns }
  }
  return { api, calls }
}

test('quota failure with terminal history permits restart without resuming a turn', async () => {
  const { api, calls } = fixture()
  const result = await restartReadiness(api)
  assert.equal(result.ready, true)
  assert.deepEqual(result.terminalErrors, ['worker'])
  assert.deepEqual(calls, ['/api/threads', '/api/pending', '/api/threads/worker'])
})
test('all known terminal outcomes are allowed for an errored thread', async () => {
  assert.equal((await restartReadiness(fixture({ turns: ['completed', 'failed', 'interrupted'].map(status => ({ status })) }).api)).ready, true)
})
test('active thread still blocks even alongside a terminal error', async () => {
  const result = await restartReadiness(fixture({ threads: [thread('systemError'), thread('active', 'leader')] }).api)
  assert.equal(result.ready, false)
  assert.equal(result.busy, 1)
})
test('inProgress or unknown turn anywhere in error history blocks restart', async () => {
  for (const status of ['inProgress', 'queued', undefined]) {
    assert.equal((await restartReadiness(fixture({ turns: [{ status }, { status: 'failed' }] }).api)).ready, false)
  }
})
test('thread becoming active during read blocks restart despite terminal history', async () => {
  assert.equal((await restartReadiness(fixture({ detail: { ...thread('active'), turns: [{ status: 'failed' }] } }).api)).ready, false)
})
test('missing, empty or mismatched history fails closed', async () => {
  for (const detail of [{ ...thread('systemError') }, { ...thread('systemError'), turns: [] }, { ...thread('systemError', 'other'), turns: [{ status: 'failed' }] }]) {
    assert.equal((await restartReadiness(fixture({ detail }).api)).ready, false)
  }
})
test('unavailable history or an active latest turn cannot be hidden by terminal entries', async () => {
  for (const extra of [{ historyUnavailable: true }, { latestTurn: { status: 'inProgress' } }, { historyCacheTruncated: true, historyTruncation: 'tail' }]) {
    const detail = { ...thread('systemError'), turns: [{ status: 'failed' }], ...extra }
    assert.equal((await restartReadiness(fixture({ detail }).api)).ready, false)
  }
})
test('pagination and pending requests independently block restart', async () => {
  assert.equal((await restartReadiness(fixture({ cursor: 'next' }).api)).ready, false)
  assert.equal((await restartReadiness(fixture({ pending: [{ id: 'input' }] }).api)).ready, false)
})
test('unknown or missing thread status blocks restart', async () => {
  for (const value of [thread('unknown'), {}, null]) {
    assert.equal((await restartReadiness(fixture({ threads: [value] }).api)).ready, false)
  }
})
test('unavailable history and malformed API responses fail closed', async () => {
  for (const opts of [{ failRead: true }, { list: {} }, { pendingResponse: {} }]) {
    await assert.rejects(restartReadiness(fixture(opts).api))
  }
})
test('idle and unloaded threads need no history RPC', async () => {
  const { api, calls } = fixture({ threads: [thread('idle'), thread('notLoaded')] })
  assert.equal((await restartReadiness(api)).ready, true)
  assert.equal(calls.length, 2)
})
