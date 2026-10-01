import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { parseEnv } from 'node:util'
import { workflow } from '../preview-share-release/core.mjs'
import { PORT_VALUE, assertNoAttempt, exclusive, patchEnvironment } from './plan.mjs'

const ready = { ready: true, busy: 0, pending: 0, queued: 0, incomplete: false }
function fixture() {
  const events = [], states = []
  const ops = { limit: 2, preflight: async () => events.push('preflight'), assertBaseline: () => events.push('baseline'), assertPublished: () => events.push('published-check'),
    readiness: async () => ready, sleep: async () => {}, acquirePublication: () => events.push('lock'), releasePublication: () => events.push('unlock'),
    backup: () => events.push('backup'), publish: () => events.push('publish'), restart: async () => events.push('restart'), verify: async () => events.push('verify'), finalize: async () => {}, state: (...x) => states.push(x) }
  return { ops, events, states }
}

test('patches only the existing exact share-port assignment', () => {
  const before = Buffer.from('A=one\nCODEX_REMOTE_PREVIEW_SHARE_PORTS=2345,5180\nB="two words"\n')
  const after = patchEnvironment(before, parseEnv).toString()
  assert.equal(parseEnv(after).CODEX_REMOTE_PREVIEW_SHARE_PORTS, PORT_VALUE); assert(after.startsWith('A=one\n')); assert(after.endsWith('B="two words"\n'))
  assert.throws(() => patchEnvironment(Buffer.from('A=1\n'), parseEnv), /exactly one/)
  assert.throws(() => patchEnvironment(Buffer.from('CODEX_REMOTE_PREVIEW_SHARE_PORTS=1\nCODEX_REMOTE_PREVIEW_SHARE_PORTS=2\n'), parseEnv), /exactly one/)
})

test('fake ALL-idle lifecycle publishes once and restarts NEW once', async () => {
  const f = fixture(); await workflow(f.ops)
  assert.equal(f.events.filter(x => x === 'publish').length, 1); assert.equal(f.events.filter(x => x === 'restart').length, 1)
  assert(f.events.indexOf('lock') < f.events.indexOf('backup')); assert(f.events.indexOf('backup') < f.events.indexOf('publish')); assert(f.events.indexOf('publish') < f.events.indexOf('restart'))
})

test('late readiness and baseline drift prevent publication', async () => {
  const f = fixture(); let calls = 0; f.ops.readiness = async () => ++calls === 3 ? { ...ready, ready: false, queued: 1 } : ready
  await assert.rejects(workflow(f.ops), /before publication/); assert(!f.events.includes('publish')); assert(!f.events.includes('restart'))
  const d = fixture(); let locked = false; d.ops.acquirePublication = () => { locked = true }; d.ops.assertBaseline = () => { if (locked) throw Error('preimage drift') }
  await assert.rejects(workflow(d.ops), /preimage drift/); assert(!d.events.includes('backup'))
})

test('SIGKILL leaves durable attempt and partial write, so replay is rejected', async () => {
  const root = mkdtempSync(join(tmpdir(), 'share-continuity-kill-')), marker = join(root, 'attempt.json'), target = join(root, 'services.js')
  try {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `import {exclusive} from ${JSON.stringify(new URL('./plan.mjs', import.meta.url).href)};import{writeFileSync}from'node:fs';exclusive(${JSON.stringify(marker)},{phase:'start'});writeFileSync(${JSON.stringify(target)},'candidate');console.log('written');setInterval(()=>{},1000)`], { stdio: ['ignore', 'pipe', 'inherit'] })
    await once(child.stdout, 'data'); const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited
    assert(existsSync(marker)); assert.equal(readFileSync(target, 'utf8'), 'candidate'); assert.throws(() => assertNoAttempt(existsSync(marker)), /verify-only/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('exclusive marker refuses a second activation generation', () => {
  const root = mkdtempSync(join(tmpdir(), 'share-continuity-attempt-')), marker = join(root, 'attempt.json')
  try { exclusive(marker, { one: true }); assert.throws(() => exclusive(marker, { two: true }), /EEXIST/) } finally { rmSync(root, { recursive: true, force: true }) }
})
