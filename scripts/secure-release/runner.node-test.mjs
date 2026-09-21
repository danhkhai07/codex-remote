import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execute } from './runner.mjs'
import { evidenceErrors, requiredEvidence } from './production.mjs'
import { APP, HOSTS, atomicBytes, tree, fileHash, inside, isIdle } from './common.mjs'
import { verifyClient } from './build.mjs'
function fixture(fail, idle = [{ ready: true, busy: 0, pending: 0, incomplete: false }]) {
  const trace = [], states = [], files = { hours: 'preserved', history: 'preserved', session: 'preserved', oldAsset: 'preserved' }
  let time = 0, n = 0
  const ops = { modules: ['auth.js', 'http-app.js'], now: () => time,
    sleep: async ms => { time += ms }, state: async s => { states.push(structuredClone(s)) },
    oldReadiness: async () => { trace.push('oldReadiness'); return idle[Math.min(n++, idle.length - 1)] },
  }
  for (const name of ['acquire', 'release', 'preflight', 'drift', 'validateReadiness', 'sourceTransition', 'persistProof', 'backup', 'gateIngress', 'preCopy', 'assets', 'assertInstalled', 'activateDependenciesConfig', 'oldWatcherRestart', 'newBackend', 'workboard', 'index', 'openIngress', 'verify', 'bookkeeping']) ops[name] = async () => {
    trace.push(name); if (fail === name) throw Error('fixture:' + name)
    if (name === 'persistProof') return { path: '/fake/postverify.json', sha256: 'fake-seal' }
    if (name === 'verify') return { freshPid: 42, encryptedProof: true }
  }
  ops.install = async path => { trace.push('install:' + path); if (fail === path) throw Error('fixture:' + path); files[path] = 'new' }
  return { ops, trace, states, files }
}
test('old adapter dual checks + third check; old watcher alone restarts, encrypted adapter only after it; index last; state kept', async () => {
  const f = fixture(); await execute(f.ops)
  const at = name => f.trace.indexOf(name)
  assert.equal(f.trace.filter(name => name === 'oldReadiness').length, 3)
  assert(at('backup') < at('gateIngress')); assert(at('gateIngress') < at('preCopy'))
  assert(at('preCopy') < at('sourceTransition')); assert(at('sourceTransition') < at('assets')); assert(at('assets') < at('install:auth.js')); assert(at('assertInstalled') < at('oldWatcherRestart'))
  assert(at('activateDependenciesConfig') < at('oldWatcherRestart')); assert(at('oldWatcherRestart') < at('newBackend'))
  assert(at('newBackend') < at('index')); assert(at('index') < at('openIngress')); assert(at('verify') < at('bookkeeping'))
  assert.equal(f.states.at(-1).status, 'complete'); assert.equal(f.trace.at(-1), 'release')
  assert.deepEqual(Object.fromEntries(Object.entries(f.files).filter(([key]) => !key.endsWith('.js'))), { hours: 'preserved', history: 'preserved', session: 'preserved', oldAsset: 'preserved' })
})
for (const failure of ['preflight', 'drift', 'validateReadiness', 'sourceTransition', 'persistProof', 'backup', 'gateIngress', 'preCopy', 'assets', 'auth.js', 'http-app.js', 'assertInstalled', 'activateDependenciesConfig', 'oldWatcherRestart', 'newBackend', 'workboard', 'index', 'openIngress', 'verify', 'bookkeeping']) test('fail closed / retain exact phase at ' + failure, async () => {
  const f = fixture(failure); await assert.rejects(execute(f.ops), /fixture:/)
  assert.equal(f.states.at(-1).status, 'failed'); assert.equal(f.trace.at(-1), 'release')
  assert.equal(f.trace.filter(value => value === failure || value === 'install:' + failure).length, 1)
  assert(!f.trace.some(value => /rollback|restore/.test(value)))
  if (failure === 'http-app.js') { assert.equal(f.files['auth.js'], 'new'); assert.equal(f.files['http-app.js'], undefined); assert.deepEqual(f.states.at(-1).installed, ['auth.js']) }
  if (['preflight', 'drift', 'preCopy'].includes(failure)) assert(!f.trace.includes('install:auth.js'))
  if (failure === 'bookkeeping') assert.deepEqual(f.states.at(-1).evidence, { freshPid: 42, encryptedProof: true })
})
test('termination retains the actual current phase and copied file list', async () => {
  const f = fixture(); let signal, removed = false
  f.ops.onTerminate = callback => { signal = callback; return () => { removed = true } }
  f.ops.oldWatcherRestart = async () => { await signal(); throw Error('fixture-terminated') }
  await assert.rejects(execute(f.ops), /fixture-terminated/)
  const recorded = f.states.find(value => value.reason === 'terminated')
  assert.equal(recorded.phase, 'old-watcher-restart'); assert.deepEqual(recorded.installed, ['auth.js', 'http-app.js']); assert(removed)
})
for (const status of [{ ready: true, busy: 1, pending: 0, incomplete: false }, { ready: true, busy: 0, pending: 1, incomplete: false }, { ready: true, busy: 0, pending: 0, incomplete: true }, {}, null]) test('ALL-idle fails closed: ' + JSON.stringify(status), async () => {
  assert.equal(isIdle(status), false)
  const f = fixture(undefined, [status]); await assert.rejects(execute(f.ops), /idle-deadline/)
  assert(!f.trace.includes('gateIngress')); assert(!f.trace.includes('install:auth.js'))
})
test('new work before final copy aborts instead of restarting it', async () => {
  const ready = { ready: true, busy: 0, pending: 0, incomplete: false }
  const f = fixture(undefined, [ready, ready, { ...ready, pending: 1 }])
  await assert.rejects(execute(f.ops), /became-busy/)
  assert(!f.trace.includes('install:auth.js')); assert.equal(f.states.at(-1).phase, 'final-precopy-check')
})
test('gate receipts bind exact app/seal/evidence, not mere approved checkboxes', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-gates-'))
  try {
    writeFileSync(join(root, 'report'), 'fake independent report')
    const now = Date.now(), evidence = Object.fromEntries(requiredEvidence.map(name => [name, { app: APP, seal: 'exact-seal', result: 'approved', at: new Date(now).toISOString(), files: [{ path: 'report', sha256: fileHash(join(root, 'report')) }] }]))
    Object.assign(evidence.migration, { procedure: 'fresh profile then direct trusted application URL before entering secrets', freshProfileCreatedAt: new Date(now).toISOString(), profileEvidenceId: 'fake-profile-evidence', oldProfileCredentialsUsed: false, remainingRisk: 'arbitrary-old-profile-not-attestable' })
    Object.assign(evidence.infrastructure, { hosts: HOSTS, tlsMode: 'Full (strict)', canaryDigest: 'fixture-digest', originCertificateFingerprint: 'fixture-origin', publicCertificateFingerprints: {}, renewalDryRun: 'fixture receipt' })
    assert.deepEqual(evidenceErrors(root, 'exact-seal', evidence, now), [])
    assert(evidenceErrors(root, 'other-seal', evidence, now).includes('missing-evidence:protocol'))
    assert(evidenceErrors(root, 'exact-seal', evidence, now + 25 * 60 * 60_000).includes('expired-evidence:protocol'))
    evidence.protocol.app = 'different-app'; assert(evidenceErrors(root, 'exact-seal', evidence, now).includes('missing-evidence:protocol'))
    evidence.migration = { approved: true }; assert(evidenceErrors(root, 'exact-seal', evidence, now).includes('clean-profile-procedure-not-recorded'))
    writeFileSync(join(root, 'report'), 'changed'); assert(evidenceErrors(root, 'exact-seal', evidence, now).includes('evidence-file-drift:fixtures'))
  } finally { rmSync(root, { recursive: true }) }
})
test('atomic copy full bytes, metadata inventory and symlinks; no path traversal', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-copy-'))
  try {
    atomicBytes(join(root, 'entry'), Buffer.alloc(1024 * 1024, 9), 0o600)
    assert.equal(readFileSync(join(root, 'entry')).length, 1024 * 1024)
    const old = tree(root); atomicBytes(join(root, 'entry'), 'new', 0o600); assert.notDeepEqual(tree(root), old)
    symlinkSync('entry', join(root, 'link')); assert.equal(tree(root).link.link, 'entry')
    assert.throws(() => inside(root, '../etc/passwd')); assert.throws(() => inside(root, '/etc/passwd'))
  } finally { rmSync(root, { recursive: true }) }
})
test('module graph detects missing lazy chunk and contaminated fixture source maps', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-graph-'))
  try {
    for (const dir of ['dist/assets', 'src', 'public']) mkdirSync(join(root, dir), { recursive: true })
    writeFileSync(join(root, 'dist/index.html'), '<script src="/assets/index-12345678.js"></script>')
    writeFileSync(join(root, 'dist/assets/index-12345678.js'), 'import("./lazy-12345678.js")')
    writeFileSync(join(root, 'src/App.tsx'), 'real source')
    writeFileSync(join(root, 'dist/sw.js'), 'core'); writeFileSync(join(root, 'public/sw.js'), 'core')
    const inventory = ['dist/index.html', 'dist/assets/index-12345678.js', 'dist/sw.js'].map(path => ({ path }))
    assert.throws(() => verifyClient(root, inventory), /missing-client-import/)
    writeFileSync(join(root, 'dist/assets/lazy-12345678.js'), 'export default 1'); inventory.push({ path: 'dist/assets/lazy-12345678.js' })
    assert.equal(verifyClient(root, inventory).graph.length, 2)
    const map = join(root, 'dist/assets/lazy-12345678.js.map')
    writeFileSync(map, JSON.stringify({ sources: ['../../src/App.tsx'], sourcesContent: ['injected fixture'] })); inventory.push({ path: 'dist/assets/lazy-12345678.js.map' })
    assert.throws(() => verifyClient(root, inventory), /transformed-fixture-source/)
  } finally { rmSync(root, { recursive: true }) }
})
