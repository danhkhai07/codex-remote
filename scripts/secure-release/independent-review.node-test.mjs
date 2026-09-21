// Inverse PoCs converted to rejection/no-overwrite/durable-evidence acceptance after fixes.
// All adapter I/O is synthetic; CLI probes use a private fixture and loopback only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm'
import { readFileSync } from 'node:fs'
import { mkdtemp, cp, rm, writeFile } from 'node:fs/promises'
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
import { APP, BASE, SOURCE, HOSTS, HOURS, same as compare } from './common.mjs'

const release = process.env.REVIEW_RELEASE
const run = promisify(execFile)
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

export async function adapterFixture({ activationEligible = true } = {}) {
  const MAIN = '/fake/main', RELEASE = '/fake/release', outside = RELEASE + '.activation'
  const admin = '/etc/nginx/sites-available/codex.danhkhai.io.vn', preview = '/etc/nginx/sites-available/codex-preview-ports'
  const files = new Map(), trace = []; let commandHook, writeHook
  const put = (p, value) => files.set(p, Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)))
  const read = p => { assert(files.has(p), 'unmocked read: ' + p); return files.get(p) }
  const fileHash = p => p === MAIN + '/dist-server/work-hours.js' ? HOURS : digest(read(p))
  const record = p => p.endsWith('/workboard.service.d') && [...files.keys()].some(f => f.startsWith(p + '/')) ? { directory: true } : files.has(p) ? { uid: 0, gid: 0, mode: 0o644, size: read(p).length, sha256: fileHash(p) } : { absent: true }
  let now = Date.parse('2026-09-21T12:00:00Z'), keyReads = 0, tlsChecks = 0, head = BASE, remote = BASE, keyGeneration = 'fake-generation', keyAvailable = true, tlsFingerprint = 'fake-cert', dnsAvailable = true, branch = 'main', dirty = false, pushFails = false
  const identity = 'MainPID=42\nActiveState=active\nExecMainStartTimestampMonotonic=100'
  put(MAIN + '/dist/index.html', 'old-index'); put(RELEASE + '/payload/dist/index.html', 'new-index'); put('/root/GITHUB/Workboard/server.py', 'old-workboard'); put(RELEASE + '/infra/workboard-server.py', 'new-workboard'); put(RELEASE + '/infra/workboard-isolated.conf', 'new-dropin');
  put(MAIN + '/.env', 'CODEX_REMOTE_PASSWORD=fake-only\n'); put(admin, 'old-admin'); put(preview, 'old-preview')
  const paths = [admin, preview, '/etc/nginx/snippets/codex-cloudflare-real-ip.conf', MAIN + '/.env', MAIN + '/dist/index.html', '/root/GITHUB/Workboard/server.py', '/etc/systemd/system/workboard.service.d/isolated-preview.conf']
  const parents = {}; for (const target of paths) { for (let parent = path.dirname(target); ; parent = path.dirname(parent)) { parents[parent] = { directory: true, uid: 0, gid: 0, mode: 0o700 }; if (parent === path.dirname(parent)) break } }
  const policy = 'Type=simple\nKillMode=control-group\nSendSIGKILL=yes\nTriggeredBy=\nControlGroup=/system.slice/codex-remote.service'
  const baseline = { cutoverPolicy: policy, oldProcess: { pid: 42, start: 'fake-start', cgroup: '/system.slice/codex-remote.service' }, source: {}, remote: { fetch: digest('fake-origin'), push: digest('fake-origin') }, destinations: { entries: Object.fromEntries(paths.map(p => [p, record(p)])), parents }, service: identity, workboard: identity, stable: { [MAIN + '/.env']: record(MAIN + '/.env'), ['/root/GITHUB/Workboard/server.py']: record('/root/GITHUB/Workboard/server.py') }, nginxTempDirectories: {}, nginxFiles: { 'sites-available/codex.danhkhai.io.vn': record(admin), 'sites-available/codex-preview-ports': record(preview) }, unitHashes: {}, backend: {}, client: { 'index.html': record(MAIN + '/dist/index.html') }, dependencies: {}, workboardDropins: {} }
  const releaseTree = { 'payload/file': { sha256: 'fake sealed bytes' } }
  put(RELEASE + '/metadata.json', { app: APP, sourceTarget: SOURCE, activationEligible, base: BASE, main: MAIN, release: RELEASE, hours: HOURS, requiredEncryption: true, keyFile: '/fake/private/key.json', fileRoots: ['/fake/files'] })
  put(RELEASE + '/baseline.json', baseline); put(RELEASE + '/inventory.json', { groups: { backend: [], client: [] } })
  put(RELEASE + '/seal.json', { app: APP, files: releaseTree })
  put(RELEASE + '/dependencies/node_modules/jose/package.json', { version: '6.2.12' })
  put(RELEASE + '/runner/production.mjs', 'fake sealed runner'); put(outside + '/evidence/report', 'fake evidence')
  for (const [name, content] of [['admin-maintenance.conf', 'gated-admin'], ['preview-parked.conf', 'parked-preview'], ['admin-active.conf', 'active-admin'], ['preview-active.conf', 'active-preview'], ['cloudflare-real-ip.conf', 'real-ip-snippet']]) put(RELEASE + '/infra/' + name, content)
  const evidence = Object.fromEntries(['protocol', 'infrastructure', 'migration', 'workboard', 'fixtures'].map(name => [name, { app: APP, seal: fileHash(RELEASE + '/seal.json'), result: 'approved', at: new Date(now).toISOString(), files: [{ path: 'evidence/report', sha256: fileHash(outside + '/evidence/report') }] }]))
  Object.assign(evidence.migration, { procedure: 'fake human procedure', freshProfileCreatedAt: new Date(now).toISOString(), profileEvidenceId: 'fake', oldProfileCredentialsUsed: false, remainingRisk: 'arbitrary-old-profile-not-attestable' })
  Object.assign(evidence.infrastructure, { hosts: HOSTS, tlsMode: 'Full (strict)', canaryPath: '/.well-known/acme-challenge/fake', canaryDigest: digest('canary'), originCertificateFingerprint: 'fake-cert', publicCertificateFingerprints: Object.fromEntries(HOSTS.map(host => [host, 'fake-cert'])), renewalDryRun: 'fake receipt' })
  put(outside + '/evidence.json', evidence)
  put(outside + '/authorization.json', { app: APP, source: SOURCE, existingUserAuthorization: 'fake recorded user authorization', seal: fileHash(RELEASE + '/seal.json'), runner: fileHash(RELEASE + '/runner/production.mjs'), evidence: fileHash(outside + '/evidence.json'), action: 'publish-reviewed-release', operator: 'fixture', at: new Date(now).toISOString() })
  const tree = p => {
    if (p === RELEASE) return { ...releaseTree, 'seal.json': record(RELEASE + '/seal.json') }
    if (p === '/etc/systemd/system/workboard.service.d') return Object.fromEntries([...files.keys()].filter(p => p.startsWith('/etc/systemd/system/workboard.service.d/')).map(p => [path.basename(p), record(p)]))
    if (p === '/etc/nginx') return Object.fromEntries([...files.keys()].filter(p => p.startsWith('/etc/nginx/')).sort().map(p => [p.slice('/etc/nginx/'.length), record(p)]))
    if (p === MAIN + '/dist') return { 'index.html': record(MAIN + '/dist/index.html') }
    if ([MAIN + '/dist-server', MAIN + '/dist', MAIN + '/node_modules'].includes(p)) return {}
    throw Error('unmocked tree: ' + p)
  }
  const command = (exe, args) => {
    trace.push([exe, ...args]); commandHook?.(exe, args)
    if (exe === 'git' && args[0] === 'rev-parse') return head
    if (exe === 'git' && args[0] === 'symbolic-ref') return branch
    if (exe === 'git' && args[0] === 'remote') return 'fake-origin'
    if (exe === 'git' && args[0] === 'merge-base') return ''
    if (exe === 'git' && args.includes('merge')) { head = SOURCE; return '' }
    if (exe === 'git' && args.includes('push')) { if (pushFails) throw Error('fake-network-failure'); remote = head; return '' }
    if (exe === 'git' && args[0] === 'status') return dirty ? ' M fake' : ''
    if (exe === 'git' && args[0] === 'ls-remote') return remote + '\trefs/heads/main'
    if (exe === '/usr/sbin/nginx' && args[0] === '-t') return ''
    if (exe === '/usr/bin/systemctl') return policy
    if (exe === 'systemctl') return ''
    throw Error('unmocked command: ' + exe)
  }
  const common = { APP, BASE, SOURCE, HOURS, HOSTS, MAIN, assert: (ok, code) => assert(ok, code), json: p => JSON.parse(read(p)), fileHash, hash: digest, record, preimage: record, parentIdentity: () => ({ directory: true, uid: 0, gid: 0, mode: 0o700 }), tree, command,
    same: compare, inside: (root, name) => path.join(root, name),
    atomicBytes: (p, bytes) => { trace.push(['write', p]); put(p, bytes.toString()); writeHook?.(p) }, serviceIdentity: () => identity }
  const fs = { readFileSync: (p, encoding) => encoding ? read(p).toString() : read(p), existsSync: p => files.has(p) || p.endsWith('/fullchain.pem'), lstatSync: () => ({ mode: 0o700, uid: 0 }),
    mkdirSync: p => { trace.push(['mkdir', p]) }, unlinkSync: p => files.delete(p),
    ...Object.fromEntries(['rmdirSync', 'renameSync', 'symlinkSync', 'realpathSync'].map(name => [name, () => { throw Error('unexpected filesystem mutation: ' + name) }])) }
  class FakeDate extends Date { static now() { return now } }
  const context = createContext({ Buffer, URL, structuredClone, Date: FakeDate, AbortSignal, process: { env: {}, execPath: '/fake/node' }, setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: async () => new Response('canary') })
  const modules = {
    'node:fs': fs, 'node:path': path, 'node:url': url, 'node:util': { parseEnv }, 'node:child_process': { spawn: () => { throw Error('must not spawn') } }, 'node:timers/promises': { setTimeout: async () => {} }, './common.mjs': common,
    'node:dns/promises': { resolve4: async () => dnsAvailable ? ['192.0.2.1'] : [] },
    'node:tls': { connect: (_options, connected) => { tlsChecks++; const socket = new EventEmitter(); Object.assign(socket, { setTimeout() {}, end() {}, destroy() {}, getPeerCertificate: () => ({ fingerprint256: tlsFingerprint }) }); queueMicrotask(connected); return socket } },
  }
  const link = async identifier => {
    let values = modules[identifier]
    if (identifier.endsWith('/operator/dist-server/config.js')) values = { loadConfig: () => ({ secureApiRequired: true, publicOrigin: new URL('https://codex.danhkhai.io.vn'), host: '127.0.0.1', port: 5173 }) }
    if (identifier.endsWith('/operator/dist-server/secure-key.js')) values = { assertKeyLocation: () => { if (!keyAvailable) throw Error('fake-provision-unavailable') }, readOwnerKey: () => { keyReads++; if (!keyAvailable) throw Error('fake-key-unavailable'); return { app: 'fake-app', generation: keyGeneration, key: 'fake never logged' } } }
    if (!values && ['./destinations.mjs', './publication.mjs', './lock.mjs', './key-state.mjs'].includes(identifier)) { const linked = new SourceTextModule(readFileSync(new URL(identifier, import.meta.url), 'utf8'), { context }); await linked.link(link); await linked.evaluate(); return linked }
    assert(values, 'unmocked import: ' + identifier)
    const module = new SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value) }, { context })
    await module.link(() => { throw Error('unexpected nested import') }); await module.evaluate(); return module
  }
  const module = new SourceTextModule(readFileSync(new URL('./production.mjs', import.meta.url), 'utf8'), { context, importModuleDynamically: link })
  await module.link(link); await module.evaluate()
  return { commandHook: hook => { commandHook = hook }, writeHook: hook => { writeHook = hook }, ops: module.namespace.productionOps(RELEASE), put, read, admin, outside, trace, setHead: v => { head = v }, setRemote: v => { remote = v }, setBranch: v => { branch = v }, setDirty: v => { dirty = v }, failPush: () => { pushFails = true }, heads: () => ({ head, remote }), rotateKey: () => { keyGeneration = 'rotated'; put('/fake/private/key.json', 'unexpected-fake-key-before-isolation') }, removeKey: () => { keyAvailable = false }, breakTls: () => { tlsFingerprint = 'changed' }, breakDns: () => { dnsAvailable = false }, advance: ms => { now += ms }, stats: () => ({ keyReads, tlsChecks }) }
}

test('R1: actual old Knowledge/Services read and checked write keep working throughout busy wait', { skip: !release }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'release-cli-busy-')); let server
  try {
    await cp(path.join(release, 'old'), root, { recursive: true })
    for (const name of ['knowledge.mjs', 'services.mjs']) await cp(path.join(release, 'source-baseline/scripts', name), path.join(root, 'scripts', name))
    const { getSession } = await import(url.pathToFileURL(path.join(root, 'dist-server/auth.js')).href)
    const env = { PATH: process.env.PATH, HOME: root, CODEX_REMOTE_PASSWORD: 'fake-only-password', CODEX_REMOTE_SESSION_SECRET: 'fake-only-secret'.repeat(4), CODEX_REMOTE_PUBLIC_ORIGIN: 'http://127.0.0.1', CODEX_REMOTE_WORKSPACE_ROOTS: root }
    let content = 'initial', revision = digest(content), writes = 0, probes = 0, switched = false
    server = createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json')
      const session = getSession(req, env.CODEX_REMOTE_SESSION_SECRET, false)
      if (!session) { res.writeHead(401); res.end('{}'); return }
      if (req.url.startsWith('/api/secure/')) { res.writeHead(404); res.end('{}'); return }
      if (req.method === 'PUT') {
        assert.equal(req.headers['x-csrf-token'], session.csrf)
        let body = ''; for await (const bytes of req) body += bytes
        const input = JSON.parse(body)
        if (input.revision !== revision) { res.writeHead(409); res.end('{}'); return }
        content = input.content; revision = digest(content); writes++
      }
      res.end(JSON.stringify(req.url.startsWith('/api/knowledge') ? { content, revision } : { services: [], data: [] }))
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); env.CODEX_REMOTE_PORT = String(server.address().port)
    const cli = (name, args) => run(process.execPath, [path.join(root, 'scripts', name), ...args], { env, cwd: root, timeout: 10000 })
    const ops = { modules: [], now: () => 0, sleep: async () => {}, state: async () => {},
      oldReadiness: async () => {
        assert.equal(switched, false)
        const prior = JSON.parse((await cli('knowledge.mjs', ['read', '--path', 'References/Fixture.md'])).stdout)
        await writeFile(path.join(root, 'draft.md'), 'checked write ' + probes)
        const written = JSON.parse((await cli('knowledge.mjs', ['write', '--path', 'References/Fixture.md', '--file', path.join(root, 'draft.md'), '--revision', prior.revision])).stdout)
        assert.notEqual(written.revision, prior.revision)
        await cli('services.mjs', ['list'])
        assert.equal(JSON.parse((await cli('knowledge.mjs', ['read', '--path', 'References/Fixture.md'])).stdout).revision, written.revision)
        probes++; return { ready: probes > 2, busy: probes > 2 ? 0 : 1, pending: 0, incomplete: false }
      }, sourceTransition: async () => { assert(probes >= 5); switched = true; throw Error('fixture-cutover-boundary') },
    }
    for (const name of ['acquire', 'release', 'preflight', 'drift', 'validateReadiness', 'backup', 'gateIngress', 'preCopy']) ops[name] = async () => {}
    await assert.rejects(execute(ops), /fixture-cutover-boundary/)
    assert(switched); assert.equal(writes, probes); assert(probes >= 5)
  } finally { server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})

test('R2: actual adapter rejects expired/withdrawn gates after waiting before writes', async () => {
  const f = await adapterFixture(); await f.ops.preflight()
  assert.equal(f.stats().tlsChecks, HOSTS.length * 2)
  f.advance(2 * 60 * 60_000)
  f.put(f.outside + '/evidence.json', { withdrawn: true }); f.put(f.outside + '/authorization.json', { withdrawn: true })
  await assert.rejects(f.ops.drift()); await assert.rejects(f.ops.preCopy()); await assert.rejects(f.ops.gateIngress())
  assert(!f.trace.some(entry => entry[0] === 'write' && entry[1].startsWith('/etc/')))
})
for (const change of ['rotateKey', 'removeKey', 'breakTls', 'breakDns']) test('R2: rejects ' + change + ' after bound preflight', async () => {
  const f = await adapterFixture(); await f.ops.preflight(); f[change]()
  await assert.rejects(f.ops.gateIngress()); assert(!f.trace.some(entry => entry[0] === 'write'))
})
test('R2: unexpired receipt replacement or referenced report drift cannot refresh bound readiness', async () => {
  for (const path of ['authorization.json', 'evidence/report']) {
    const f = await adapterFixture(); await f.ops.preflight()
    f.put(f.outside + '/' + path, path.endsWith('.json') ? { ...JSON.parse(f.read(f.outside + '/' + path)), operator: 'replacement' } : 'changed report')
    await assert.rejects(f.ops.gateIngress()); assert(!f.trace.some(entry => entry[0] === 'write'))
  }
})
test('R2/R5: infra checks are independent of provision readiness; fresh keyless gates refresh', async () => {
  const f = await adapterFixture(); f.removeKey(); const result = await f.ops.check()
  assert(result.blockers.some(value => value.startsWith('pre-key-provision-not-ready:'))); assert.equal(f.stats().tlsChecks, 14)
  const good = await adapterFixture(); await good.ops.preflight(); await good.ops.preCopy(); assert(good.stats().tlsChecks >= 28)
})
test('R3: intervening config survives; no conflicting reload occurs', async () => {
  const f = await adapterFixture(); await f.ops.preflight(); await f.ops.drift()
  f.put(f.admin, 'operator intervened after backup')
  await assert.rejects(f.ops.gateIngress()); await assert.rejects(f.ops.preCopy())
  assert.equal(f.read(f.admin).toString(), 'operator intervened after backup')
  assert(!f.trace.some(entry => entry[0] === 'systemctl'))
})
test('R3: unchanged gating succeeds; changed owned version is rejected at open ingress', async () => {
  const f = await adapterFixture(); await f.ops.preflight(); await f.ops.gateIngress(); await f.ops.preCopy()
  assert.equal(f.read(f.admin).toString(), 'gated-admin')
  await f.ops.index(); f.put(f.admin, 'operator intervened before open')
  const count = f.trace.filter(entry => entry[0] === 'systemctl').length
  await assert.rejects(f.ops.openIngress()); assert.equal(f.read(f.admin).toString(), 'operator intervened before open')
  assert.equal(f.trace.filter(entry => entry[0] === 'systemctl').length, count)
})
for (const target of ['/root/GITHUB/Workboard/server.py', '/etc/systemd/system/workboard.service.d/isolated-preview.conf']) test('R3: Workboard preimage drift rejected: ' + target, async () => {
  const f = await adapterFixture(); await f.ops.preflight(); f.put(target, 'intervening change')
  await assert.rejects(f.ops.workboard()); assert.equal(f.read(target).toString(), 'intervening change')
  assert(!f.trace.some(entry => entry[0] === 'systemctl'))
})
test('R1: source stays BASE until explicit phase; remote/branch/dirty drift rejects before merge', async () => {
  for (const setter of ['setRemote', 'setHead', 'setBranch', 'setDirty']) {
    const f = await adapterFixture(); await f.ops.preflight(); assert.deepEqual(f.heads(), { head: BASE, remote: BASE })
    f[setter](setter === 'setDirty' ? true : 'unreviewed')
    await assert.rejects(f.ops.sourceTransition()); assert(!f.trace.some(entry => entry.includes('merge')))
  }
  const f = await adapterFixture(); await f.ops.preflight(); await f.ops.sourceTransition()
  assert.deepEqual(f.heads(), { head: SOURCE, remote: SOURCE }); assert(!f.trace.flat().includes('--force'))
  const partial = await adapterFixture(); await partial.ops.preflight(); partial.failPush()
  await assert.rejects(partial.ops.sourceTransition(), /network/)
  assert.deepEqual(partial.heads(), { head: SOURCE, remote: BASE })
  assert.equal(JSON.parse(partial.read(partial.outside + '/source-transition.json')).step, 'push-dispatching')
})
test('R4: entering bookkeeping retains durable proof reference and verified evidence', async () => {
  let marker, observed
  const evidence = { verifiedAt: 'fixture', encryptedProof: true, freshPid: 99 }, proof = { path: '/fake/postverify.json', sha256: 'fakehash' }
  const ops = { modules: [], now: () => 0, sleep: async () => {}, state: async value => { marker = structuredClone(value) }, oldReadiness: async () => ({ ready: true, busy: 0, pending: 0, incomplete: false }), verify: async () => evidence, persistProof: async () => proof,
    bookkeeping: async () => { observed = structuredClone(marker) } }
  for (const name of ['acquire', 'release', 'preflight', 'drift', 'validateReadiness', 'sourceTransition', 'backup', 'gateIngress', 'preCopy', 'assets', 'assertInstalled', 'activateDependenciesConfig', 'oldWatcherRestart', 'newBackend', 'workboard', 'index', 'openIngress']) ops[name] = async () => {}
  await execute(ops)
  assert.equal(observed.phase, 'bookkeeping'); assert.deepEqual(observed.evidence, evidence); assert.deepEqual(observed.publication, proof)
  assert.deepEqual(marker.evidence, evidence)
})
test('R3: drift between Nginx writes and during syntax check stops next write/reload', async () => {
  for (const boundary of ['write', 'nginx-test']) {
    const f = await adapterFixture(); await f.ops.preflight()
    if (boundary === 'write') f.writeHook(p => { if (p === f.admin) f.put('/etc/nginx/sites-available/codex-preview-ports', 'operator concurrent') })
    else f.commandHook(exe => { if (exe === '/usr/sbin/nginx') f.put(f.admin, 'operator concurrent') })
    await assert.rejects(f.ops.gateIngress(), /drift/)
    assert(!f.trace.some(e => e[0] === 'systemctl' && e[1] === 'reload'))
    assert.equal(f.read(boundary === 'write' ? '/etc/nginx/sites-available/codex-preview-ports' : f.admin).toString(), 'operator concurrent')
  }
})
test('R3: Workboard drift between source/dropin and after daemon reload prevents restart', async () => {
  for (const boundary of ['source', 'daemon-reload']) {
    const f = await adapterFixture(); await f.ops.preflight()
    if (boundary === 'source') f.writeHook(p => { if (p === '/root/GITHUB/Workboard/server.py') f.put('/etc/systemd/system/workboard.service.d/isolated-preview.conf', 'operator concurrent') })
    else f.commandHook((exe, args) => { if (exe === 'systemctl' && args[0] === 'daemon-reload') f.put('/etc/systemd/system/workboard.service.d/foreign.conf', 'operator concurrent') })
    await assert.rejects(f.ops.workboard(), /drift/)
    assert(!f.trace.some(e => e[0] === 'systemctl' && e[1] === 'restart'))
  }
  const normal = await adapterFixture(); await normal.ops.preflight(); await normal.ops.workboard()
  assert(normal.trace.some(e => e[0] === 'systemctl' && e[1] === 'restart'))
})
test('R2: crossing readiness lifetime during final HTTP await aborts before source/files', async () => {
  const f = await adapterFixture(); await f.ops.preflight(); await f.ops.gateIngress()
  const writes = f.trace.filter(e => e[0] === 'write').length
  f.advance(60 * 60_000 + 1) // Simulates time spent awaiting the last oldReadiness response.
  await assert.rejects(f.ops.preCopy(), /expired/)
  assert.equal(f.trace.filter(e => e[0] === 'write').length, writes)
  assert.deepEqual(f.heads(), { head: BASE, remote: BASE })
})
test('R1: concurrent remote change after local fast-forward aborts ordinary push with durable observed heads', async () => {
  const f = await adapterFixture(); await f.ops.preflight()
  f.commandHook((exe, args) => { if (exe === 'git' && args.includes('merge')) f.setRemote('operator-commit') })
  await assert.rejects(f.ops.sourceTransition(), /remote-drift/)
  assert(!f.trace.some(e => e[0] === 'git' && e.includes('push')))
  const journal = JSON.parse(f.read(f.outside + '/source-transition.json'))
  assert.equal(journal.status, 'failed'); assert.equal(journal.observed.remote, 'operator-commit'); assert.equal(journal.observed.local, SOURCE)
})
test('review-only sealed release remains preparationblocked even with otherwise valid readiness', async () => {
  const f = await adapterFixture({ activationEligible: false })
  assert((await f.ops.check()).blockers.includes('review-release-not-activation-eligible'))
  await assert.rejects(f.ops.preflight(), /review-release-not-activation-eligible/)
  assert(!f.trace.some(e => e[0] === 'write'))
})
