import { expect, it } from 'vitest'
import { PendingRequests } from './pendingRequests'
import type { PendingRequest, RemoteEvent } from './types'

const request: PendingRequest = { key: 'q', method: 'item/tool/requestUserInput', params: { threadId: 't', turnId: 'turn', questions: [] }, createdAt: '' }
const event = (id: number, type: 'request' | 'request-resolved'): RemoteEvent => ({ id, at: '', type, payload: type === 'request' ? request : { key: 'q' } })

it('restores an outstanding native question even when its SSE event has fallen out of replay', () => {
  const store = new PendingRequests()
  store.beginEpoch('server')
  expect(store.snapshot({ epoch: 'server', cursor: 2000, data: [request] })).toEqual([request])
})

it('reconciles snapshots and replay regardless of HTTP/SSE arrival order', () => {
  for (const snapshotFirst of [true, false]) {
    const store = new PendingRequests()
    store.beginEpoch('server')
    const snapshot = () => store.snapshot({ epoch: 'server', cursor: 15, data: [] })
    if (snapshotFirst) snapshot()
    store.event(event(10, 'request'))
    if (!snapshotFirst) snapshot()
    expect(store.values()).toEqual([])
    store.event(event(20, 'request'))
    expect(snapshot()).toEqual([request])
    store.event(event(21, 'request-resolved'))
    expect(store.snapshot({ epoch: 'server', cursor: 20, data: [request] })).toEqual([])
    expect(snapshot()).toEqual([])
  }
})

it('does not resurrect an answered question while its response notification is in flight', () => {
  const store = new PendingRequests()
  store.beginEpoch('server')
  store.event(event(10, 'request'))
  store.dismiss('q')
  expect(store.snapshot({ epoch: 'server', cursor: 10, data: [request] })).toEqual([])
  store.event(event(11, 'request-resolved'))
  expect(store.snapshot({ epoch: 'server', cursor: 11, data: [] })).toEqual([])
})

it('clears stale questions on server restart and rejects old in-flight snapshots', () => {
  const store = new PendingRequests()
  store.snapshot({ epoch: 'old', cursor: 100, data: [request] })
  store.beginEpoch('new')
  expect(store.snapshot({ epoch: 'old', cursor: 101, data: [request] })).toEqual([])
  expect(store.snapshot({ epoch: 'new', cursor: 2, data: [request] })).toEqual([request])
})
