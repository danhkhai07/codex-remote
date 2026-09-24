import assert from 'node:assert/strict'
import { readFileSync, existsSync, mkdirSync, symlinkSync, realpathSync, openSync, closeSync, writeFileSync, fsyncSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { parseEnv } from 'node:util'
import { setTimeout as sleep } from 'node:timers/promises'
import { hash, sha, same, tree, identity, atomic, publicationLock, workflow } from './core.mjs'
import { allReadiness } from './readiness.mjs'

const R = '/root/RUNNING-SERVICES/codex-remote-secure'
const S = '/root/.local/state/codex-remote-secure'
const SERVICE = 'codex-remote-secure.service', ORIGIN = 'https://remote.danhkhai.io.vn'
const ENV = S + '/instance.env', KEY = S + '/secure-owner/owner-key.json'
const OLD_TEMPLATE = 'b2b5f55f45f151391e274cc8b3f20c62eab025b9bc22f094b4ec470422537b81'
export const BACKEND = ['controller', 'index', 'push'].flatMap(n => [`dist-server/${n}.js`, `dist-server/${n}.js.map`])
const runnerNames = ['deploy.mjs', 'core.mjs', 'readiness.mjs']
const json = p => JSON.parse(readFileSync(p, 'utf8'))
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
const exclusive = (p, value) => {
  const fd = openSync(p, 'wx', 0o600)
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
  const directory = openSync(dirname(p), 'r'); try { fsyncSync(directory) } finally { closeSync(directory) }
}
function units() {
  return Object.fromEntries([SERVICE, 'codex-remote.service'].map(name => {
    const props = Object.fromEntries(execFileSync('systemctl', ['show', name, '-p', 'MainPID', '-p', 'ActiveState', '-p', 'UnitFileState', '-p', 'ExecMainStartTimestamp'], { encoding: 'utf8' }).trim().split('\n').map(s => s.split('=')))
    return [name, { ...props, definition: sha(execFileSync('systemctl', ['cat', name])) }]
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
  assert(resolve(env.CODEX_REMOTE_PUSH_STATE).startsWith(S + '/'), 'NEW push state required')
  return env
}
function snapshot() {
  const env = environment(), service = units()
  assert.equal(service['codex-remote.service'].MainPID, '0'); assert.equal(service['codex-remote.service'].ActiveState, 'inactive')
  assert.equal(service['codex-remote.service'].UnitFileState, 'disabled')
  assert.equal(service[SERVICE].ActiveState, 'active'); assert(Number(service[SERVICE].MainPID) > 1)
  const push = json(env.CODEX_REMOTE_PUSH_STATE)
  assert(push.keys?.publicKey && push.keys.privateKey, 'Missing existing VAPID identity')
  return { backend: tree(R + '/dist-server'), client: tree(R + '/dist'), scripts: tree(R + '/scripts'),
    template: hash(R + '/working-hours/dashboard.template.html'), isolatedTemplate: hash(S + '/hours/dashboard.template.html'), generator: hash(R + '/working-hours/update.py'),
    env: hash(ENV), key: identity(KEY), vapid: sha(JSON.stringify(push.keys)),
    dependencies: { path: realpathSync(R + '/node_modules'), package: hash(R + '/package.json'), lock: hash(R + '/package-lock.json') }, units: service }
}
function freeze(target) {
  const files = {}
  const visit = p => {
    if (files[p]) return
    const absolute = resolve(R, p); assert(absolute.startsWith(R + '/'))
    const bytes = readFileSync(absolute); atomic(join(target, p), bytes); files[p] = sha(bytes)
    for (const m of bytes.toString().matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)) visit(relative(R, resolve(dirname(absolute), m[1])))
  }
  for (const p of ['package.json', 'dist-server/config.js', 'scripts/secure-maintenance.mjs', 'scripts/restart-readiness.mjs']) visit(p)
  symlinkSync(realpathSync(R + '/node_modules'), target + '/node_modules')
  return files
}
function prepare(release, artifacts, evidencePath) {
  assert(!existsSync(release), 'Create a new release, never overwrite an existing one')
  const worktree = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  assert.equal(git(worktree, 'status', '--porcelain', '--untracked-files=no'), '', 'Dirty source')
  const evidence = json(evidencePath)
  assert.equal(evidence.source, git(worktree, 'rev-parse', 'HEAD'), 'Evidence must match this candidate')
  assert.equal(evidence.liveSource, 'b67d1dc817658b36102c156694b2eeb98e1626e3', 'Expected previously verified LIVE release')
  assert.equal(evidence.checks?.status, 'passed', 'Build/check/browser evidence required before packaging')
  for (const log of evidence.checks.logs ?? []) same(hash(log.path), log.sha256, 'Check log')
  assert((evidence.checks.logs?.length ?? 0) >= 2, 'Require app and browser check logs')
  assert.equal(git(artifacts, 'rev-parse', 'HEAD'), evidence.source)
  // Reuse verified app artifacts only if runtime code/source remains identical.
  assert.equal(git(worktree, 'diff', evidence.source, '--', 'src', 'public', 'server', 'package.json', 'package-lock.json', 'vite.config.ts', 'index.html'), '')
  same(tree(artifacts + '/dist'), evidence.candidateFrontend, 'Complete client artifact inventory')
  for (const [p, h] of Object.entries(evidence.candidateFrontend)) same(hash(artifacts + '/dist/' + p), h, 'Frontend artifact')
  for (const p of BACKEND) same(hash(artifacts + '/' + p), evidence.backendDelta[p.slice(12)].candidate, 'Backend artifact')
  mkdirSync(release, { mode: 0o700 })
  const payload = {}
  for (const p of [...BACKEND, ...Object.keys(evidence.candidateFrontend).map(p => 'dist/' + p)]) {
    const bytes = readFileSync(artifacts + '/' + p); atomic(release + '/payload/' + p, bytes); payload[p] = sha(bytes)
  }
  const frozen = freeze(release + '/frozen'), runner = {}
  for (const p of runnerNames) { const bytes = readFileSync(dirname(fileURLToPath(import.meta.url)) + '/' + p); atomic(release + '/' + p, bytes); runner[p] = sha(bytes) }
  const manifest = { version: 1, status: 'prepared-pending-fresh-baseline-and-review', source: git(worktree, 'rev-parse', 'HEAD'), worktree,
    appSource: evidence.source, sourceTemplate: hash(worktree + '/working-hours/dashboard.template.html'), payload, frozen, runner,
    expectedBackendBaseline: evidence.observedRuntimeBackend,
    dependencies: realpathSync(R + '/node_modules'), artifactEvidence: { path: evidencePath, sha256: hash(evidencePath) },
    pending: ['Fresh NEW baseline preserving corrected Hours LIVE receipt', 'Leader review of answer-content delta and runner', 'ALL-idle; no own-task exemptions'] }
  exclusive(release + '/manifest.json', manifest)
  console.log(JSON.stringify({ status: manifest.status, release, manifest: hash(release + '/manifest.json'), source: manifest.source, armed: false }))
}
function validate(release) {
  const m = json(release + '/manifest.json')
  assert.equal(m.version, 1)
  same(Object.keys(m.runner).sort(), [...runnerNames].sort(), 'Runner allowlist')
  same(Object.keys(m.payload).filter(p => !p.startsWith('dist/')).sort(), [...BACKEND].sort(), 'Backend allowlist')
  assert(m.payload['dist/index.html'] && m.payload['dist/sw.js'])
  for (const [section, prefix] of [['runner', ''], ['payload', 'payload/'], ['frozen', 'frozen/']]) {
    for (const [p, h] of Object.entries(m[section])) {
      assert(!p.startsWith('/') && !p.split('/').includes('..'), 'Unsafe manifest path')
      same(hash(release + '/' + prefix + p), h, section + ' bytes')
    }
  }
  same(realpathSync(release + '/frozen/node_modules'), m.dependencies, 'Frozen dependency path')
  same(git(m.worktree, 'rev-parse', 'HEAD'), m.source, 'Candidate HEAD')
  assert.equal(git(m.worktree, 'status', '--porcelain', '--untracked-files=no'), '', 'Dirty candidate')
  return m
}
function baseline(release, receiptPath) {
  const m = validate(release)
  assert(!existsSync(release + '/baseline.json') && !existsSync(release + '/seal.json'), 'Baseline is immutable; prepare a new package')
  const receipt = json(receiptPath)
  assert.equal(receipt.status, 'LIVE'); assert(String(receipt.task ?? receipt.taskId).startsWith('669d66d4'), 'Require CR4 corrected chart receipt')
  same(hash(join(dirname(receiptPath), 'verified.json')), receipt.evidence?.['verified.json'], 'CR4 verification evidence')
  const b = snapshot()
  same(b.backend, m.expectedBackendBaseline, 'Reviewed backend baseline')
  assert(b.template !== OLD_TEMPLATE, 'Superseded today-chip template cannot be sealed')
  assert(!readFileSync(R + '/working-hours/dashboard.template.html', 'utf8').includes('id="today-worked"'), 'Old chip remains')
  same(b.template, receipt.templateSha256, 'CR4 corrected template receipt')
  same(b.template, b.isolatedTemplate, 'Hours template agreement')
  same(b.template, m.sourceTemplate, 'Integrate corrected Hours source then re-prepare; no frontend rebuild needed for template-only source')
  // All frozen runtime files must still match this fresh baseline.
  for (const [p, h] of Object.entries(m.frozen)) same(hash(R + '/' + p), h, 'Frozen runtime closure')
  const record = { ...b, receipt: { path: resolve(receiptPath), sha256: hash(receiptPath) } }
  exclusive(release + '/baseline.json', record)
  exclusive(release + '/seal.json', { manifest: hash(release + '/manifest.json'), baseline: hash(release + '/baseline.json') })
  console.log(JSON.stringify({ status: 'baselined-not-armed', seal: hash(release + '/seal.json') }))
}
async function adapter(release) {
  const m = validate(release), seal = json(release + '/seal.json'), b = json(release + '/baseline.json')
  const closure = () => { validate(release); same(hash(release + '/manifest.json'), seal.manifest, 'Manifest'); same(hash(release + '/baseline.json'), seal.baseline, 'Baseline'); same(hash(b.receipt.path), b.receipt.sha256, 'Hours receipt') }
  closure()
  const module = p => import(pathToFileURL(release + '/frozen/' + p).href)
  const { loadConfig } = await module('dist-server/config.js'), { maintenanceClient } = await module('scripts/secure-maintenance.mjs'), { restartReadiness } = await module('scripts/restart-readiness.mjs')
  const config = loadConfig(environment())
  assert.equal(config.publicOrigin.origin, ORIGIN); assert.equal(config.host, '127.0.0.1'); assert.equal(config.port, 5174); assert(config.secureApiRequired)
  const auth = async fn => { const client = await maintenanceClient(config); try { return await fn(client) } finally { client.close() } }
  const api = async (client, path) => { const r = await client.fetch(path, { signal: AbortSignal.timeout(15000) }); assert(r.ok, 'Encrypted read HTTP ' + r.status); return r.json() }
  const readiness = () => auth(c => allReadiness(p => api(c, p), restartReadiness, () => json(S + '/vault/.state/Orchestration.json')))
  const expected = structuredClone(b); delete expected.receipt
  for (const [p, h] of Object.entries(m.payload)) {
    if (p.startsWith('dist/')) expected.client[p.slice(5)] = h
    else expected.backend[p.slice(12)] = h
  }
  const assertSnapshot = (published, afterRestart = false) => {
    closure(); const current = snapshot(), target = published ? expected : { ...b }; delete target.receipt
    if (afterRestart) {
      assert.notEqual(current.units[SERVICE].MainPID, b.units[SERVICE].MainPID, 'Expected replacement PID')
      assert.notEqual(current.units[SERVICE].ExecMainStartTimestamp, b.units[SERVICE].ExecMainStartTimestamp, 'Expected replacement process lifetime')
      current.units[SERVICE].MainPID = target.units[SERVICE].MainPID
      current.units[SERVICE].ExecMainStartTimestamp = target.units[SERVICE].ExecMainStartTimestamp
    }
    same(current, target, 'Runtime/config/key/VAPID/Hours/OLD')
  }
  const state = (status, detail = {}) => atomic(release + '/status.json', JSON.stringify({ status, at: new Date().toISOString(), source: m.source, ...detail }, null, 2) + '\n')
  let unlock
  const backup = () => {
    assert(!existsSync(release + '/backup'), 'Existing backup: inspect partial attempt, never replay apply')
    const files = {}
    for (const p of [...BACKEND, ...Object.keys(b.client).map(p => 'dist/' + p)]) { const bytes = readFileSync(R + '/' + p); atomic(release + '/backup/' + p, bytes); files[p] = sha(bytes) }
    exclusive(release + '/backup/manifest.json', files)
  }
  const publish = () => {
    for (const p of [...Object.keys(m.payload).filter(p => p !== 'dist/index.html').sort(), 'dist/index.html']) {
      atomic(R + '/' + p, readFileSync(release + '/payload/' + p)); state('publishing', { lastFile: p })
    }
    assertSnapshot(true)
  }
  const response = async (url, expectedHash) => {
    const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) }); assert.equal(r.status, 200)
    const bytes = Buffer.from(await r.arrayBuffer()); if (expectedHash) same(sha(bytes), expectedHash, 'HTTP asset'); return bytes
  }
  const verify = async () => {
    let healthy = false
    for (let n = 0; n < 30; n++) { try { await response('http://127.0.0.1:5174/api/healthz'); healthy = true; break } catch { await sleep(1000) } }
    assert(healthy, 'Replacement unhealthy'); assertSnapshot(true, true)
    const html = readFileSync(release + '/payload/dist/index.html', 'utf8')
    const entries = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)].map(x => x[1]); assert(entries.length)
    const { createSession } = await module('dist-server/auth.js')
    const cookie = '__Host-codex_remote_session=' + createSession(config.sessionSecret, 300, config.password).token
    for (const origin of ['http://127.0.0.1:5174', ORIGIN]) {
      for (const route of ['/', '/services', '/files', '/working-hours']) await response(origin + route, m.payload['dist/index.html'])
      for (const path of [...entries, '/sw.js', '/manifest.webmanifest']) await response(origin + path, m.payload['dist' + path])
      await response(origin + '/api/healthz')
      const denied = await fetch(origin + '/api/files/content?path=%2Fetc%2Fhosts', { signal: AbortSignal.timeout(10000) }); assert([401, 403].includes(denied.status)); await denied.arrayBuffer()
      const cookieOnly = await fetch(origin + '/api/files/content?path=%2Fetc%2Fhosts', { headers: { Cookie: cookie }, signal: AbortSignal.timeout(10000) }); assert.equal(cookieOnly.status, 403); await cookieOnly.arrayBuffer()
    }
    await auth(async c => {
      const roots = await api(c, '/api/files/roots'); assert(roots.roots.includes('/'))
      const hosts = await c.fetch('/api/files/content?download=1&path=%2Fetc%2Fhosts', { signal: AbortSignal.timeout(15000) }); assert(hosts.ok); same(sha(Buffer.from(await hosts.arrayBuffer())), hash('/etc/hosts'), 'Owner Files read')
      const hours = await c.fetch('/api/files/content?download=1&path=' + encodeURIComponent(S + '/hours/index.html'), { signal: AbortSignal.timeout(15000) }); assert(hours.ok)
      const content = await hours.text(); assert(content.length > 1000); assert(!content.includes('id="today-worked"'), 'Old Hours chip served')
    })
    assertSnapshot(true, true)
    const evidence = { status: 'verified', source: m.source, units: units(), at: new Date().toISOString(), codeAndIdentitiesPreserved: true, realPushSent: false, physicalIOS: false }
    atomic(release + '/verified.json', JSON.stringify(evidence, null, 2) + '\n'); return evidence
  }
  return { preflight: async () => assertSnapshot(false), assertBaseline: () => assertSnapshot(false), assertPublished: () => assertSnapshot(true), readiness, backup, publish, state, sleep,
    acquirePublication: () => { unlock = publicationLock('/root/.local/state/codex-remote/deployment.lock', { kind: 'NEW-push', pid: process.pid, release, source: m.source }) },
    releasePublication: () => { if (unlock) { unlock(); unlock = undefined } },
    restart: async () => { exclusive(release + '/restart-intent.json', { service: SERVICE, at: new Date().toISOString() }); execFileSync('systemctl', ['restart', SERVICE], { timeout: 60000, stdio: 'ignore' }) },
    verify, finalize: async () => {} }
}
async function main() {
  const [mode, arg, other, evidence] = process.argv.slice(2), release = resolve(arg ?? '')
  assert(dirname(release) === S + '/releases' && release.split('/').at(-1).startsWith('push-browser-'), 'Expected private NEW release path')
  assert(['prepare', 'baseline', 'check', 'apply', 'verify'].includes(mode), 'Use prepare|baseline|check|apply|verify')
  if (mode === 'prepare') return prepare(release, resolve(other), resolve(evidence))
  validate(release)
  if (mode === 'baseline') return baseline(release, resolve(other))
  if (!existsSync(release + '/seal.json')) {
    assert.equal(mode, 'check', 'No corrected Hours baseline/seal; apply forbidden')
    console.log(JSON.stringify({ status: 'payload-valid-pending-corrected-Hours-baseline-and-review', armed: false })); return
  }
  const ops = await adapter(release)
  if (mode === 'check') { await ops.preflight(); console.log(JSON.stringify({ status: 'checked-not-armed', readiness: await ops.readiness() })); return }
  if (mode === 'verify') { ops.acquirePublication(); try { const evidence = await ops.verify(); ops.state('complete', { evidence }) } finally { ops.releasePublication() } return }
  exclusive(release + '/apply-attempt.json', { at: new Date().toISOString(), pid: process.pid })
  await workflow(ops)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1 })
