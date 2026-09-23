// Narrow NEW-instance publication. No key provisioning, DB restore, old service command or main mutation.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, copyFileSync, existsSync, realpathSync, symlinkSync, unlinkSync, rmdirSync } from 'node:fs'
import { dirname, resolve, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { parseEnv } from 'node:util'
import { setTimeout as sleep } from 'node:timers/promises'
import { hash, sha, tree, same, identity, atomic, ownerEnv, workflow, idle, publicationLock } from './core.mjs'
const RUNTIME = '/root/RUNNING-SERVICES/codex-remote-secure', OLD = '/root/RUNNING-SERVICES/codex-remote'
const STATE = '/root/.local/state/codex-remote-secure', ENV = STATE + '/instance.env', KEY = STATE + '/secure-owner/owner-key.json'
const SERVICE = 'codex-remote-secure.service', OLD_SERVICE = 'codex-remote.service', ORIGIN = 'https://remote.danhkhai.io.vn'
const MARKER = STATE + '/owner-files-deploy.json'
const backend = ['config', 'file-policy', 'secure-key', 'secure-api', 'server-files', 'directory-listing', 'http-app', 'pptx-preview'].flatMap(p => ['dist-server/' + p + '.js', 'dist-server/' + p + '.js.map'])
const maintenance = ['scripts/secure-maintenance.mjs', 'scripts/secure-key.mjs', 'scripts/remote-instance/prestart.mjs']
const HOURS = { 'work-hours.js': 'b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93', 'work-hours.js.map': '6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8' }
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
function pid(service) { const p = Number(execFileSync('systemctl', ['show', service, '-p', 'MainPID', '--value'], { encoding: 'utf8' }).trim()); assert(p > 1, 'Gateway not running'); return { pid: p, start: readFileSync(`/proc/${p}/stat`, 'utf8').split(') ')[1].split(' ')[19] } }
function snapshot() {
  return { backend: tree(RUNTIME + '/dist-server'), client: tree(RUNTIME + '/dist'), scripts: Object.fromEntries(maintenance.map(p => [p, hash(RUNTIME + '/' + p)])), env: hash(ENV), key: identity(KEY), gateway: pid(SERVICE), old: { backend: tree(OLD + '/dist-server'), client: tree(OLD + '/dist'), env: hash(OLD + '/.env'), main: git('-C', OLD, 'rev-parse', 'HEAD'), gateway: pid(OLD_SERVICE) }, dependencies: { path: realpathSync(RUNTIME + '/node_modules'), package: hash(RUNTIME + '/package.json'), lock: hash(RUNTIME + '/package-lock.json'), jose: tree(RUNTIME + '/node_modules/jose') }, units: { new: sha(execFileSync('systemctl', ['cat', SERVICE])), old: sha(execFileSync('systemctl', ['cat', OLD_SERVICE])) } }
}
function assertHours(state) { for (const [p, h] of Object.entries(HOURS)) { assert.equal(state.backend[p], h); assert.equal(state.old.backend[p], h) } }
function freeze(destination) {
  const visited = new Map()
  const copy = path => {
    if (visited.has(path)) return
    const full = resolve(RUNTIME, path); assert(full.startsWith(RUNTIME + '/'))
    const bytes = readFileSync(full); visited.set(path, sha(bytes)); atomic(join(destination, path), bytes)
    for (const match of bytes.toString('utf8').matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)) copy(relative(RUNTIME, resolve(dirname(full), match[1])))
  }
  for (const entry of ['package.json', 'dist-server/config.js', 'scripts/secure-maintenance.mjs', 'scripts/restart-readiness.mjs', 'dist-server/auth.js']) copy(entry)
  symlinkSync(realpathSync(RUNTIME + '/node_modules'), destination + '/node_modules')
  return Object.fromEntries(visited)
}
async function prepare(release, evidenceFile) {
  assert(!existsSync(release), 'Immutable release already exists')
  const worktree = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  assert.equal(git('rev-parse', '--show-toplevel'), worktree)
  assert(!git('status', '--porcelain', '--untracked-files=no'), 'Tracked source is dirty')
  const evidence = json(evidenceFile); assert.equal(evidence.status, 'passed'); assert(evidence.fullCheck && evidence.browser && evidence.maintenance && evidence.runner)
  const base = snapshot(); assertHours(base); ownerEnv(readFileSync(ENV, 'utf8'))
  same(hash(worktree + '/package.json'), base.dependencies.package, 'Package source')
  same(hash(worktree + '/package-lock.json'), base.dependencies.lock, 'Dependency lock')
  const compiled = tree(worktree + '/dist-server')
  const changed = [...new Set([...Object.keys(base.backend), ...Object.keys(compiled)])].filter(p => base.backend[p] !== compiled[p]).map(p => 'dist-server/' + p).sort()
  same(changed, [...backend].sort(), 'Compiled backend allowlist')
  mkdirSync(release, { recursive: true, mode: 0o700 })
  const payload = {}
  for (const path of [...backend, ...maintenance, ...Object.keys(tree(worktree + '/dist')).map(p => 'dist/' + p)]) {
    const bytes = readFileSync(worktree + '/' + path); atomic(release + '/payload/' + path, bytes); payload[path] = sha(bytes)
  }
  const frozen = freeze(release + '/frozen')
  // Validation closure uses copies, never links to mutable production modules.
  for (const path of Object.keys(frozen)) atomic(release + '/validation/' + path, readFileSync(release + '/frozen/' + path))
  for (const path of [...backend, ...maintenance]) atomic(release + '/validation/' + path, readFileSync(release + '/payload/' + path))
  symlinkSync(base.dependencies.path, release + '/validation/node_modules')
  for (const path of ['deploy.mjs', 'core.mjs']) copyFileSync(join(worktree, 'scripts/owner-files-release', path), join(release, path))
  const manifest = { version: 1, source: git('rev-parse', 'HEAD'), worktree, at: new Date().toISOString(), base, payload, frozen, validation: { 'package.json': hash(release + '/validation/package.json'), ...Object.fromEntries(Object.entries(tree(release + '/validation/dist-server')).map(([p, h]) => ['dist-server/' + p, h])), ...Object.fromEntries(Object.entries(tree(release + '/validation/scripts')).map(([p, h]) => ['scripts/' + p, h])) }, evidence, runner: { 'deploy.mjs': hash(release + '/deploy.mjs'), 'core.mjs': hash(release + '/core.mjs') } }
  atomic(release + '/manifest.json', JSON.stringify(manifest, null, 2) + '\n')
  atomic(release + '/seal.json', JSON.stringify({ manifestSHA256: hash(release + '/manifest.json') }) + '\n')
  console.log(JSON.stringify({ status: 'prepared-not-armed', release, source: manifest.source, backend: changed.length, client: Object.keys(payload).filter(p => p.startsWith('dist/')).length, seal: hash(release + '/seal.json') }))
}
async function adapter(release) {
  const manifest = json(release + '/manifest.json')
  same(hash(release + '/manifest.json'), json(release + '/seal.json').manifestSHA256, 'Release manifest')
  // Validate executable bytes before importing any frozen helper.
  closure()
  const module = path => import(pathToFileURL(release + '/frozen/' + path).href)
  // Import/load original config and maintenance before replacing any runtime module/env.
  const { loadConfig } = await module('dist-server/config.js'), { maintenanceClient } = await module('scripts/secure-maintenance.mjs'), { restartReadiness } = await module('scripts/restart-readiness.mjs')
  const originalEnv = readFileSync(existsSync(release + '/backup/instance.env') ? release + '/backup/instance.env' : ENV, 'utf8')
  assert.equal(sha(originalEnv), manifest.base.env, 'Original configuration drift')
  const config = loadConfig(parseEnv(originalEnv))
  assert.equal(config.publicOrigin.origin, ORIGIN); assert.equal(config.port, 5174); assert.equal(config.host, '127.0.0.1'); assert.equal(config.secureApiRequired, true)
  const auth = async callback => { const client = await maintenanceClient(config); try { return await callback(client) } finally { client.close() } }
  const api = (client, path, init) => client.fetch(path, { ...init, signal: AbortSignal.timeout(15000) })
  const readiness = () => auth(client => restartReadiness(async path => { const r = await api(client, path); assert(r.ok, 'Readiness HTTP failure'); return r.json() }))
  const state = (status, detail = {}) => atomic(MARKER, JSON.stringify({ task: '17468a2b-456d-4ff2-92cd-deabd229f28e', status, at: new Date().toISOString(), source: manifest.source, release, seal: hash(release + '/seal.json'), ...detail }, null, 2) + '\n')
  function closure() {
    for (const [p, h] of Object.entries(manifest.runner)) assert.equal(hash(release + '/' + p), h, 'Runner drift')
    for (const [p, h] of Object.entries(manifest.payload)) assert.equal(hash(release + '/payload/' + p), h, 'Payload drift')
    for (const [p, h] of Object.entries(manifest.frozen)) assert.equal(hash(release + '/frozen/' + p), h, 'Frozen helper drift')
    for (const [p, h] of Object.entries(manifest.validation)) assert.equal(hash(release + '/validation/' + p), h, 'Validation closure drift')
    same(realpathSync(release + '/frozen/node_modules'), manifest.base.dependencies.path, 'Frozen dependencies')
    same(realpathSync(release + '/validation/node_modules'), manifest.base.dependencies.path, 'Validation dependencies')
    assert.equal(git('-C', manifest.worktree, 'rev-parse', 'HEAD'), manifest.source, 'Candidate source moved')
    assert(!git('-C', manifest.worktree, 'status', '--porcelain', '--untracked-files=no'), 'Candidate source dirty')
  }
  const assertBaseline = () => { closure(); same(snapshot(), manifest.base, 'Runtime/source/config/process baseline') }
  const expectedPublished = structuredClone(manifest.base)
  for (const [p, h] of Object.entries(manifest.payload)) {
    if (p.startsWith('dist-server/')) expectedPublished.backend[p.slice(12)] = h
    else if (p.startsWith('dist/')) expectedPublished.client[p.slice(5)] = h
    else expectedPublished.scripts[p] = h
  }
  expectedPublished.env = sha(ownerEnv(originalEnv))
  const assertPublished = (afterRestart = false) => { closure(); const current = snapshot(); if (afterRestart) current.gateway = expectedPublished.gateway; same(current, expectedPublished, 'Published and excluded bytes') }
  const preflight = async () => {
    assertBaseline()
    const temporary = release + '/preflight.env'
    atomic(temporary, ownerEnv(originalEnv))
    try { execFileSync('/usr/local/bin/node', ['--env-file=' + temporary, release + '/validation/scripts/remote-instance/prestart.mjs'], { cwd: release + '/validation', env: { PATH: '/usr/local/bin:/usr/bin:/bin', NODE_ENV: 'production' }, stdio: 'ignore', timeout: 15000 }) }
    finally { unlinkSync(temporary) }
  }
  const backup = () => {
    assert(!existsSync(release + '/backup'), 'Backup exists; use explicit recovery, not apply again')
    for (const p of [...backend, ...maintenance, ...Object.keys(manifest.base.client).map(p => 'dist/' + p)]) atomic(release + '/backup/' + p, readFileSync(RUNTIME + '/' + p))
    atomic(release + '/backup/instance.env', Buffer.from(originalEnv))
    atomic(release + '/backup/manifest.json', JSON.stringify({ files: tree(release + '/backup') }) + '\n')
  }
  const publish = () => {
    // Assets and helper/backend modules first; browser entry last. Never copy a whole backend directory.
    const paths = Object.keys(manifest.payload).filter(p => p !== 'dist/index.html')
    for (const p of paths) atomic(RUNTIME + '/' + p, readFileSync(release + '/payload/' + p))
    atomic(ENV, ownerEnv(originalEnv)); atomic(RUNTIME + '/dist/index.html', readFileSync(release + '/payload/dist/index.html'))
    assertPublished()
  }
  async function response(url, expectedHash) {
    let last
    for (let n = 0; n < 3; n++) {
      try { const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) }); assert.equal(r.status, 200); const bytes = Buffer.from(await r.arrayBuffer()); if (expectedHash) assert.equal(sha(bytes), expectedHash, 'Public/local asset mismatch'); return bytes }
      catch (error) { last = error; await sleep(1000) }
    }
    throw last
  }
  const verify = async () => {
    let healthy = false
    for (let n = 0; n < 30; n++) { try { await response('http://127.0.0.1:5174/api/healthz'); healthy = true; break } catch { await sleep(1000) } }
    assert(healthy, 'Replacement gateway unhealthy'); const current = pid(SERVICE); assert.notDeepEqual(current, manifest.base.gateway, 'No new gateway lifetime'); assertPublished(true)
    const html = readFileSync(release + '/payload/dist/index.html', 'utf8')
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)].map(m => m[1]); assert(assets.length > 0)
    for (const origin of ['http://127.0.0.1:5174', ORIGIN]) {
      await response(origin + '/api/healthz'); await response(origin + '/', sha(html)); await response(origin + '/files?path=%2Fetc%2Fhosts', sha(html))
      for (const asset of assets) await response(origin + asset, manifest.payload['dist' + asset])
    }
    await auth(async client => {
      const roots = await api(client, '/api/files/roots'); assert(roots.ok); assert((await roots.json()).roots.includes('/'))
      const info = await api(client, '/api/files/info?path=%2Fetc%2Fhosts'); assert(info.ok); assert.equal((await info.json()).path, '/etc/hosts')
      const content = await api(client, '/api/files/content?download=1&path=%2Fetc%2Fhosts'); assert(content.ok); assert.equal(sha(Buffer.from(await content.arrayBuffer())), hash('/etc/hosts'))
    })
    const { createSession } = await module('dist-server/auth.js'); const session = createSession(config.sessionSecret, 300, config.password)
    for (const origin of ['http://127.0.0.1:5174', ORIGIN]) {
      const denied = await fetch(origin + '/api/files/content?path=%2Fetc%2Fhosts', { headers: { Cookie: '__Host-codex_remote_session=' + session.token }, signal: AbortSignal.timeout(10000) }); assert.equal(denied.status, 403); await denied.arrayBuffer()
    }
    assertPublished(true)
    return { gateway: current, oldGateway: manifest.base.old.gateway, localPublicHealthAndAssets: true, encryptedHarmlessHostsRead: true, cookieOnly403: true, unchangedKeyIdentity: true, excludedBytesAndHoursPreserved: true }
  }
  const finalize = evidence => auth(async client => {
    const current = await (await api(client, '/api/services')).json()
    const existing = current.services.find(s => s.port === null && s.path === '/')
    assert(existing, 'Missing main service metadata')
    const entry = { ...existing, summary: (existing.summary.includes(manifest.source.slice(0, 7)) ? existing.summary : existing.summary + ` Owner Files toàn filesystem, hidden/config paths và Open/tab mới qua unlock; ${manifest.source.slice(0, 7)}.`).slice(0, 2000), prLabel: 'No PR', branch: 'fix/owner-full-files-access', directory: RUNTIME }
    const saved = await api(client, '/api/services', { method: 'PUT', body: JSON.stringify(entry) }); assert(saved.ok); await saved.arrayBuffer()
    const fileEntry = { port: null, path: '/files', name: 'Owner Files', summary: 'Mở file toàn filesystem bằng phiên owner đã unlock; xem, tab mới và tải qua API mã hóa. ' + manifest.source, prLabel: 'No PR', prUrl: '', branch: 'fix/owner-full-files-access', directory: RUNTIME, kind: 'app' }
    const registered = await api(client, '/api/services', { method: 'PUT', body: JSON.stringify(fileEntry) }); assert(registered.ok); await registered.arrayBuffer()
    const check = await (await api(client, '/api/services')).json(); assert(check.services.some(s => s.path === '/files' && s.summary.includes(manifest.source))); evidence.servicesVerified = true
    const heading = '## Owner Files live — ' + manifest.source.slice(0, 7)
    const body = `${heading}

NEW remote.danhkhai.io.vn đã triển khai owner-full theo yêu cầu user: /, hidden/config/secrets/current key qua phiên owner đã unlock; Open và link/tab mới dùng /files. Login/proof/encryption/revocation/preview giữ nguyên. OLD giữ nguyên. Candidate ${manifest.source}, branch fix/owner-full-files-access.

Local/public HTML+entry assets+health, encrypted harmless /etc/hosts và cookie-only403 đạt. NEW PID${evidence.gateway.pid}; OLD PID${evidence.oldGateway.pid} giữ. Key identity và Hours b763a0f7/map6a76da38 nguyên, không thay dữ liệu. Services verified. Full check/fixtures: ${JSON.stringify(manifest.evidence)}. Marker ${MARKER}; release ${release}. Không claim Safari thật. Nguồn [[Conversations/01a0be94-6018-7042-8552-6d25482b2f25/Index]].

`
    for (const path of ['References/Codex-Remote-Security-Activation-Package-2026-09-22.md', 'Projects/Codex-Remote.md', 'Conversations/01a0be94-6018-7042-8552-6d25482b2f25/Context.md']) {
      let saved = false
      for (let n = 0; n < 3; n++) {
        const read = await api(client, '/api/knowledge/note?' + new URLSearchParams({ path })); assert(read.ok, 'Knowledge read failed'); const current = await read.json()
        if (current.content.includes(heading)) { saved = true; break }
        const front = current.content.match(/^---\n[\s\S]*?\n---\n/)
        assert(front, 'Missing knowledge metadata')
        const handoffFront = front[0].replace(/^status:.*$/m, 'status: complete').replace(/^updated:.*$/m, 'updated: ' + new Date().toISOString().slice(0, 10))
        const content = path.startsWith('Conversations/') ? handoffFront + '\n' + body + 'Handoff: deployment verified; preserve release/evidence for leader review. See [[References/Codex-Remote-Security-Activation-Package-2026-09-22]].\n' : front[0] + '\n' + body + current.content.slice(front[0].length)
        const result = await api(client, '/api/knowledge/note', { method: 'PUT', body: JSON.stringify({ path, content, revision: current.revision, actor: '01a0be94-6018-7042-8552-6d25482b2f25' }) })
        await result.arrayBuffer(); if (result.status === 409) continue; assert(result.ok, 'Knowledge checked write failed'); saved = true; break
      }
      assert(saved, 'Concurrent knowledge write conflict retained for retry')
    }
    evidence.knowledgeCheckedRevision = true

  })
  let releaseShared
  const acquirePublication = () => { assert(!releaseShared, 'Publication lock already owned'); releaseShared = publicationLock('/root/.local/state/codex-remote/deployment.lock', { task: '17468a2b', kind: 'new-owner-files', pid: process.pid, source: manifest.source, at: new Date().toISOString() }) }
  const releasePublication = () => { if (releaseShared) { releaseShared(); releaseShared = undefined } }
  const rollback = async () => {
    assert(existsSync(release + '/backup/manifest.json'), 'No activation backup')
    closure()
    const preimage = json(release + '/backup/manifest.json').files
    for (const [p, h] of Object.entries(preimage)) assert.equal(hash(release + '/backup/' + p), h, 'Backup drift')
    for (const p of [...backend, ...maintenance]) {
      const expected = p.startsWith('dist-server/') ? manifest.base.backend[p.slice(12)] : manifest.base.scripts[p]
      assert.equal(hash(release + '/backup/' + p), expected, 'Wrong backend/script preimage')
    }
    for (const [p, h] of Object.entries(manifest.base.client)) assert.equal(hash(release + '/backup/dist/' + p), h, 'Wrong client preimage')
    assert.equal(hash(release + '/backup/instance.env'), manifest.base.env, 'Wrong config preimage')
    const guard = () => {
      closure(); const current = snapshot()
      // Only old/new release bytes may be replaced; preserve unrelated updates.
      for (const [p, h] of Object.entries(manifest.payload)) {
        const observed = p.startsWith('dist-server/') ? current.backend[p.slice(12)] : p.startsWith('dist/') ? current.client[p.slice(5)] : current.scripts[p]
        const old = p.startsWith('dist-server/') ? manifest.base.backend[p.slice(12)] : p.startsWith('dist/') ? manifest.base.client[p.slice(5)] : manifest.base.scripts[p]
        assert(observed === h || observed === old, 'Rollback target drift')
        if (p.startsWith('dist-server/')) current.backend[p.slice(12)] = manifest.base.backend[p.slice(12)]
        else if (p.startsWith('dist/')) { if (old) current.client[p.slice(5)] = old; else delete current.client[p.slice(5)] }
        else current.scripts[p] = old
      }
      assert([manifest.base.env, expectedPublished.env].includes(current.env), 'Rollback config drift')
      current.env = manifest.base.env; current.gateway = manifest.base.gateway
      same(current, manifest.base, 'Rollback excluded files/key/old instance')
    }
    for (let n = 0; ; n++) {
      assert(n < 4320, 'Rollback idle deadline'); guard(); state('rollback-waiting-idle')
      if (idle(await readiness())) { await sleep(5000); guard(); if (idle(await readiness())) break }
      await sleep(10000)
    }
    acquirePublication()
    guard(); if (!idle(await readiness())) throw Error('New work arrived before rollback')
    guard(); state('rolling-back-code-only')
    for (const p of [...backend, ...maintenance, ...Object.keys(manifest.base.client).map(p => 'dist/' + p)].filter(p => p !== 'dist/index.html')) atomic(RUNTIME + '/' + p, readFileSync(release + '/backup/' + p))
    atomic(ENV, readFileSync(release + '/backup/instance.env')); atomic(RUNTIME + '/dist/index.html', readFileSync(release + '/backup/dist/index.html'))
    // New content-hashed assets are harmless retained files for already-open tabs.
    for (let n = 0; ; n++) {
      assert(n < 4320, 'Rollback restart idle deadline'); guard()
      if (idle(await readiness())) { await sleep(5000); if (idle(await readiness())) break }
      await sleep(10000)
    }
    guard(); if (!idle(await readiness())) throw Error('New work arrived before rollback restart')
    const before = pid(SERVICE); execFileSync('systemctl', ['restart', SERVICE], { timeout: 60000, stdio: 'ignore' })
    await response('http://127.0.0.1:5174/api/healthz'); await response(ORIGIN + '/', manifest.base.client['index.html']); guard(); assert.notDeepEqual(pid(SERVICE), before)
    state('rolled-back-code-only', { gateway: pid(SERVICE), dataAndKeyRestored: false })
  }
  return { manifest, state, acquirePublication, releasePublication, preflight, assertBaseline, readiness, backup, publish, assertPublished, sleep, restart: async () => { execFileSync('systemctl', ['restart', SERVICE], { timeout: 60000, stdio: 'ignore' }) }, verify, finalize, rollback }
}
async function main() {
  const [mode, releaseArg, evidence] = process.argv.slice(2), release = resolve(releaseArg ?? '')
  assert(release.startsWith(STATE + '/releases/owner-files-') && dirname(release) === STATE + '/releases', 'Expected NEW immutable owner-files release path')
  assert(['prepare', 'check', 'apply', 'verify', 'rollback'].includes(mode), 'Use prepare|check|apply|verify|rollback RELEASE [checks.json]')
  if (mode === 'prepare') return prepare(release, evidence)
  const ops = await adapter(release)
  if (mode === 'check') { await ops.preflight(); console.log(JSON.stringify({ status: 'checked-not-armed', readiness: await ops.readiness() })); return }
  const lock = STATE + '/owner-files-deploy.lock'; mkdirSync(lock, { mode: 0o700 })
  try { if (mode === 'verify') { ops.acquirePublication(); const evidence = await ops.verify(); await ops.finalize(evidence); ops.state('complete', { evidence }) } else if (mode === 'rollback') await ops.rollback(); else await workflow(ops) } finally { ops.releasePublication(); rmdirSync(lock) }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch(error => { console.error(error instanceof Error ? error.message : 'Owner Files rollout failed'); process.exitCode = 1 })
