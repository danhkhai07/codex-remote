import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEnv } from 'node:util'
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { BACKEND, CONFIG_PATCH, patchEnvironment, publicationStages, assertDelta, PRESERVED_BUILD_DIFFERENCES } from './plan.mjs'
import { metadataReadiness } from './readiness.mjs'
import { validate, exclusive } from './deploy.mjs'
import { hash } from './core.mjs'

test('exact 12 backend files and backend-healthy-before-SW/index-last ordering', () => {
  assert.equal(BACKEND.length, 12)
  const payload = Object.fromEntries([...BACKEND, 'dist/assets/index-x.js', 'dist/sw.js', 'dist/index.html'].map(p => [p, 'digest']))
  assert.deepEqual(publicationStages(payload).afterHealthy, ['dist/sw.js', 'dist/index.html'])
  assert(!publicationStages(payload).beforeRestart.includes('dist/index.html'))
  assert.throws(() => publicationStages({ ...payload, 'dist-server/secure-api.js': 'x' }))
})
test('config adds only two absent exact nonsecret settings preserving every original byte/value', () => {
  const before = Buffer.from('# comment\nSECRET="fixture $ and spaces"\nNUMBER=5174\nQUOTED=\'a#b\'')
  const after = patchEnvironment(before, parseEnv)
  assert.equal(after.subarray(0, before.length).toString(), before.toString())
  assert.deepEqual(parseEnv(after.toString()), { ...parseEnv(before.toString()), ...CONFIG_PATCH })
  assert.throws(() => patchEnvironment(after, parseEnv), /already exists/)
  assert.throws(() => patchEnvironment(Buffer.from('export CODEX_REMOTE_PREVIEW_SHARE_PORTS=1234\n'), parseEnv), /already exists/)
})
test('unknown backend drift is rejected and historical excluded artifacts remain exact', () => {
  const hours = { 'work-hours.js': 'b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93', 'work-hours.js.map': '6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8' }
  const before = { ...hours, 'unchanged.js': 'same' }, after = { ...before }
  for (const [p, v] of Object.entries(PRESERVED_BUILD_DIFFERENCES)) { before[p] = v.baseline; after[p] = v.candidate }
  for (const p of BACKEND) after[p.slice(12)] = 'new'
  assertDelta(before, after)
  assert.throws(() => assertDelta(before, { ...after, 'unchanged.js': 'drift' }), /Unexpected/)
  assert.throws(() => assertDelta(before, { ...after, 'secure-client.js': 'unknown' }), /Unexpected/)
})
test('readiness is metadata-only and fails closed on pending, pagination or systemError', async () => {
  const calls = [], data = { data: [{ id: 'own', status: { type: 'systemError' } }] }, pending = { data: [] }
  const api = async path => { calls.push(path); assert(['/api/threads', '/api/pending'].includes(path)); return path === '/api/threads' ? data : pending }
  assert.equal((await metadataReadiness(api)).ready, false)
  data.data[0].status.type = 'idle'; assert.equal((await metadataReadiness(api)).ready, true)
  data.nextCursor = 'more'; assert.equal((await metadataReadiness(api)).ready, false)
  delete data.nextCursor; pending.data.push({ id: 'question' }); assert.equal((await metadataReadiness(api)).ready, false)
  assert.equal(calls.some(p => p.startsWith('/api/threads/')), false)
})
test('sealed payload/runner/candidate hashes and exclusive attempt marker reject tamper/replay', () => {
  const root = mkdtempSync(join(tmpdir(), 'share-release-test-')), source = resolve('.')
  try {
    const payload = Object.fromEntries([...BACKEND, 'dist/sw.js', 'dist/index.html'].map(p => {
      const path = join(root, 'payload', p); mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, 'fixture'); return [p, hash(path)]
    }))
    const runner = Object.fromEntries(['deploy.mjs', 'core.mjs', 'readiness.mjs', 'plan.mjs'].map(p => { writeFileSync(join(root, p), p); return [p, hash(join(root, p))] }))
    mkdirSync(join(root, 'frozen')); symlinkSync(source, join(root, 'frozen/node_modules'))
    const manifest = { version: 1, payload, runner, frozen: {}, dependencies: source, worktree: source, source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() }
    writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest)); validate(root)
    writeFileSync(join(root, 'manifest.json'), JSON.stringify({ ...manifest, source: '0'.repeat(40) })); assert.throws(() => validate(root), /Candidate HEAD drift/)
    writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest))
    writeFileSync(join(root, 'payload/dist/sw.js'), 'tampered'); assert.throws(() => validate(root), /payload bytes drift/)
    exclusive(join(root, 'attempt.json'), { attempt: 1 }); assert.throws(() => exclusive(join(root, 'attempt.json'), { attempt: 2 }), /EEXIST/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
