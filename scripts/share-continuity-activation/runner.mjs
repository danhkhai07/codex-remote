import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'
import { setTimeout as sleep } from 'node:timers/promises'
import { HOSTS, PAYLOAD, PORTS, TARGET_SOURCE, assertNoAttempt, exclusive, patchEnvironment } from './plan.mjs'

const release = dirname(fileURLToPath(import.meta.url)), R = '/root/RUNNING-SERVICES/codex-remote-secure', S = '/root/.local/state/codex-remote-secure'
const ENV = S + '/instance.env', SERVICE = 'codex-remote-secure.service', ORIGIN = 'https://remote.danhkhai.io.vn'
const sealedBeforeImport = JSON.parse(readFileSync(release + '/seal.json', 'utf8'))
for (const [path, expected] of Object.entries(sealedBeforeImport.files)) assert.equal(createHash('sha256').update(readFileSync(release + '/' + path)).digest('hex'), expected, 'Sealed release drift before frozen import: ' + path)
const module = path => import(pathToFileURL(release + '/frozen/' + path).href)
const { atomic, hash, identity, publicationLock, same, tree, workflow } = await module('release/core.mjs')
const { allReadiness, metadataReadiness } = await module('release/readiness.mjs')
const { loadConfig } = await module('dist-server/config.js'), { maintenanceClient } = await module('scripts/secure-maintenance.mjs')
const json = path => JSON.parse(readFileSync(path, 'utf8')), sha = value => createHash('sha256').update(value).digest('hex')
const manifest = json(release + '/manifest.json'), baseline = json(release + '/baseline.json'), config = loadConfig(parseEnv(readFileSync(ENV, 'utf8')))
assert.equal(manifest.source, TARGET_SOURCE); assert.equal(config.port, 5174); assert.equal(config.host, '127.0.0.1'); assert.equal(config.publicOrigin.origin, ORIGIN)

function mark(path) { return { sha256: hash(path), identity: identity(path) } }
function linkMark(path) { const stat = lstatSync(path); assert(stat.isSymbolicLink()); return { target: realpathSync(path), dev: String(stat.dev), ino: String(stat.ino), mode: String(stat.mode), uid: String(stat.uid), gid: String(stat.gid) } }
function unit(name) {
  const values = Object.fromEntries(execFileSync('systemctl', ['show', name, '-p', 'MainPID', '-p', 'ActiveState', '-p', 'UnitFileState', '-p', 'ExecMainStartTimestampMonotonic'], { encoding: 'utf8' }).trim().split('\n').map(line => line.split('=')))
  return { ...values, definition: sha(execFileSync('systemctl', ['cat', name])) }
}
function hours() {
  return Object.fromEntries(readdirSync(S + '/hours').sort().flatMap(name => {
    const path = S + '/hours/' + name, stat = lstatSync(path); return stat.isFile() ? [[name, mark(path)]] : []
  }))
}
function snapshot() {
  const env = parseEnv(readFileSync(ENV, 'utf8'))
  return {
    units: { new: unit(SERVICE), old: unit('codex-remote.service') },
    runtime: { backend: tree(R + '/dist-server'), client: tree(R + '/dist'), scripts: tree(R + '/scripts') },
    env: mark(ENV), key: mark(env.CODEX_REMOTE_SECURE_KEY_FILE), registry: mark(env.CODEX_REMOTE_SERVICES_FILE), grants: mark(env.CODEX_REMOTE_PREVIEW_SHARE_STATE),
    nginx: { path: baseline.nginx.path, enabledLink: linkMark('/etc/nginx/sites-enabled/codex-preview-ports'), ...mark(baseline.nginx.path) },
    certificate: { path: baseline.certificate.path, liveLink: linkMark('/etc/letsencrypt/live/codex-preview-ports-v2/fullchain.pem'), keyPath: baseline.certificate.keyPath,
      keyLiveLink: linkMark('/etc/letsencrypt/live/codex-preview-ports-v2/privkey.pem'), key: mark(baseline.certificate.keyPath), renewal: mark('/etc/letsencrypt/renewal/codex-preview-ports-v2.conf'),
      lineage: baseline.certificate.lineage, ...mark(baseline.certificate.path), sans: HOSTS },
    hours: hours(), hoursRuntime: {
      generator: mark(R + '/working-hours/update.py'), adapter: mark(R + '/scripts/remote-instance/hours-update.py'),
      template: mark(R + '/working-hours/dashboard.template.html'), backend: mark(R + '/dist-server/work-hours.js'), backendMap: mark(R + '/dist-server/work-hours.js.map'),
    },
    dependencies: { nodeModules: realpathSync(R + '/node_modules'), package: mark(R + '/package.json'), lock: mark(R + '/package-lock.json') },
  }
}
function expected(published, restarted = false) {
  const value = structuredClone(baseline); delete value.at; delete value.source; delete value.runnerSource; delete value.sourceTree; delete value.sourceFiles; delete value.envCurrentPorts; delete value.envPatchedSha256
  if (published) {
    for (const path of PAYLOAD) {
      const [root, ...parts] = path.split('/'), name = parts.join('/'), target = root === 'dist-server' ? value.runtime.backend : value.runtime.scripts
      target[name] = manifest.payload[path]
    }
    value.env.sha256 = baseline.envPatchedSha256; delete value.env.identity
  }
  if (restarted) { delete value.units.new.MainPID; delete value.units.new.ExecMainStartTimestampMonotonic }
  return value
}
function observed(published, restarted = false) {
  const value = snapshot()
  if (published) delete value.env.identity
  if (restarted) { delete value.units.new.MainPID; delete value.units.new.ExecMainStartTimestampMonotonic }
  return value
}
function assertSnapshot(published, restarted = false) { same(observed(published, restarted), expected(published, restarted), 'Runtime/client/config/state/TLS/Hours/key/dependency/process preimages') }
function validate() {
  const seal = json(release + '/seal.json')
  assert.equal(seal.status, 'review-required-not-armed')
  for (const [path, expectedHash] of Object.entries(seal.files)) assert.equal(hash(release + '/' + path), expectedHash, 'Sealed release drift: ' + path)
  assert.deepEqual(Object.keys(manifest.payload).sort(), [...PAYLOAD].sort()); assert.equal(manifest.clientWrites, 0); assert.equal(manifest.stateWrites, 0)
  assert.equal(realpathSync(release + '/frozen/node_modules'), baseline.dependencies.nodeModules, 'Frozen dependency link drift')
  return seal
}
async function auth(fn) { const client = await maintenanceClient(config); try { return await fn(client) } finally { client.close() } }
async function api(client, path) { const response = await client.fetch(path, { signal: AbortSignal.timeout(15000) }); assert(response.ok, `Encrypted read ${path}: ${response.status}`); return response.json() }
async function readiness() {
  return auth(async client => allReadiness(path => api(client, path), metadataReadiness, () => json(S + '/vault/.state/Orchestration.json')))
}
function curlStatus(host, local = false) {
  const args = ['--silent', '--show-error', '--output', '/dev/null', '--write-out', '%{http_code}', '--max-time', '15']
  if (local) args.push('--resolve', `${host}:443:127.0.0.1`)
  args.push('https://' + host + '/')
  return Number(execFileSync('curl', args, { encoding: 'utf8' }))
}
async function verify() {
  assert(existsSync(release + '/apply-attempt.json'), 'No activation attempt; verify-only is not an apply command')
  let healthy = false
  for (let i = 0; i < 30; i++) { try { const response = await fetch('http://127.0.0.1:5174/api/healthz', { signal: AbortSignal.timeout(1000) }); if (response.ok) { healthy = true; break } } catch {} await sleep(1000) }
  assert(healthy, 'Replacement NEW process did not become healthy')
  assertSnapshot(true, true)
  assert.notEqual(unit(SERVICE).MainPID, baseline.units.new.MainPID, 'Expected one replacement NEW PID')
  assert.equal((await fetch(ORIGIN + '/api/healthz', { signal: AbortSignal.timeout(15000) })).status, 200)
  for (const host of HOSTS) { assert.equal(curlStatus(host), 401, 'Public preview host must be auth-gated: ' + host); assert.equal(curlStatus(host, true), 401, 'Loopback preview host must be auth-gated: ' + host) }
  const readOnly = await auth(async client => ({ services: await api(client, '/api/services'), shares: await api(client, '/api/preview-shares') }))
  assert(Array.isArray(readOnly.services.services)); assert(readOnly.services.services.every(service => !service.port || PORTS.includes(service.port)))
  assert(readOnly.services.services.every(service => typeof service.registrationId === 'string' && service.registrationId.length > 0))
  assert(Array.isArray(readOnly.shares.links) && Array.isArray(readOnly.shares.services))
  assertSnapshot(true, true)
  const evidence = { status: 'verified-live', at: new Date().toISOString(), source: TARGET_SOURCE, oldPid: baseline.units.new.MainPID, newPid: unit(SERVICE).MainPID,
    payload: manifest.payload, hosts: Object.fromEntries(HOSTS.map(host => [host, { public: 401, loopback: 401 }])), encryptedReadOnly: true,
    sharesCreated: 0, clientWrites: 0, registryAndGrantsUnchanged: true, hoursUnchanged: true, oldDisabled: true }
  atomic(release + '/verified.json', JSON.stringify(evidence, null, 2) + '\n'); return evidence
}
function adapter() {
  let unlock
  const state = (status, detail = {}) => atomic(release + '/status.json', JSON.stringify({ status, at: new Date().toISOString(), source: TARGET_SOURCE, ...detail }, null, 2) + '\n')
  return {
    preflight: async () => { validate(); assertSnapshot(false) }, assertBaseline: () => assertSnapshot(false), assertPublished: () => assertSnapshot(true), readiness, sleep,
    acquirePublication: () => { unlock = publicationLock('/root/.local/state/codex-remote/deployment.lock', { kind: 'NEW-share-service-continuity', pid: process.pid, release, source: TARGET_SOURCE }) },
    releasePublication: () => { if (unlock) { unlock(); unlock = undefined } },
    backup: () => {
      assert(!existsSync(release + '/backup'), 'Backup exists; never replay an activation attempt'); mkdirSync(release + '/backup', { mode: 0o700 })
      const env = parseEnv(readFileSync(ENV, 'utf8')), files = { env: ENV, registry: env.CODEX_REMOTE_SERVICES_FILE, grants: env.CODEX_REMOTE_PREVIEW_SHARE_STATE,
        servicesJs: R + '/dist-server/services.js', servicesMap: R + '/dist-server/services.js.map', servicesCli: R + '/scripts/services.mjs' }
      const receipt = {}
      for (const [label, path] of Object.entries(files)) { const bytes = readFileSync(path); atomic(release + '/backup/' + label, bytes, lstatSync(path).mode & 0o777); receipt[label] = { path, sha256: sha(bytes), identity: identity(path) } }
      exclusive(release + '/backup/manifest.json', receipt)
    },
    publish: () => {
      for (const path of PAYLOAD) { const target = R + '/' + path; atomic(target, readFileSync(release + '/payload/' + path), lstatSync(target).mode & 0o777); state('publishing', { lastFile: path }) }
      atomic(ENV, patchEnvironment(readFileSync(ENV), parseEnv), lstatSync(ENV).mode & 0o777); state('published-awaiting-final-idle')
      assertSnapshot(true)
    },
    restart: async () => { exclusive(release + '/restart-intent.json', { service: SERVICE, at: new Date().toISOString() }); execFileSync('systemctl', ['restart', SERVICE], { timeout: 60000, stdio: 'ignore' }) },
    verify, finalize: async () => {}, state,
  }
}

const [mode, sealHash] = process.argv.slice(2); assert(['check', 'arm', 'apply', 'verify'].includes(mode), 'Use check|arm|apply|verify')
validate()
if (mode === 'check') {
  assertSnapshot(false)
  for (const host of HOSTS) { assert.equal(curlStatus(host), 401, 'Public TLS/auth baseline: ' + host); assert.equal(curlStatus(host, true), 401, 'Loopback TLS/auth baseline: ' + host) }
  console.log(JSON.stringify({ status: 'checked-not-armed', readiness: await readiness(), tenHostTlsAndAuth: true, seal: hash(release + '/seal.json') }))
}
else if (mode === 'arm') {
  assert.equal(sealHash, hash(release + '/seal.json'), 'Exact reviewed seal hash required'); assertNoAttempt(existsSync(release + '/apply-attempt.json'))
  exclusive(release + '/armed.json', { status: 'armed', at: new Date().toISOString(), seal: sealHash, source: TARGET_SOURCE }); console.log(JSON.stringify({ status: 'armed', applyStarted: false }))
} else if (mode === 'verify') {
  const ops = adapter(); ops.acquirePublication(); try { console.log(JSON.stringify(await verify())) } finally { ops.releasePublication() }
} else {
  assert.equal(process.env.CODEX_HEAVY_ACTIVE, '1', 'Apply must run through codex-heavy'); assert(existsSync(release + '/armed.json'), 'Activation is not armed')
  assert.equal(json(release + '/armed.json').seal, hash(release + '/seal.json')); assertNoAttempt(existsSync(release + '/apply-attempt.json'))
  exclusive(release + '/apply-attempt.json', { at: new Date().toISOString(), pid: process.pid, source: TARGET_SOURCE }); await workflow(adapter())
}
