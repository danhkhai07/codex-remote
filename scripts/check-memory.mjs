// Build first, then run with: node --max-old-space-size=128 --expose-gc scripts/check-memory.mjs
// Synthetic histories only: no credentials, network, or real Codex sessions.
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
import { EventHub } from '../dist-server/event-hub.js'

if (!global.gc) throw new Error('Run with --expose-gc')
const fixture = fileURLToPath(new URL('../server/fixtures/fake-codex.mjs', import.meta.url))
const app = new CodexAppServer(process.execPath, [fixture])
const hub = new EventHub()
app.on('message', message => hub.publish('codex', message))
try {
  for (let i = 0; i < 60; i++) {
    const response = await app.request('thread/read', { threadId: 'memory-probe', includeTurns: true })
    assert.equal(response.thread.turns[0].items[0].text.length, 10_000_000)
  }
  assert.equal(hub.stats.retainedEvents, 0, 'RPC histories must never enter replay storage')
  for (let i = 0; i < 300; i++) {
    hub.publish('codex', { method: 'item/commandExecution/outputDelta', params: { delta: `${i}:` + 'x'.repeat(256_000) } })
    assert.ok(hub.stats.retainedBytes <= 16 * 1024 * 1024)
  }
  global.gc()
  const heapMiB = process.memoryUsage().heapUsed / 1024 / 1024
  assert.ok(heapMiB < 80, `Retained heap unexpectedly high: ${heapMiB.toFixed(1)} MiB`)
  console.log(JSON.stringify({ status: 'PASS', fullHistoryReads: 60, historyBytesProcessed: 600_000_000, ...hub.stats, heapMiB: Number(heapMiB.toFixed(1)) }))
} finally { app.stop() }
