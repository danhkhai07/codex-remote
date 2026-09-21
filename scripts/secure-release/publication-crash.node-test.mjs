import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fork, execFile } from 'node:child_process'
import { once } from 'node:events'
import { promisify } from 'node:util'
const script = fileURLToPath(new URL('./publication-crash-child.mjs', import.meta.url)), run = promisify(execFile)
for (const mode of ['SIGKILL', 'SIGTERM', 'failure', 'success']) test('R4 fresh reader retains proof through ' + mode, async () => {
  const root = await mkdtemp(join(tmpdir(), 'release-crash-')); let child
  try {
    if (mode.startsWith('SIG')) {
      child = fork(script, [root, 'wait'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
      await once(child, 'message', { signal: AbortSignal.timeout(10000) })
      child.kill(mode); await once(child, 'exit')
    } else await run(process.execPath, [script, root, mode]).catch(error => { assert.equal(mode, 'failure'); assert.equal(error.code, 1) })
    const value = JSON.parse((await run(process.execPath, [script, root, 'read'])).stdout)
    assert.equal(value.proof.evidence.freshPid, 4242); assert.equal(value.proof.seal, 'fake-seal')
    assert.equal(value.proof.modules['http-app.js'], 'fake-module-hash'); assert.equal(value.proof.evidence.verifiedAt, '2026-09-21T12:00:00Z')
    assert.equal(value.marker.publication.sha256, value.proofHash)
    assert.equal(value.services.status, mode === 'success' ? 'confirmed' : 'dispatching-outcome-unknown')
    assert.equal(value.vault.status, mode === 'success' ? 'confirmed' : 'pending')
    assert.equal(value.marker.status, mode === 'success' ? 'complete' : mode === 'SIGKILL' ? 'running' : 'failed')
  } finally { if (child?.exitCode === null && child?.signalCode === null) child.kill('SIGKILL'); await rm(root, { recursive: true, force: true }) }
})
