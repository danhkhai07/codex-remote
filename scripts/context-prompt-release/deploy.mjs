import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync, symlinkSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'
import { setTimeout as sleep } from 'node:timers/promises'
import { atomic, hash, identity, publicationLock, same, sha, tree, workflow } from './core.mjs'
import { allReadiness } from './readiness.mjs'
import { assertDelta, BACKEND, LIVE_SOURCE } from './plan.mjs'

const R = '/root/RUNNING-SERVICES/codex-remote-secure'
const S = '/root/.local/state/codex-remote-secure'
const SERVICE = 'codex-remote-secure.service'
const ENV = S + '/instance.env'
const KEY = S + '/secure-owner/owner-key.json'
const ORIGIN = 'https://remote.danhkhai.io.vn'
const RUNNERS = ['deploy.mjs', 'core.mjs', 'readiness.mjs', 'plan.mjs']
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
const exclusive = (path, value) => {
  const fd = openSync(path, 'wx', 0o600)
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
  const directory = openSync(dirname(path), 'r'); try { fsyncSync(directory) } finally { closeSync(directory) }
}
const mark = path => existsSync(path) ? { hash: hash(path), identity: identity(path) } : null
function units() {
  return Object.fromEntries([SERVICE, 'codex-remote.service'].map(name => {
    const values = Object.fromEntries(execFileSync('systemctl', ['show', name, '-p', 'MainPID', '-p', 'ActiveState', '-p', 'UnitFileState', '-p', 'ExecMainStartTimestamp'], { encoding: 'utf8' }).trim().split('\n').map(line => line.split('=')))
    return [name, { ...values, definition: sha(execFileSync('systemctl', ['cat', name])) }]
  }))
}
function environment() {
  const env = parseEnv(readFileSync(ENV, 'utf8'))
  assert.equal(env.CODEX_REMOTE_PUBLIC_ORIGIN, ORIGIN)
  assert.equal(env.CODEX_REMOTE_HOST, '127.0.0.1')
  assert.equal(env.CODEX_REMOTE_PORT, '5174')
  assert.equal(env.CODEX_REMOTE_SECURE_API, 'required')
  assert.equal(resolve(env.CODEX_REMOTE_SECURE_KEY_FILE), KEY)
  assert.equal(resolve(env.CODEX_REMOTE_CONTEXT_VAULT), S + '/vault')
  return env
}
function snapshot() {
  const env = environment(), service = units()
  assert.equal(service['codex-remote.service'].MainPID, '0')
  assert.equal(service['codex-remote.service'].ActiveState, 'inactive')
  assert.equal(service['codex-remote.service'].UnitFileState, 'disabled')
  assert.equal(service[SERVICE].ActiveState, 'active')
  assert(Number(service[SERVICE].MainPID) > 1)
  return {
    backend: tree(R + '/dist-server'), client: tree(R + '/dist'), scripts: tree(R + '/scripts'),
    template: hash(R + '/working-hours/dashboard.template.html'), isolatedTemplate: hash(S + '/hours/dashboard.template.html'), generator: hash(R + '/working-hours/update.py'),
    env: hash(ENV), key: identity(KEY), registry: mark(env.CODEX_REMOTE_SERVICES_FILE), shares: mark(env.CODEX_REMOTE_PREVIEW_SHARE_STATE),
    dependencies: { path: realpathSync(R + '/node_modules'), package: hash(R + '/package.json'), lock: hash(R + '/package-lock.json') }, units: service,
  }
}
function freeze(target) {
  const files = {}
  const visit = path => {
    if (files[path]) return
    const absolute = resolve(R, path); assert(absolute.startsWith(R + '/'))
    const bytes = readFileSync(absolute); atomic(join(target, path), bytes); files[path] = sha(bytes)
    for (const match of bytes.toString().matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)) visit(relative(R, resolve(dirname(absolute), match[1])))
  }
  for (const path of ['package.json', 'dist-server/config.js', 'scripts/secure-maintenance.mjs', 'scripts/restart-readiness.mjs']) visit(path)
  symlinkSync(realpathSync(R + '/node_modules'), target + '/node_modules')
  return files
}
function validate(release) {
  const manifest = json(release + '/manifest.json')
  same(Object.keys(manifest.runner).sort(), [...RUNNERS].sort(), 'Runner allowlist')
  same(Object.keys(manifest.payload).sort(), [...BACKEND].sort(), 'Backend allowlist')
  for (const [section, prefix] of [['runner', ''], ['payload', 'payload/'], ['frozen', 'frozen/']]) for (const [path, expected] of Object.entries(manifest[section])) {
    assert(!path.startsWith('/') && !path.split('/').includes('..'), 'Unsafe manifest path')
    same(hash(release + '/' + prefix + path), expected, section + ' bytes')
  }
  same(realpathSync(release + '/frozen/node_modules'), manifest.dependencies, 'Frozen dependency path')
  same(git(manifest.worktree, 'rev-parse', 'HEAD'), manifest.source, 'Candidate HEAD')
  assert.equal(git(manifest.worktree, 'status', '--porcelain', '--untracked-files=no'), '', 'Dirty candidate')
  return manifest
}
function prepare(release, evidencePath) {
  assert(!existsSync(release), 'Create a new release; never overwrite an attempt')
  const worktree = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), evidence = json(evidencePath)
  assert.equal(evidence.source, git(worktree, 'rev-parse', 'HEAD'))
  assert.equal(evidence.liveSource, LIVE_SOURCE)
  assert.equal(evidence.checks.status, 'passed')
  for (const item of evidence.checks.logs) same(hash(item.path), item.sha256, 'Check log')
  same(tree(R + '/dist-server'), evidence.runtimeBackend, 'Fresh backend baseline')
  same(tree(R + '/dist'), evidence.runtimeClient, 'Fresh client baseline')
  assertDelta(evidence.runtimeBackend, tree(worktree + '/dist-server'))
  mkdirSync(release, { mode: 0o700 })
  const payload = {}
  for (const path of BACKEND) { const bytes = readFileSync(worktree + '/' + path); atomic(release + '/payload/' + path, bytes); payload[path] = sha(bytes) }
  const frozen = freeze(release + '/frozen'), runner = {}
  for (const path of RUNNERS) { const bytes = readFileSync(dirname(fileURLToPath(import.meta.url)) + '/' + path); atomic(release + '/' + path, bytes); runner[path] = sha(bytes) }
  const manifest = { version: 1, status: 'prepared', source: evidence.source, liveSource: LIVE_SOURCE, worktree, payload, frozen, runner,
    expectedBackend: evidence.runtimeBackend, expectedClient: evidence.runtimeClient, dependencies: realpathSync(R + '/node_modules'), evidence: { path: evidencePath, hash: hash(evidencePath) } }
  exclusive(release + '/manifest.json', manifest)
  console.log(JSON.stringify({ status: 'prepared', release, source: manifest.source, manifest: hash(release + '/manifest.json') }))
}
function baseline(release) {
  const manifest = validate(release)
  assert(!existsSync(release + '/baseline.json') && !existsSync(release + '/seal.json'), 'Immutable baseline already exists')
  const unlock = publicationLock('/root/.local/state/codex-remote/deployment.lock', { kind: 'NEW-context-prompt-baseline', pid: process.pid, release })
  try {
    const current = snapshot()
    same(current.backend, manifest.expectedBackend, 'Reviewed backend baseline')
    same(current.client, manifest.expectedClient, 'Reviewed client baseline')
    same(current.template, current.isolatedTemplate, 'Hours template agreement')
    for (const [path, expected] of Object.entries(manifest.frozen)) same(hash(R + '/' + path), expected, 'Frozen runtime closure')
    same(snapshot(), current, 'Baseline capture drift')
    exclusive(release + '/baseline.json', current)
    exclusive(release + '/seal.json', { manifest: hash(release + '/manifest.json'), baseline: hash(release + '/baseline.json') })
    console.log(JSON.stringify({ status: 'baselined-not-armed', seal: hash(release + '/seal.json') }))
  } finally { unlock() }
}
async function isolatedProbe() {
  const root = join(tmpdir(), 'codex-remote-installed-context-' + process.pid)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  try {
    const { ContextVault } = await import(pathToFileURL(R + '/dist-server/context-vault.js').href + '?installed=' + Date.now())
    const vault = new ContextVault(root), group = vault.createGroup('Probe').groups[0]
    vault.recordThread({ id: 'probe', cwd: '/tmp' }); vault.assignThread('probe', group.id)
    writeFileSync(join(root, 'Shared/Context.md'), '# Current\n\nCURRENT_PROBE ' + 'background '.repeat(4000))
    const text = vault.prepareContext('probe', { text: 'CURRENT_PROBE' }, 'MANDATORY_PROBE_ROLE').text
    assert(text.includes('CURRENT_PROBE') && text.includes('MANDATORY_PROBE_ROLE'))
    assert(Buffer.byteLength(text) <= 24_000)
    return { assembledBytes: Buffer.byteLength(text), currentTask: true, role: true }
  } finally { rmSync(root, { recursive: true, force: true }) }
}
async function adapter(release) {
  const manifest = validate(release), seal = json(release + '/seal.json'), base = json(release + '/baseline.json')
  const closure = () => { validate(release); same(hash(release + '/manifest.json'), seal.manifest, 'Manifest'); same(hash(release + '/baseline.json'), seal.baseline, 'Baseline') }
  const module = path => import(pathToFileURL(release + '/frozen/' + path).href)
  const { loadConfig } = await module('dist-server/config.js'), { maintenanceClient } = await module('scripts/secure-maintenance.mjs'), { restartReadiness } = await module('scripts/restart-readiness.mjs')
  const config = loadConfig(environment())
  const auth = async fn => { const client = await maintenanceClient(config); try { return await fn(client) } finally { client.close() } }
  const api = async (client, path) => { const response = await client.fetch(path, { signal: AbortSignal.timeout(15_000) }); assert(response.ok, `Encrypted read HTTP ${response.status}`); return response.json() }
  const readiness = () => auth(client => allReadiness(path => api(client, path), restartReadiness, () => json(S + '/vault/.state/Orchestration.json')))
  const expected = structuredClone(base)
  for (const [path, value] of Object.entries(manifest.payload)) expected.backend[path.slice(12)] = value
  const assertSnapshot = (published, restarted = false) => {
    closure(); const current = snapshot(), target = published ? structuredClone(expected) : structuredClone(base)
    if (restarted) {
      assert.notEqual(current.units[SERVICE].MainPID, base.units[SERVICE].MainPID, 'Expected fresh PID')
      current.units[SERVICE].MainPID = target.units[SERVICE].MainPID
      current.units[SERVICE].ExecMainStartTimestamp = target.units[SERVICE].ExecMainStartTimestamp
    }
    same(current, target, 'Runtime/client/config/key/Hours/share identity')
  }
  const state = (status, detail = {}) => atomic(release + '/status.json', JSON.stringify({ status, source: manifest.source, at: new Date().toISOString(), ...detail }, null, 2) + '\n')
  let unlock
  const backup = () => {
    assert(!existsSync(release + '/backup'), 'Existing backup; never replay apply')
    const files = {}
    for (const path of BACKEND) {
      if (!existsSync(R + '/' + path)) { files[path] = null; continue }
      const bytes = readFileSync(R + '/' + path); atomic(release + '/backup/' + path, bytes); files[path] = sha(bytes)
    }
    exclusive(release + '/backup/manifest.json', files)
  }
  const publish = () => { for (const path of BACKEND) { atomic(R + '/' + path, readFileSync(release + '/payload/' + path)); state('publishing', { lastFile: path }) } assertSnapshot(true) }
  const verify = async () => {
    let healthy = false
    for (let attempt = 0; attempt < 30; attempt++) { try { const response = await fetch('http://127.0.0.1:5174/api/healthz', { signal: AbortSignal.timeout(2000) }); healthy = response.ok; if (healthy) break } catch {} await sleep(1000) }
    assert(healthy, 'Replacement unhealthy')
    assertSnapshot(true, true)
    await auth(async client => { const value = await api(client, '/api/knowledge'); assert(Array.isArray(value.notes) && Array.isArray(value.issues), 'Knowledge schema') })
    const probe = await isolatedProbe()
    const evidence = { status: 'verified', source: manifest.source, at: new Date().toISOString(), pid: units()[SERVICE].MainPID, probe, unchangedClientConfigKeyHoursShares: true, oldDisabled: true }
    atomic(release + '/verified.json', JSON.stringify(evidence, null, 2) + '\n'); return evidence
  }
  return { preflight: async () => assertSnapshot(false), assertBaseline: () => assertSnapshot(false), assertPublished: () => assertSnapshot(true), readiness, backup, publish, state, sleep,
    acquirePublication: () => { unlock = publicationLock('/root/.local/state/codex-remote/deployment.lock', { kind: 'NEW-context-prompt', pid: process.pid, release, source: manifest.source }) },
    releasePublication: () => { if (unlock) { unlock(); unlock = undefined } },
    restart: async () => { exclusive(release + '/restart-intent.json', { service: SERVICE, at: new Date().toISOString() }); execFileSync('systemctl', ['restart', SERVICE], { timeout: 60_000, stdio: 'ignore' }) },
    verify, finalize: async evidence => exclusive(release + '/LIVE.json', { status: 'LIVE', ...evidence }),
  }
}
async function main() {
  const [mode, argument, other] = process.argv.slice(2), release = resolve(argument ?? '')
  assert(dirname(release) === S + '/releases' && release.split('/').at(-1).startsWith('context-prompt-'), 'Expected private NEW release path')
  assert(['prepare', 'baseline', 'check', 'arm', 'apply', 'verify'].includes(mode), 'Use prepare|baseline|check|arm|apply|verify')
  if (mode === 'prepare') return prepare(release, resolve(other))
  validate(release)
  if (mode === 'baseline') return baseline(release)
  if (mode === 'arm') {
    same(other, hash(release + '/seal.json'), 'Explicit seal hash')
    assert(!existsSync(release + '/apply-attempt.json'), 'Attempt already exists')
    exclusive(release + '/armed.json', { seal: other, source: validate(release).source, at: new Date().toISOString() })
    console.log(JSON.stringify({ status: 'armed', seal: other })); return
  }
  const ops = await adapter(release)
  if (mode === 'check') { await ops.preflight(); console.log(JSON.stringify({ status: existsSync(release + '/armed.json') ? 'armed-pending-apply' : 'checked-not-armed', readiness: await ops.readiness() })); return }
  if (mode === 'verify') { ops.acquirePublication(); try { const evidence = await ops.verify(); ops.state('complete', { evidence }) } finally { ops.releasePublication() } return }
  const armed = json(release + '/armed.json'); same(armed.seal, hash(release + '/seal.json'), 'Arm seal'); same(armed.source, validate(release).source, 'Armed source')
  exclusive(release + '/apply-attempt.json', { at: new Date().toISOString(), pid: process.pid })
  await workflow(ops)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1 })
