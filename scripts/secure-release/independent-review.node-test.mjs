// Inverse review probes: passing assertions reproduce dffb132 defects, NOT approval.
// All adapter I/O is synthetic; CLI probes use a private fixture and loopback only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm'
import { readFileSync } from 'node:fs'
import { mkdtemp, cp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import * as url from 'node:url'
import { parseEnv } from 'node:util'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { EventEmitter, once } from 'node:events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { execute } from './runner.mjs'
import { APP, BASE, HOSTS, HOURS } from './common.mjs'

const release = process.env.REVIEW_RELEASE
const run = promisify(execFile)
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

async function adapterFixture() {
  const MAIN = '/fake/main', RELEASE = '/fake/release', outside = RELEASE + '.activation'
  const admin = '/etc/nginx/sites-available/codex.danhkhai.io.vn', preview = '/etc/nginx/sites-available/codex-preview-ports'
  const files = new Map(), trace = []
  const put = (p, value) => files.set(p, Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)))
  const read = p => { assert(files.has(p), 'unmocked read: ' + p); return files.get(p) }
  const fileHash = p => p === MAIN + '/dist-server/work-hours.js' ? HOURS : digest(read(p))
  const record = p => files.has(p) ? { uid: 0, gid: 0, mode: 0o644, size: read(p).length, sha256: fileHash(p) } : { absent: true }
  let now = Date.parse('2026-09-21T12:00:00Z'), keyReads = 0, tlsChecks = 0
  const identity = 'MainPID=42\nActiveState=active\nExecMainStartTimestampMonotonic=100'
  put(MAIN + '/.env', 'CODEX_REMOTE_PASSWORD=fake-only\n'); put(admin, 'old-admin'); put(preview, 'old-preview')
  const baseline = { service: identity, workboard: identity, stable: { [MAIN + '/.env']: record(MAIN + '/.env') }, nginxTempDirectories: {}, nginxFiles: { 'sites-available/codex.danhkhai.io.vn': record(admin), 'sites-available/codex-preview-ports': record(preview) }, unitHashes: {}, backend: {}, client: {}, dependencies: {}, workboardDropins: {} }
  const releaseTree = { 'payload/file': { sha256: 'fake sealed bytes' } }
  put(RELEASE + '/metadata.json', { app: APP, base: BASE, main: MAIN, release: RELEASE, hours: HOURS, requiredEncryption: true, keyFile: '/fake/private/key.json', fileRoots: ['/fake/files'] })
  put(RELEASE + '/baseline.json', baseline); put(RELEASE + '/inventory.json', { groups: { backend: [], client: [] } })
  put(RELEASE + '/seal.json', { app: APP, files: releaseTree })
  put(RELEASE + '/dependencies/node_modules/jose/package.json', { version: '6.2.12' })
  put(RELEASE + '/runner/production.mjs', 'fake sealed runner'); put(outside + '/evidence/report', 'fake evidence')
  for (const [name, content] of [['admin-maintenance.conf', 'gated-admin'], ['preview-parked.conf', 'parked-preview']]) put(RELEASE + '/infra/' + name, content)
  const evidence = Object.fromEntries(['protocol', 'infrastructure', 'migration', 'workboard', 'fixtures'].map(name => [name, { app: APP, seal: fileHash(RELEASE + '/seal.json'), result: 'approved', at: new Date(now).toISOString(), files: [{ path: 'evidence/report', sha256: fileHash(outside + '/evidence/report') }] }]))
  Object.assign(evidence.migration, { procedure: 'fake human procedure', freshProfileCreatedAt: new Date(now).toISOString(), profileEvidenceId: 'fake', oldProfileCredentialsUsed: false, remainingRisk: 'arbitrary-old-profile-not-attestable' })
  Object.assign(evidence.infrastructure, { hosts: HOSTS, tlsMode: 'Full (strict)', canaryPath: '/.well-known/acme-challenge/fake', canaryDigest: digest('canary'), originCertificateFingerprint: 'fake-cert', publicCertificateFingerprints: Object.fromEntries(HOSTS.map(host => [host, 'fake-cert'])), renewalDryRun: 'fake receipt' })
  put(outside + '/evidence.json', evidence)
  put(outside + '/authorization.json', { app: APP, seal: fileHash(RELEASE + '/seal.json'), runner: fileHash(RELEASE + '/runner/production.mjs'), evidence: fileHash(outside + '/evidence.json'), action: 'publish-reviewed-release', operator: 'fixture', at: new Date(now).toISOString() })
  const tree = p => {
    if (p === RELEASE) return { ...releaseTree, 'seal.json': record(RELEASE + '/seal.json') }
    if (p === '/etc/nginx') return { 'sites-available/codex.danhkhai.io.vn': record(admin), 'sites-available/codex-preview-ports': record(preview) }
    if ([MAIN + '/dist-server', MAIN + '/dist', MAIN + '/node_modules'].includes(p)) return {}
    throw Error('unmocked tree: ' + p)
  }
  const command = (exe, args) => {
    trace.push([exe, ...args])
    if (exe === 'git' && args[0] === 'rev-parse') return APP
    if (exe === 'git' && args[0] === 'status') return ''
    if (exe === 'git' && args[0] === 'ls-remote') return APP + '\trefs/heads/main'
    if (exe === '/usr/sbin/nginx' && args[0] === '-t') return ''
    if (exe === 'systemctl' && args.join(' ') === 'reload nginx.service') return ''
    throw Error('unmocked command: ' + exe)
  }
  const common = { APP, BASE, HOURS, HOSTS, MAIN, assert: (ok, code) => assert(ok, code), json: p => JSON.parse(read(p)), fileHash, hash: digest, record, tree, command,
    same: (a, b, code) => assert.equal(JSON.stringify(a), JSON.stringify(b), code), inside: (root, name) => path.join(root, name),
    atomicBytes: (p, bytes) => { trace.push(['write', p]); put(p, bytes.toString()) }, serviceIdentity: () => identity }
  const fs = { readFileSync: (p, encoding) => encoding ? read(p).toString() : read(p), existsSync: p => files.has(p) || p.endsWith('/fullchain.pem'), lstatSync: () => ({ mode: 0o700, uid: 0 }),
    ...Object.fromEntries(['mkdirSync', 'rmdirSync', 'renameSync', 'symlinkSync', 'realpathSync'].map(name => [name, () => { throw Error('unexpected filesystem mutation: ' + name) }])) }
  class FakeDate extends Date { static now() { return now } }
  const context = createContext({ Buffer, URL, Date: FakeDate, AbortSignal, process: { env: {}, execPath: '/fake/node' }, setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: async () => new Response('canary') })
  const modules = {
    'node:fs': fs, 'node:path': path, 'node:url': url, 'node:util': { parseEnv }, 'node:child_process': { spawn: () => { throw Error('must not spawn') } }, 'node:timers/promises': { setTimeout: async () => {} }, './common.mjs': common,
    'node:dns/promises': { resolve4: async () => ['192.0.2.1'] },
    'node:tls': { connect: (_options, connected) => { tlsChecks++; const socket = new EventEmitter(); Object.assign(socket, { setTimeout() {}, end() {}, destroy() {}, getPeerCertificate: () => ({ fingerprint256: 'fake-cert' }) }); queueMicrotask(connected); return socket } },
  }
  const link = async identifier => {
    let values = modules[identifier]
    if (identifier.endsWith('/operator/dist-server/config.js')) values = { loadConfig: () => ({ secureApiRequired: true, publicOrigin: new URL('https://codex.danhkhai.io.vn'), host: '127.0.0.1', port: 5173 }) }
    if (identifier.endsWith('/operator/dist-server/secure-key.js')) values = { readOwnerKey: () => { keyReads++; return { key: 'fake never logged' } } }
    assert(values, 'unmocked import: ' + identifier)
    const module = new SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value) }, { context })
    await module.link(() => { throw Error('unexpected nested import') }); await module.evaluate(); return module
  }
  const module = new SourceTextModule(readFileSync(new URL('./production.mjs', import.meta.url), 'utf8'), { context, importModuleDynamically: link })
  await module.link(link); await module.evaluate()
  return { ops: module.namespace.productionOps(RELEASE), put, read, admin, outside, trace, advance: ms => { now += ms }, stats: () => ({ keyReads, tlsChecks }) }
}

test('R1: integrating new scripts before idle breaks Knowledge/Services; only old watcher is frozen', { skip: !release }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'release-cli-skew-'))
  let server
  try {
    await cp(path.join(release, 'old'), root, { recursive: true })
    // Successful old CLI controls use the unchanged old auth/config closure.
    for (const name of ['knowledge.mjs', 'services.mjs']) await cp(path.join(release, 'source-baseline/scripts', name), path.join(root, 'scripts', name))
    const { getSession } = await import(url.pathToFileURL(path.join(root, 'dist-server/auth.js')).href)
    const env = { PATH: process.env.PATH, HOME: root, CODEX_REMOTE_PASSWORD: 'fake-only-password', CODEX_REMOTE_SESSION_SECRET: 'fake-only-secret'.repeat(4), CODEX_REMOTE_PUBLIC_ORIGIN: 'http://127.0.0.1', CODEX_REMOTE_WORKSPACE_ROOTS: root }
    server = createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); if (!getSession(req, env.CODEX_REMOTE_SESSION_SECRET, false)) { res.writeHead(401); res.end('{}'); return } if (req.url.startsWith('/api/secure/')) { res.writeHead(404); res.end('{}'); return } res.end('{"data":[]}') })
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); env.CODEX_REMOTE_PORT = String(server.address().port)
    const cli = name => run(process.execPath, [path.join(root, 'scripts', name), ...(name.startsWith('restart') ? ['--check'] : ['list'])], { env, cwd: root, timeout: 10000 })
    for (const name of ['knowledge.mjs', 'services.mjs', 'restart-when-idle.mjs']) await cli(name)
    for (const name of ['knowledge.mjs', 'services.mjs', 'secure-maintenance.mjs', 'session-cookie.mjs', 'restart-when-idle.mjs']) await cp(path.join(release, 'operator/scripts', name), path.join(root, 'scripts', name))
    for (const name of ['knowledge.mjs', 'services.mjs', 'restart-when-idle.mjs']) await assert.rejects(cli(name), error => /ERR_MODULE_NOT_FOUND/.test(error.stderr) && /secure-client/.test(error.stderr))
    // Even an explicitly frozen NEW operator closure cannot operate the OLD gateway.
    for (const name of ['knowledge.mjs', 'services.mjs']) await assert.rejects(run(process.execPath, [path.join(release, 'operator/scripts', name), 'list'], { env, cwd: root, timeout: 10000 }), error => /Secure setup unavailable/.test(error.stderr))
  } finally { server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})

test('R2: actual production adapter accepts expired authority + changed receipts after waiting', async () => {
  const f = await adapterFixture(); await f.ops.preflight()
  const checked = f.stats(); assert.equal(checked.tlsChecks, HOSTS.length * 2); assert.equal(checked.keyReads, 1)
  f.advance(2 * 60 * 60_000)
  f.put(f.outside + '/evidence.json', { withdrawn: true }); f.put(f.outside + '/authorization.json', { withdrawn: true })
  await f.ops.drift(); await f.ops.preCopy()
  assert.deepEqual(f.stats(), checked, 'no evidence/key/infrastructure revalidation before mutation')
})

test('R3: config changed after last idle drift is overwritten before preCopy detects it', async () => {
  const f = await adapterFixture(); await f.ops.preflight(); await f.ops.drift()
  f.put(f.admin, 'operator intervened after backup')
  await f.ops.gateIngress(); await f.ops.preCopy()
  assert.equal(f.read(f.admin).toString(), 'gated-admin')
  assert(f.trace.some(entry => entry[0] === 'systemctl'), 'conflicting config was reloaded')
})

test('R4: entering bookkeeping erases durable postverify evidence until its promise settles', async () => {
  let marker, observed
  const evidence = { verifiedAt: 'fixture', encryptedProof: true, freshPid: 99 }
  const ops = { modules: [], now: () => 0, sleep: async () => {}, state: async value => { marker = structuredClone(value) }, oldReadiness: async () => ({ ready: true, busy: 0, pending: 0, incomplete: false }), verify: async () => evidence,
    bookkeeping: async () => { observed = structuredClone(marker) } }
  for (const name of ['acquire', 'release', 'preflight', 'drift', 'backup', 'gateIngress', 'preCopy', 'assets', 'assertInstalled', 'activateDependenciesConfig', 'oldWatcherRestart', 'newBackend', 'workboard', 'index', 'openIngress']) ops[name] = async () => {}
  await execute(ops)
  assert.equal(observed.phase, 'bookkeeping'); assert.equal(observed.evidence, undefined)
  assert.deepEqual(marker.evidence, evidence, 'graceful success control retains evidence')
})
