import assert from 'node:assert/strict'
import { readFileSync, existsSync, mkdirSync, symlinkSync, realpathSync, openSync, closeSync, writeFileSync, fsyncSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { parseEnv } from 'node:util'
import { setTimeout as sleep } from 'node:timers/promises'
import { hash, sha, same, tree, identity, atomic, publicationLock, workflow } from './core.mjs'
import { allReadiness, metadataReadiness } from './readiness.mjs'
import { BACKEND, publicationStages, assertDelta, LIVE_SOURCE, CONFIG_PATCH, patchEnvironment } from './plan.mjs'
export { BACKEND } from './plan.mjs'

const R = '/root/RUNNING-SERVICES/codex-remote-secure'
const S = '/root/.local/state/codex-remote-secure'
const SERVICE = 'codex-remote-secure.service', ORIGIN = 'https://remote.danhkhai.io.vn'
const ENV = S + '/instance.env', KEY = S + '/secure-owner/owner-key.json'
const HOURS_TEMPLATE = '703ad317215c7b1b9e7059169c1613d0128cb2a0d993a94e601f33e352e06df0'
const NGINX = '/etc/nginx/sites-enabled/codex-preview-ports'
const LIVE_MARKER = S + '/releases/markdown-table-readable-7649f0c/LIVE.json'
const CERT = '/etc/letsencrypt/live/codex-preview-ports/fullchain.pem'
const fileMark = p => existsSync(p) ? { sha256: hash(p) } : { absent: true }
const runnerNames = ['deploy.mjs', 'core.mjs', 'readiness.mjs', 'plan.mjs']
const json = p => JSON.parse(readFileSync(p, 'utf8'))
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
export const exclusive = (p, value) => {
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
  assert.equal(env.CODEX_REMOTE_SERVICES_FILE, S + '/services.json')
  assert.equal(env.CODEX_REMOTE_SESSION_STATE, S + '/sessions.json')
  assert.equal(env.CODEX_REMOTE_PREVIEW_ORIGIN_TEMPLATE, 'https://p{port}.danhkhai.io.vn')
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
    registry: fileMark(env.CODEX_REMOTE_SERVICES_FILE), grants: fileMark(CONFIG_PATCH.CODEX_REMOTE_PREVIEW_SHARE_STATE),
    liveMarker: hash(LIVE_MARKER), nginx: hash(NGINX), certificate: hash(CERT), hosts: hash('/etc/hosts'),
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
  for (const p of ['package.json', 'dist-server/config.js', 'scripts/secure-maintenance.mjs']) visit(p)
  symlinkSync(realpathSync(R + '/node_modules'), target + '/node_modules')
  return files
}
function prepare(release, artifacts, evidencePath) {
  assert(!existsSync(release), 'Create a new release, never overwrite an existing one')
  const worktree = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  assert.equal(git(worktree, 'status', '--porcelain', '--untracked-files=no'), '', 'Dirty source')
  const evidence = json(evidencePath)
  assert.equal(evidence.source, git(worktree, 'rev-parse', 'HEAD'), 'Evidence must match this candidate')
  assert.equal(evidence.liveSource, LIVE_SOURCE, 'Expected previously verified LIVE release')
  assert.equal(git(worktree, 'diff', evidence.liveSource, '--', 'server/secure-client.ts', 'server/event-hub.ts'), '', 'Preserved historical source changed')
  assert.equal(evidence.checks?.status, 'passed', 'Build/check/browser evidence required before packaging')
  for (const log of evidence.checks.logs ?? []) same(hash(log.path), log.sha256, 'Check log')
  assert((evidence.checks.logs?.length ?? 0) >= 2, 'Require app and browser check logs')
  assert.equal(git(artifacts, 'rev-parse', 'HEAD'), evidence.source)
  // Reuse verified app artifacts only if runtime code/source remains identical.
  assert.equal(git(worktree, 'diff', evidence.source, '--', 'src', 'public', 'server', 'package.json', 'package-lock.json', 'vite.config.ts', 'index.html'), '')
  same(tree(artifacts + '/dist'), evidence.candidateFrontend, 'Complete client artifact inventory')
  for (const [p, h] of Object.entries(evidence.candidateFrontend)) same(hash(artifacts + '/dist/' + p), h, 'Frontend artifact')
  for (const p of BACKEND) same(hash(artifacts + '/' + p), evidence.backendDelta[p.slice(12)].candidate, 'Backend artifact')
  assertDelta(evidence.observedRuntimeBackend, tree(artifacts + '/dist-server'))
  same(hash(artifacts + '/package-lock.json'), hash(R + '/package-lock.json'), 'No dependency change')
  same(tree(R + '/dist-server'), evidence.observedRuntimeBackend, 'Fresh backend baseline')
  same(tree(R + '/dist'), evidence.observedRuntimeFrontend, 'Fresh client baseline')
  mkdirSync(release, { mode: 0o700 })
  const payload = {}
  for (const p of [...BACKEND, ...Object.keys(evidence.candidateFrontend).map(p => 'dist/' + p)]) {
    const bytes = readFileSync(artifacts + '/' + p); atomic(release + '/payload/' + p, bytes); payload[p] = sha(bytes)
  }
  const frozen = freeze(release + '/frozen'), runner = {}
  for (const p of runnerNames) { const bytes = readFileSync(dirname(fileURLToPath(import.meta.url)) + '/' + p); atomic(release + '/' + p, bytes); runner[p] = sha(bytes) }
  const manifest = { version: 1, status: 'prepared-pending-fresh-baseline-and-review', source: git(worktree, 'rev-parse', 'HEAD'), worktree,
    appSource: evidence.source, sourceTemplate: hash(worktree + '/working-hours/dashboard.template.html'), payload, frozen, runner,
    expectedBackendBaseline: evidence.observedRuntimeBackend, expectedClientBaseline: evidence.observedRuntimeFrontend,
    dependencies: realpathSync(R + '/node_modules'), artifactEvidence: { path: evidencePath, sha256: hash(evidencePath) },
    pending: ['Leader and independent review of exact share source, package and runner', 'Fresh ALL-idle; no own-task exemptions'] }
  exclusive(release + '/manifest.json', manifest)
  console.log(JSON.stringify({ status: manifest.status, release, manifest: hash(release + '/manifest.json'), source: manifest.source, armed: false }))
}
export function validate(release) {
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
  if (m.artifactEvidence) same(hash(m.artifactEvidence.path), m.artifactEvidence.sha256, 'Artifact evidence')
  same(realpathSync(release + '/frozen/node_modules'), m.dependencies, 'Frozen dependency path')
  same(git(m.worktree, 'rev-parse', 'HEAD'), m.source, 'Candidate HEAD')
  assert.equal(git(m.worktree, 'status', '--porcelain', '--untracked-files=no'), '', 'Dirty candidate')
  return m
}
function baseline(release) {
  const m = validate(release)
  assert(!existsSync(release + '/baseline.json') && !existsSync(release + '/seal.json'), 'Immutable baseline; prepare a new package')
  const unlock = publicationLock('/root/.local/state/codex-remote/deployment.lock', { kind: 'NEW-share-baseline', pid: process.pid, release })
  try {
    const b = snapshot()
    const live = json(LIVE_MARKER); assert.equal(live.status, 'LIVE'); assert.equal(live.source, '7649f0ce89f2782f7d03b6a38d1cf176d865f53e'); assert.equal(live.backendSource, 'd6990d30b98ec4100e26752213017a90c0559853')
    same(b.backend, m.expectedBackendBaseline, 'Reviewed backend baseline'); same(b.client, m.expectedClientBaseline, 'Reviewed client baseline')
    same(b.template, HOURS_TEMPLATE, 'Accepted Hours'); same(b.template, b.isolatedTemplate, 'Hours agreement'); same(b.template, m.sourceTemplate, 'Hours source')
    const nginx = readFileSync(NGINX, 'utf8'), hosts = CONFIG_PATCH.CODEX_REMOTE_PREVIEW_SHARE_PORTS.split(',').map(p => `p${p}.danhkhai.io.vn`).sort()
    same([...nginx.matchAll(/^\s*(p[0-9]+\.danhkhai\.io\.vn) 1;/gm)].map(x => x[1]).sort(), hosts, 'Exact routed hosts')
    assert(nginx.includes('proxy_pass http://127.0.0.1:5174;'))
    const sans = execFileSync('openssl', ['x509', '-in', CERT, '-noout', '-ext', 'subjectAltName'], { encoding: 'utf8' })
    same([...sans.matchAll(/DNS:([^,\s]+)/g)].map(x => x[1]).sort(), hosts, 'Exact TLS hosts')
    execFileSync('openssl', ['x509', '-in', CERT, '-noout', '-checkend', '86400'], { stdio: 'ignore' })
    for (const [p, h] of Object.entries(m.frozen)) same(hash(R + '/' + p), h, 'Frozen runtime closure')
    const patched = patchEnvironment(readFileSync(ENV), parseEnv)
    atomic(release + '/config/instance.env', patched)
    const preimages = {}
    for (const [label, path] of Object.entries({ env: ENV, registry: environment().CODEX_REMOTE_SERVICES_FILE, grants: CONFIG_PATCH.CODEX_REMOTE_PREVIEW_SHARE_STATE })) {
      preimages[label] = fileMark(path)
      if (existsSync(path)) atomic(release + '/preimages/' + label, readFileSync(path))
    }
    for (const path of [...BACKEND, ...Object.keys(b.client).map(p => 'dist/' + p)]) {
      const label = 'code/' + path; preimages[label] = fileMark(R + '/' + path)
      if (existsSync(R + '/' + path)) atomic(release + '/preimages/' + label, readFileSync(R + '/' + path))
    }
    same(snapshot(), b, 'Baseline capture drift')
    exclusive(release + '/baseline.json', b)
    exclusive(release + '/seal.json', { manifest: hash(release + '/manifest.json'), baseline: hash(release + '/baseline.json'), config: sha(patched), preimages })
    console.log(JSON.stringify({ status: 'baselined-not-armed', seal: hash(release + '/seal.json') }))
  } finally { unlock() }
}
async function adapter(release) {
  const m = validate(release), seal = json(release + '/seal.json'), b = json(release + '/baseline.json')
  const closure = () => { validate(release); same(hash(release + '/manifest.json'), seal.manifest, 'Manifest'); same(hash(release + '/baseline.json'), seal.baseline, 'Baseline'); same(hash(release + '/config/instance.env'), seal.config, 'Patched config');
    for (const [label, mark] of Object.entries(seal.preimages)) same(fileMark(release + '/preimages/' + label), mark, 'Private preimage')
  }
  closure()
  const module = p => import(pathToFileURL(release + '/frozen/' + p).href)
  const { loadConfig } = await module('dist-server/config.js'), { maintenanceClient } = await module('scripts/secure-maintenance.mjs')
  const config = loadConfig(environment())
  assert.equal(config.publicOrigin.origin, ORIGIN); assert.equal(config.host, '127.0.0.1'); assert.equal(config.port, 5174); assert(config.secureApiRequired)
  const auth = async fn => { const client = await maintenanceClient(config); try { return await fn(client) } finally { client.close() } }
  const api = async (client, path) => { const r = await client.fetch(path, { signal: AbortSignal.timeout(15000) }); assert(r.ok, 'Encrypted read HTTP ' + r.status); return r.json() }
  const readiness = () => auth(c => allReadiness(p => api(c, p), metadataReadiness, () => json(S + '/vault/.state/Orchestration.json')))
  const expected = structuredClone(b); expected.env = seal.config
  const partial = structuredClone(expected), stages = publicationStages(m.payload)
  for (const [p, h] of Object.entries(m.payload)) {
    if (p.startsWith('dist/')) expected.client[p.slice(5)] = h
    else expected.backend[p.slice(12)] = h
    if (stages.beforeRestart.includes(p)) {
      if (p.startsWith('dist/')) partial.client[p.slice(5)] = h
      else partial.backend[p.slice(12)] = h
    }
  }
  const swPublished = structuredClone(partial)
  swPublished.client['sw.js'] = expected.client['sw.js']
  const assertSnapshot = (published, afterRestart = false) => {
    closure(); const current = snapshot(), target = published === 'complete' ? expected : published === 'sw' ? swPublished : published ? partial : { ...b }; delete target.receipt
    if (afterRestart) {
      // Registry/grants are mutable after migration; never compare/restore old data.
      delete current.registry; delete current.grants; delete target.registry; delete target.grants;
      assert.notEqual(current.units[SERVICE].MainPID, b.units[SERVICE].MainPID, 'Expected replacement PID')
      assert.notEqual(current.units[SERVICE].ExecMainStartTimestamp, b.units[SERVICE].ExecMainStartTimestamp, 'Expected replacement process lifetime')
      current.units[SERVICE].MainPID = target.units[SERVICE].MainPID
      current.units[SERVICE].ExecMainStartTimestamp = target.units[SERVICE].ExecMainStartTimestamp
    }
    same(current, target, 'Runtime/config/key/VAPID/Hours/OLD')
  }
  for (const [p, h] of Object.entries(m.payload)) if (p.startsWith('dist/assets/') && b.client[p.slice(5)] !== undefined) same(b.client[p.slice(5)], h, 'Immutable asset preimage')
  const state = (status, detail = {}) => atomic(release + '/status.json', JSON.stringify({ status, at: new Date().toISOString(), source: m.source, ...detail }, null, 2) + '\n')
  let unlock
  const backup = () => {
    assert(!existsSync(release + '/backup'), 'Existing backup: inspect partial attempt, never replay apply')
    const files = {}
    for (const [label, path] of Object.entries({ env: ENV, registry: environment().CODEX_REMOTE_SERVICES_FILE, grants: CONFIG_PATCH.CODEX_REMOTE_PREVIEW_SHARE_STATE })) {
      files['private-' + label] = fileMark(path); if (existsSync(path)) atomic(release + '/backup/private-' + label, readFileSync(path))
    }
    for (const p of [...BACKEND, ...Object.keys(b.client).map(p => 'dist/' + p)]) {
      if (!existsSync(R + '/' + p)) { files[p] = null; continue } // New module; rollback tombstone, never user data.
      const bytes = readFileSync(R + '/' + p); atomic(release + '/backup/' + p, bytes); files[p] = sha(bytes)
    }
    exclusive(release + '/backup/manifest.json', files)
  }
  const publish = () => {
    atomic(ENV, readFileSync(release + '/config/instance.env')); state('publishing-config')
    for (const p of stages.beforeRestart) {
      if (p.startsWith('dist/assets/') && existsSync(R + '/' + p)) { same(hash(R + '/' + p), m.payload[p], 'Immutable asset collision'); continue }
      atomic(R + '/' + p, readFileSync(release + '/payload/' + p)); state('publishing', { lastFile: p })
    }
    assertSnapshot(true)
  }
  const response = async (url, expectedHash) => {
    const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) }); assert.equal(r.status, 200)
    const bytes = Buffer.from(await r.arrayBuffer()); if (expectedHash) same(sha(bytes), expectedHash, 'HTTP asset'); return bytes
  }
  const verify = async (publishClient = false) => {
    let healthy = false
    for (let n = 0; n < 30; n++) { try { await response('http://127.0.0.1:5174/api/healthz'); healthy = true; break } catch { await sleep(1000) } }
    assert(healthy, 'Replacement unhealthy')
    let complete = false
    try { assertSnapshot('complete', true); complete = true } catch {
      try { assertSnapshot('sw', true) } catch { assertSnapshot(true, true) }
    }
    // Old index/SW stay served until the new backend is healthy. Assets were
    // staged before restart, old hashed assets remain, index is published LAST.
    if (!complete) {
      assert(publishClient, 'Client publication incomplete; verify-only cannot apply writes')
      for (const p of stages.afterHealthy) {
        atomic(R + '/' + p, readFileSync(release + '/payload/' + p)); state('publishing-client', { lastFile: p })
      }
    }
    assertSnapshot('complete', true)
    const html = readFileSync(release + '/payload/dist/index.html', 'utf8')
    const entries = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)].map(x => x[1]); assert(entries.length)
    const { createSession } = await module('dist-server/auth.js')
    const cookie = '__Host-codex_remote_session=' + createSession(config.sessionSecret, 300, config.password).token
    for (const origin of ['http://127.0.0.1:5174', ORIGIN]) {
      for (const route of ['/', '/services', '/files', '/working-hours']) await response(origin + route, m.payload['dist/index.html'])
      for (const path of Object.keys(m.payload).filter(p => p.startsWith('dist/')).map(p => p.slice(4))) await response(origin + path, m.payload['dist' + path])
      await response(origin + '/api/healthz')
      const denied = await fetch(origin + '/api/files/content?path=%2Fetc%2Fhosts', { signal: AbortSignal.timeout(10000) }); assert([401, 403].includes(denied.status)); await denied.arrayBuffer()
      const cookieOnly = await fetch(origin + '/api/files/content?path=%2Fetc%2Fhosts', { headers: { Cookie: cookie }, signal: AbortSignal.timeout(10000) }); assert.equal(cookieOnly.status, 403); await cookieOnly.arrayBuffer()
    }
    await auth(async c => {
      const shares = await api(c, '/api/preview-shares'); assert(Array.isArray(shares.links) && Array.isArray(shares.services) && typeof shares.serverNow === 'string');
      const ports = CONFIG_PATCH.CODEX_REMOTE_PREVIEW_SHARE_PORTS.split(',').map(Number); assert(shares.services.every(s => ports.includes(s.port)));
      // Read schema without restoring its mutable contents.
      const registry = json(environment().CODEX_REMOTE_SERVICES_FILE); assert(registry.version === 1 && registry.services.every(s => typeof s.identity === 'string')); 
      const roots = await api(c, '/api/files/roots'); assert(roots.roots.includes('/'))
      const hosts = await c.fetch('/api/files/content?download=1&path=%2Fetc%2Fhosts', { signal: AbortSignal.timeout(15000) }); assert(hosts.ok); same(sha(Buffer.from(await hosts.arrayBuffer())), hash('/etc/hosts'), 'Owner Files read')
      const hours = await c.fetch('/api/files/content?download=1&path=' + encodeURIComponent(S + '/hours/index.html'), { signal: AbortSignal.timeout(15000) }); assert(hours.ok)
      const content = await hours.text(); assert(content.length > 1000); assert(!content.includes('id="today-worked"'), 'Old Hours chip served')
    })
    assertSnapshot('complete', true)
    const evidence = { status: 'verified', source: m.source, units: units(), at: new Date().toISOString(), codeAndIdentitiesPreserved: true, realSharesCreated: false, physicalIOS: false }
    atomic(release + '/verified.json', JSON.stringify(evidence, null, 2) + '\n'); return evidence
  }
  return { preflight: async () => assertSnapshot(false), assertBaseline: () => assertSnapshot(false), assertPublished: () => assertSnapshot(true), readiness, backup, publish, state, sleep,
    acquirePublication: () => { unlock = publicationLock('/root/.local/state/codex-remote/deployment.lock', { kind: 'NEW-preview-sharing', pid: process.pid, release, source: m.source }) },
    releasePublication: () => { if (unlock) { unlock(); unlock = undefined } },
    restart: async () => { exclusive(release + '/restart-intent.json', { service: SERVICE, at: new Date().toISOString() }); execFileSync('systemctl', ['restart', SERVICE], { timeout: 60000, stdio: 'ignore' }) },
    verify: () => verify(true), verifyOnly: () => verify(false), finalize: async () => {} }
}
async function main() {
  const [mode, arg, other, evidence] = process.argv.slice(2), release = resolve(arg ?? '')
  assert(dirname(release) === S + '/releases' && release.split('/').at(-1).startsWith('preview-sharing-'), 'Expected private NEW release path')
  assert(['prepare', 'baseline', 'check', 'arm', 'apply', 'verify'].includes(mode), 'Use prepare|baseline|check|arm|apply|verify')
  if (mode === 'prepare') return prepare(release, resolve(other), resolve(evidence))
  validate(release)
  if (mode === 'baseline') return baseline(release)
  if (!existsSync(release + '/seal.json')) {
    assert.equal(mode, 'check', 'No reviewed baseline/seal; apply forbidden')
    console.log(JSON.stringify({ status: 'payload-valid-pending-baseline-and-review', armed: false })); return
  }
  if (mode === 'arm') {
    assert.equal(other, hash(release + '/seal.json'), 'Explicit reviewed seal hash required');
    assert(!existsSync(release + '/apply-attempt.json'), 'Attempt already exists');
    exclusive(release + '/armed.json', { seal: other, source: validate(release).source, at: new Date().toISOString() });
    console.log(JSON.stringify({ status: 'armed', seal: other })); return
  }
  const ops = await adapter(release)
  if (mode === 'check') { await ops.preflight(); console.log(JSON.stringify({ status: existsSync(release + '/armed.json') ? 'armed-pending-apply' : 'checked-not-armed' })); return }
  if (mode === 'verify') { ops.acquirePublication(); try { const evidence = await ops.verifyOnly(); ops.state('complete', { evidence }) } finally { ops.releasePublication() } return }
  const armed = json(release + '/armed.json'); same(armed.seal, hash(release + '/seal.json'), 'Arm seal'); same(armed.source, validate(release).source, 'Armed source')
  exclusive(release + '/apply-attempt.json', { at: new Date().toISOString(), pid: process.pid })
  await workflow(ops)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1 })
