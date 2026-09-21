import { readFileSync, mkdirSync, existsSync, realpathSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { APP, BASE, SOURCE, HOURS, HOSTS, MAIN, assert, json, fileHash, hash, record, tree, command, same, inside, atomicBytes, serviceIdentity } from './common.mjs'
import { Destinations } from './destinations.mjs'
import { Publication } from './publication.mjs'
import { DeploymentLock } from './lock.mjs'
import { provisionPlan, ownerIdentity, boundOwner, processStart } from './key-state.mjs'
const publicOrigin = 'https://codex.danhkhai.io.vn'
const sites = { admin: '/etc/nginx/sites-available/codex.danhkhai.io.vn', preview: '/etc/nginx/sites-available/codex-preview-ports', ip: '/etc/nginx/snippets/codex-cloudflare-real-ip.conf' }
export const requiredEvidence = ['protocol', 'infrastructure', 'migration', 'workboard', 'fixtures']
export function evidenceErrors(release, seal, evidence, now = Date.now()) {
  const errors = []
  for (const name of requiredEvidence) {
    const value = evidence?.[name]
    if (!value || value.app !== APP || value.seal !== seal || value.result !== 'approved' || !Array.isArray(value.files) || !value.files.length) { errors.push('missing-evidence:' + name); continue }
    if (!Number.isFinite(Date.parse(value.at)) || Date.parse(value.at) > now || now - Date.parse(value.at) > 24 * 60 * 60_000) errors.push('expired-evidence:' + name)
    for (const item of value.files) { try { if (fileHash(inside(release, item.path)) !== item.sha256) errors.push('evidence-file-drift:' + name) } catch { errors.push('missing-evidence-file:' + name) } }
  }
  // Operator provenance is required, but NOT treated as proof that arbitrary old tabs/SWs are absent.
  const migration = evidence?.migration
  if (!migration?.procedure || !migration?.freshProfileCreatedAt || !migration?.profileEvidenceId || migration?.oldProfileCredentialsUsed !== false || migration?.remainingRisk !== 'arbitrary-old-profile-not-attestable') errors.push('clean-profile-procedure-not-recorded')
  const infra = evidence?.infrastructure
  if (JSON.stringify(infra?.hosts) !== JSON.stringify(HOSTS) || infra?.tlsMode !== 'Full (strict)' || !infra?.canaryDigest || !infra?.originCertificateFingerprint || !infra?.publicCertificateFingerprints || !infra?.renewalDryRun) errors.push('dns-tls-canary-strict-evidence-missing')
  return [...new Set(errors)]
}
export function productionOps(release) {
  const meta = json(join(release, 'metadata.json')), baseline = json(join(release, 'baseline.json')), inventory = json(join(release, 'inventory.json'))
  assert(meta.app === APP && meta.main === MAIN && meta.release === release && meta.hours === HOURS && meta.requiredEncryption === true, 'wrong-release')
  const outside = release + '.activation', marker = outside + '/attempt.json', lock = '/root/.local/state/codex-remote/deployment.lock'
  let sourceIntegrated = false, copied = false, clientPublished = false, newClient, config, ownedWatcher, boundReadiness, ownerReader, keyLocation, boundKey, cutoverArmed = false, workboardInstalled = false
  assert(meta.sourceTarget === SOURCE, 'source-target-not-reviewed')
  const destinations = new Destinations(baseline.destinations.entries, baseline.destinations.parents)
  const expectedNginx = structuredClone(baseline.nginxFiles)
  const expectedWorkboardDropins = structuredClone(baseline.workboardDropins)
  const deploymentLock = new DeploymentLock(lock, { release, pid: process.pid })
  const publication = new Publication(outside, { app: APP, source: SOURCE, seal: fileHash(join(release, 'seal.json')), modules: Object.fromEntries(inventory.groups.backend.map(item => [item.path, item.sha256])) })
  const envBase = () => parseEnv(readFileSync(join(MAIN, '.env'), 'utf8'))
  const envPatch = { CODEX_REMOTE_SECURE_API: 'required', CODEX_REMOTE_SECURE_KEY_FILE: meta.keyFile,
    CODEX_REMOTE_PREVIEW_ORIGIN_TEMPLATE: 'https://p{port}.danhkhai.io.vn', CODEX_REMOTE_FILE_ROOTS: meta.fileRoots.join(','),
    CODEX_REMOTE_SESSION_STATE: '/root/.local/state/codex-remote/sessions.json', CODEX_REMOTE_TRUSTED_PROXIES: '127.0.0.1,::1' }
  function sealCheck() {
    const seal = json(join(release, 'seal.json')), actual = tree(release)
    delete actual['seal.json']
    same(actual, seal.files, 'release-seal-drift')
    assert(seal.app === APP && json(join(release, 'dependencies/node_modules/jose/package.json')).version === '6.2.12', 'dependency-version')
    return fileHash(join(release, 'seal.json'))
  }
  function sourceCheck() {
    const wanted = sourceIntegrated ? SOURCE : BASE
    assert(command('git', ['symbolic-ref', '--short', 'HEAD']) === 'main', 'production-branch-drift')
    assert(command('git', ['rev-parse', 'HEAD']) === wanted, 'source-head-drift')
    assert(command('git', ['status', '--porcelain', '--untracked-files=all']) === '', 'dirty-main')
    for (const kind of ['fetch', 'push']) assert(hash(command('git', ['remote', 'get-url', ...(kind === 'push' ? ['--push'] : []), 'origin'])) === baseline.remote[kind], 'remote-url-drift')
    assert(command('git', ['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0] === wanted, 'remote-main-drift')
    if (!sourceIntegrated) for (const [path, value] of Object.entries(baseline.source)) same(record(join(MAIN, path)), value, 'source-baseline-drift:' + path)
  }
  function workboardConfigCheck() {
    same(record('/etc/systemd/system/workboard.service.d').absent ? {} : tree('/etc/systemd/system/workboard.service.d'), expectedWorkboardDropins, 'workboard-dropins-drift')
    const unit = '/etc/systemd/system/workboard.service'
    if (baseline.stable[unit]) same(record(unit), baseline.stable[unit], 'workboard-unit-drift')
    if (!workboardInstalled && baseline.unitHashes['workboard.service']) assert(hash(command('systemctl', ['cat', 'workboard.service'])) === baseline.unitHashes['workboard.service'], 'workboard-effective-unit-drift')
  }
  function stableCheck({ after = false } = {}) {
    sourceCheck()
    destinations.all()
    for (const [path, value] of Object.entries(baseline.nginxTempDirectories)) same({ ...record(path), ino: lstatSync(path).ino }, value, 'nginx-temp-metadata-drift')
    for (const [path, value] of Object.entries(baseline.stable)) {
      if (Object.hasOwn(destinations.entries, path)) continue // Exact updated owned preimage checked above.
      same(record(path), value, 'config-baseline-drift:' + path)
    }
    same(tree('/etc/nginx'), expectedNginx, 'nginx-tree-drift')
    for (const [unit, digest] of Object.entries(baseline.unitHashes)) {
      if (after && unit === 'workboard.service') continue
      assert(hash(command('systemctl', ['cat', unit])) === digest, 'service-unit-drift:' + unit)
    }
    workboardConfigCheck()
    if (!after) assert(serviceIdentity('workboard.service') === baseline.workboard, 'workboard-process-drift')
    if (!after) assert(serviceIdentity('codex-remote.service') === baseline.service, 'gateway-process-drift')
    assert(fileHash(join(MAIN, 'dist-server/work-hours.js')) === HOURS, 'hours-drift')
    const expected = { ...baseline.backend }
    if (copied) for (const item of inventory.groups.backend) expected[item.path.slice(12)] = { ...record(join(release, 'payload', item.path)), mode: baseline.backend[item.path.slice(12)]?.mode ?? 0o644 }
    // Object key order is normalized for new modules.
    const actual = tree(join(MAIN, 'dist-server'))
    assert(JSON.stringify(Object.entries(actual).sort()) === JSON.stringify(Object.entries(expected).sort()), 'backend-or-excluded-module-drift')
  }
  async function candidateConfig(preKey = true) {
    const { loadConfig } = await import(pathToFileURL(join(release, 'operator/dist-server/config.js')).href)
    config = loadConfig({ ...envBase(), ...envPatch, NODE_ENV: 'production' })
    assert(config.secureApiRequired && config.publicOrigin.origin === publicOrigin && config.host === '127.0.0.1' && config.port === 5173, 'required-config-contract')
    const { readOwnerKey, assertKeyLocation } = await import(pathToFileURL(join(release, 'operator/dist-server/secure-key.js')).href)
    ownerReader = readOwnerKey; keyLocation = assertKeyLocation
    return preKey ? provisionPlan(meta, keyLocation) : keyIdentity()
  }
  function keyIdentity() { return ownerIdentity(meta, ownerReader) }
  function keyBoundary() {
    if (!cutoverArmed) { same(provisionPlan(meta, keyLocation), boundReadiness.provision, 'armed-provision-plan-drift'); return }
    if (record(meta.keyFile).absent) { assert(!boundKey, 'bound-owner-key-removed'); return }
    assert(processStart(baseline.oldProcess.pid) !== baseline.oldProcess.start, 'owner-key-exposed-to-old-process')
    if (boundKey) { same(keyIdentity(), boundKey, 'bound-owner-key-drift'); return }
    if (!record(join(outside, 'key-binding.json')).absent) { boundOwner(release, meta, fileHash(join(release, 'seal.json')), ownerReader); return }
    const state = json(join(outside, 'key-cutover-state.json'))
    assert(state.status === 'running' && ['generate-owner-key', 'bind-owner-key'].includes(state.phase), 'unexpected-unbound-owner-key')
  }
  function receiptBinding(evidence) {
    return { evidence: record(join(outside, 'evidence.json')), authority: record(join(outside, 'authorization.json')),
      files: Object.fromEntries(Object.values(evidence).flatMap(value => (value?.files ?? []).map(item => {
        const path = inside(outside, item.path); return [path, record(path)]
      }))) }
  }
  async function gates(applying = false, bind = false) {
    const blockers = meta.activationEligible === true ? [] : ['review-release-not-activation-eligible']; let seal, provision, evidence = {}, receipts
    try { seal = sealCheck() } catch (error) { blockers.push(error.message) }
    try { stableCheck() } catch (error) { blockers.push(error.message) }
    try { same(tree(join(MAIN, 'node_modules')), baseline.dependencies, 'dependency-baseline-drift') } catch (error) { blockers.push(error.message) }
    try { evidence = json(join(outside, 'evidence.json')); receipts = receiptBinding(evidence) } catch { /* Missing receipts block, never bypass. */ }
    blockers.push(...evidenceErrors(outside, seal, evidence))
    // Infrastructure has no dependency on owner-key availability. Check real DNS/TLS
    // whenever its own receipt is valid, even if migration/key readiness is pending.
    const infraErrors = evidenceErrors(outside, seal, evidence).filter(error => error.includes('infrastructure') || error.includes('dns-tls'))
    if (!infraErrors.length) { try { await verifyInfrastructure(evidence.infrastructure) } catch (error) { blockers.push(error.message) } }
    try { provision = await candidateConfig(); assert(record(join(outside, 'key-binding.json')).absent, 'previous-key-binding'); same(command('/usr/bin/systemctl', ['show', 'codex-remote.service', '-p', 'Type', '-p', 'KillMode', '-p', 'SendSIGKILL', '-p', 'TriggeredBy', '-p', 'ControlGroup']), baseline.cutoverPolicy, 'service-stop-policy-drift') } catch (error) { blockers.push('pre-key-provision-not-ready:' + error.message) }
    if (applying) {
      try {
        const authority = json(join(outside, 'authorization.json'))
        assert(authority.app === APP && authority.source === SOURCE && authority.seal === seal && authority.runner === fileHash(join(release, 'runner/production.mjs')) && authority.evidence === fileHash(join(outside, 'evidence.json')) && authority.action === 'publish-reviewed-release' && typeof authority.operator === 'string' && authority.operator.length > 0 && typeof authority.existingUserAuthorization === 'string' && authority.existingUserAuthorization.length > 0, 'readiness-record-invalid')
        assert(Date.now() - Date.parse(authority.at) < 60 * 60_000 && Date.parse(authority.at) <= Date.now(), 'execution-readiness-expired')
        same(receiptBinding(json(join(outside, 'evidence.json'))), receipts, 'receipts-changed-during-validation')
        blockers.push(...evidenceErrors(outside, seal, json(join(outside, 'evidence.json'))))
        sourceCheck() // DNS/TLS/key awaits must not hide a concurrent Git transition.
      } catch (error) { blockers.push(error.message) }
      const current = { receipts, provision }
      if (boundReadiness) { try { same(current, boundReadiness, 'armed-readiness-changed') } catch (error) { blockers.push(error.message) } }
      if (bind && !blockers.length) boundReadiness = structuredClone(current)
    }
    return { status: blockers.length ? 'preparationblocked' : 'activation-candidate-not-armed', app: APP, source: SOURCE, seal, blockers: [...new Set(blockers)], productionChanged: false }
  }
  async function validateReadiness() {
    assert(boundReadiness, 'readiness-not-bound')
    const result = await gates(true)
    assert(!result.blockers.length, 'current-readiness:' + result.blockers.join(','))
    stableCheck() // Last await finished; actual write also checks its own preimage.
    boundNow()
  }
  function boundNow() {
    assert(boundReadiness, 'readiness-not-bound')
    const evidence = json(join(outside, 'evidence.json')), authority = json(join(outside, 'authorization.json'))
    assert(Date.now() >= Date.parse(authority.at) && Date.now() - Date.parse(authority.at) < 60 * 60_000, 'execution-readiness-expired')
    assert(!evidenceErrors(outside, fileHash(join(release, 'seal.json')), evidence).length, 'execution-evidence-expired-or-invalid')
    same(receiptBinding(evidence), boundReadiness.receipts, 'armed-readiness-changed')
    keyBoundary()
  }
  const runOld = (args, wait = false) => {
    const script = join(release, 'old/scripts/restart-when-idle.mjs')
    if (!wait) return jsonOutput(command(process.execPath, ['--env-file=' + join(MAIN, '.env'), script, ...args], MAIN, { PATH: process.env.PATH, HOME: '/root' }))
    return new Promise((resolve, reject) => {
      // Do not inherit CODEX_REMOTE_* overrides; the sealed old config must use original env values.
      const child = spawn(process.execPath, ['--env-file=' + join(outside, 'backup/original.env'), script], { cwd: MAIN, stdio: 'ignore', env: { PATH: join(release, 'runner/cutover-bin') + ':' + process.env.PATH, HOME: '/root' } })
      ownedWatcher = child
      const timer = setInterval(() => { try { sealCheck(); boundNow(); stableCheck({ after: serviceIdentity('codex-remote.service') !== baseline.service }) } catch { child.kill('SIGTERM') } }, 5000)
      const timeout = setTimeout(() => child.kill('SIGTERM'), 12 * 60 * 60_000)
      child.once('error', () => { clearInterval(timer); clearTimeout(timeout); reject(Error('old-watcher-start-failed')) })
      child.once('exit', code => { ownedWatcher = undefined; clearInterval(timer); clearTimeout(timeout); if (code === 0) resolve(); else reject(Error('old-watcher-failed')) })
    })
  }
  const jsonOutput = value => { try { return JSON.parse(value) } catch { throw Error('old-readiness-invalid') } }
  function installConfig(source, destination) {
    destinations.all(); same(tree('/etc/nginx'), expectedNginx, 'nginx-tree-drift')
    boundNow()
    destinations.write(destination, readFileSync(join(release, 'infra', source)), destinations.entries[destination].mode ?? 0o644)
    if (destination.startsWith('/etc/nginx/')) expectedNginx[destination.slice('/etc/nginx/'.length)] = record(destination)
  }
  function nginxReload() { destinations.all(); same(tree('/etc/nginx'), expectedNginx, 'nginx-before-test-drift'); boundNow(); command('/usr/sbin/nginx', ['-t']); destinations.all(); same(tree('/etc/nginx'), expectedNginx, 'nginx-before-reload-drift'); boundNow(); command('systemctl', ['reload', 'nginx.service']) } // Only apply, NEVER preparation/fixture.
  const ops = {
    modules: inventory.groups.backend.map(item => item.path), sleep, now: Date.now,
    onTerminate(save) {
      const handlers = ['SIGTERM', 'SIGINT'].map(signal => {
        const handler = async () => { ownedWatcher?.kill('SIGTERM'); try { await save() } finally { process.exit(signal === 'SIGTERM' ? 143 : 130) } }
        process.once(signal, handler); return [signal, handler]
      })
      return () => { for (const [signal, handler] of handlers) process.removeListener(signal, handler) }
    },
    check: () => gates(true),
    async acquire() {
      assert(existsSync(outside) && lstatSync(outside).uid === 0 && (lstatSync(outside).mode & 0o077) === 0, 'private-activation-directory-required')
      assert(!existsSync(marker), 'previous-attempt-requires-new-release')
      deploymentLock.acquire()
    },
    async release() { newClient?.close(); deploymentLock.release() },
    async state(value) { atomicBytes(marker, JSON.stringify({ ...value, ...publication.references(), app: APP, source: SOURCE, at: new Date().toISOString() }) + '\n', 0o600) },
    async preflight() { const result = await gates(true, true); assert(!result.blockers.length, 'activation-gates:' + result.blockers.join(',')); same(tree(join(MAIN, 'dist')), baseline.client, 'client-baseline-drift') },
    async drift() { await validateReadiness() },
    validateReadiness,
    async oldReadiness() { return runOld(['--check']) },
    async gateIngress() {
      await validateReadiness()
      // Ensure authorized SAN parked config exists before touching ingress.
      assert(existsSync('/etc/letsencrypt/live/codex-preview-ports/fullchain.pem'), 'preview-certificate-missing')
      installConfig('admin-maintenance.conf', sites.admin); installConfig('preview-parked.conf', sites.preview); nginxReload()
    },
    async preCopy() { await validateReadiness() },
    async sourceTransition() {
      sourceCheck(); destinations.all()
      let latest
      const progress = state => { latest = state; atomicBytes(join(outside, 'source-transition.json'), JSON.stringify({ app: APP, source: SOURCE, ...state, at: new Date().toISOString() }) + '\n', 0o600) }
      try {
        command('git', ['merge-base', '--is-ancestor', BASE, SOURCE])
        progress({ local: 'outcome-unknown', remote: BASE, step: 'local-fast-forward-dispatching' })
        sourceCheck(); boundNow()
        command('git', ['-c', 'core.hooksPath=/dev/null', 'merge', '--ff-only', '--no-edit', SOURCE])
        progress({ local: command('git', ['rev-parse', 'HEAD']), remote: BASE, step: 'local-fast-forwarded' })
        assert(command('git', ['symbolic-ref', '--short', 'HEAD']) === 'main' && command('git', ['rev-parse', 'HEAD']) === SOURCE && command('git', ['status', '--porcelain', '--untracked-files=all']) === '', 'source-drift-before-push')
        assert(command('git', ['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0] === BASE, 'remote-drift-before-push')
        for (const kind of ['fetch', 'push']) assert(hash(command('git', ['remote', 'get-url', ...(kind === 'push' ? ['--push'] : []), 'origin'])) === baseline.remote[kind], 'remote-url-drift')
        boundNow()
        progress({ local: SOURCE, remote: 'outcome-unknown', step: 'push-dispatching' })
        command('git', ['-c', 'core.hooksPath=/dev/null', 'push', '--porcelain', 'origin', SOURCE + ':refs/heads/main'])
        sourceIntegrated = true; sourceCheck()
        progress({ local: SOURCE, remote: SOURCE, step: 'confirmed' })
      } catch (error) {
        const observe = args => { try { return command('git', args).split(/\s+/)[0] } catch { return 'outcome-unknown' } }
        progress({ ...latest, status: 'failed', observed: { local: observe(['rev-parse', 'HEAD']), remote: observe(['ls-remote', 'origin', 'refs/heads/main']) }, reason: error.message })
        throw error
      }
    },
    async backup() {
      const directory = join(outside, 'backup'); mkdirSync(directory, { mode: 0o700 })
      // Secret material only in this private backup, never immutable/public artifacts.
      for (const [name, target] of Object.entries(sites)) if (!record(target).absent) atomicBytes(join(directory, 'nginx-' + name), readFileSync(target), 0o600)
      atomicBytes(join(directory, 'original.env'), readFileSync(join(MAIN, '.env')), 0o600)
      for (const item of inventory.groups.backend) if (!record(join(MAIN, item.path)).absent) atomicBytes(join(directory, item.path), readFileSync(join(MAIN, item.path)), 0o600)
      // Consistent private SQLite snapshot; never copy a live DB/WAL or auto-restore it.
      command('python3', ['-c', 'import os,sqlite3,sys; os.umask(0o077); source=sqlite3.connect("file:/root/GITHUB/Workboard/data/workboard.sqlite3?mode=ro",uri=True); target=sqlite3.connect(sys.argv[1]); source.backup(target); target.close(); source.close()', join(directory, 'workboard.sqlite3')])
      atomicBytes(join(directory, 'workboard-server.py'), readFileSync('/root/GITHUB/Workboard/server.py'), 0o600)
    },
    async assets() {
      sourceCheck(); boundNow()
      for (const item of inventory.groups.client.filter(item => item.path !== 'dist/index.html')) {
        const target = join(MAIN, item.path), previous = baseline.client[item.path.slice(5)]
        same(record(target), previous ?? { absent: true }, 'client-target-drift:' + item.path)
        boundNow(); destinations.write(target, readFileSync(join(release, 'payload', item.path)))
      }
    },
    async install(path) {
      boundNow()
      const item = inventory.groups.backend.find(item => item.path === path); assert(item, 'module-not-allowlisted')
      same(record(join(MAIN, path)), baseline.backend[path.slice(12)] ?? { absent: true }, 'precopy-module-drift:' + path)
      destinations.write(join(MAIN, path), readFileSync(join(release, 'payload', path)), baseline.backend[path.slice(12)]?.mode ?? 0o644)
    },
    async assertInstalled() { copied = true; stableCheck() },
    async activateDependenciesConfig() {
      // Rename/symlink only after ALL-idle checks. No npm install in live directory.
      destinations.all(); sourceCheck(); boundNow()
      destinations.dependencySwap(join(MAIN, 'node_modules'), join(outside, 'backup/node_modules'), join(release, 'dependencies/node_modules'), () => same(tree(join(MAIN, 'node_modules')), baseline.dependencies, 'dependency-at-swap-drift'))
      const existing = readFileSync(join(MAIN, '.env'), 'utf8')
      const names = new Set(Object.keys(envPatch))
      const kept = existing.split('\n').filter(line => !names.has(line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/)?.[1])).join('\n')
      boundNow(); destinations.all()
      destinations.write(join(MAIN, '.env'), kept + '\n' + Object.entries(envPatch).map(([name, value]) => `${name}=${value}`).join('\n') + '\n', baseline.stable[join(MAIN, '.env')].mode)
    },
    async oldWatcherRestart() {
      destinations.all(); sourceCheck(); boundNow()
      const { parseProperties, servicePolicy, assertServicePolicy } = await import('./cutover-ops.mjs')
      const properties = parseProperties(command('/usr/bin/systemctl', ['show', 'codex-remote.service', '-p', 'Type', '-p', 'KillMode', '-p', 'SendSIGKILL', '-p', 'TriggeredBy', '-p', 'ControlGroup']))
      assertServicePolicy(properties); assert(properties.ControlGroup === baseline.oldProcess.cgroup, 'old-cgroup-drift')
      stableCheck(); boundNow()
      assert(record(join(outside, 'key-cutover-permit.json')).absent, 'prior-cutover-permit')
      const permit = { release, app: APP, seal: fileHash(join(release, 'seal.json')), runner: { pid: process.pid, start: processStart(process.pid) }, old: baseline.oldProcess, lock,
        port: config.port, servicePolicy: servicePolicy(properties), receipts: boundReadiness.receipts, provision: boundReadiness.provision,
        destinations: { entries: destinations.entries, parents: destinations.parents }, backend: tree(join(MAIN, 'dist-server')), dependencies: tree(join(MAIN, 'node_modules')),
        remote: baseline.remote, unitHashes: baseline.unitHashes, stable: Object.fromEntries(Object.keys(baseline.stable).map(path => [path, record(path)])) }
      atomicBytes(join(outside, 'key-cutover-permit.json'), JSON.stringify(permit) + '\n', 0o600)
      cutoverArmed = true
      await runOld([], true)
    },
    async newBackend() {
      const identity = serviceIdentity('codex-remote.service')
      assert(identity.match(/MainPID=(\d+)/)?.[1] !== baseline.service.match(/MainPID=(\d+)/)?.[1] && /MainPID=[1-9]\d*/.test(identity) && identity.includes('ActiveState=active') && BigInt(identity.match(/ExecMainStartTimestampMonotonic=(\d+)/)?.[1] ?? 0) > BigInt(baseline.service.match(/ExecMainStartTimestampMonotonic=(\d+)/)?.[1] ?? 0), 'no-fresh-gateway-process')
      stableCheck({ after: true })
      assert(realpathSync('/proc/' + identity.match(/MainPID=(\d+)/)[1] + '/cwd') === MAIN, 'new-gateway-cwd-drift')
      assert(hash(readFileSync('/proc/' + identity.match(/MainPID=(\d+)/)[1] + '/cmdline')) === baseline.processCommand, 'new-entry-command-drift')
      const { maintenanceClient } = await import(pathToFileURL(join(release, 'operator/scripts/secure-maintenance.mjs')).href)
      await candidateConfig(false); boundKey = boundOwner(release, meta, fileHash(join(release, 'seal.json')), ownerReader); boundNow(); newClient = await maintenanceClient(config)
      const response = await newClient.fetch('/api/session', { signal: AbortSignal.timeout(10000) }); assert(response.ok, 'encrypted-proof-failed'); await response.arrayBuffer()
    },
    async workboard() {
      assert(fileHash('/root/GITHUB/Workboard/server.py') === baseline.stable['/root/GITHUB/Workboard/server.py'].sha256, 'workboard-source-drift')
      destinations.all(); sourceCheck(); workboardConfigCheck(); boundNow()
      destinations.write('/root/GITHUB/Workboard/server.py', readFileSync(join(release, 'infra/workboard-server.py')), baseline.stable['/root/GITHUB/Workboard/server.py'].mode)
      destinations.all(); workboardConfigCheck(); boundNow()
      destinations.write('/etc/systemd/system/workboard.service.d/isolated-preview.conf', readFileSync(join(release, 'infra/workboard-isolated.conf')))
      expectedWorkboardDropins['isolated-preview.conf'] = record('/etc/systemd/system/workboard.service.d/isolated-preview.conf'); workboardInstalled = true
      destinations.all(); workboardConfigCheck(); boundNow(); command('systemctl', ['daemon-reload'])
      destinations.all(); workboardConfigCheck(); boundNow(); command('systemctl', ['restart', 'workboard.service'])
    },
    async index() {
      destinations.all(); sourceCheck(); boundNow()
      same(record(join(MAIN, 'dist/index.html')), baseline.client['index.html'], 'index-drift')
      destinations.write(join(MAIN, 'dist/index.html'), readFileSync(join(release, 'payload/dist/index.html'))); clientPublished = true
    },
    async openIngress() {
      assert(clientPublished, 'index-not-published'); installConfig('cloudflare-real-ip.conf', sites.ip)
      installConfig('admin-active.conf', sites.admin); installConfig('preview-active.conf', sites.preview); nginxReload()
    },
    async verify() {
      const { postverify } = await import('./verify.mjs')
      const evidence = await postverify({ release, meta, baseline, inventory, client: newClient, config })
      stableCheck({ after: true }); return evidence
    },
    async persistProof(evidence) { return publication.persist(evidence) },
    async bookkeeping(evidence) {
      boundNow(); publication.status('services', 'dispatching-outcome-unknown')
      // Bookkeeping follows actual publication proof, never preparation. No leader handoff write.
      const service = await newClient.fetch('/api/services', { method: 'PUT', body: JSON.stringify({ port: null, path: '/', name: 'Codex Remote', branch: 'main', directory: MAIN, kind: 'app', prUrl: '', prLabel: 'No PR · Security ' + APP.slice(0, 7), summary: 'Required encrypted API and ciphertext browser cache; isolated HTTPS previews; root/fullAccess retained. Published and verified ' + APP.slice(0, 7) + '.' }), signal: AbortSignal.timeout(15000) })
      assert(service.ok && (await service.json()).service?.path === '/', 'published-services-update-failed')
      publication.status('services', 'confirmed')
      publication.status('vault', 'preparing')
      const notePath = 'References/Codex-Remote-Secure-Release-Publication-' + APP.slice(0, 7) + '.md'
      let updated = false
      for (let attempt = 0; attempt < 3; attempt++) {
        const prior = await newClient.fetch('/api/knowledge/note?path=' + encodeURIComponent(notePath), { signal: AbortSignal.timeout(15000) })
        assert(prior.ok || prior.status === 404, 'publication-note-read-failed')
        const note = prior.ok ? await prior.json() : { revision: '', content: '' }
        const content = (note.content || '---\ntype: reference\nstatus: confirmed\nscope: Codex Remote publication\n---\n') + '\nPublication verified: ' + APP + '.\nRelease seal: ' + fileHash(join(release, 'seal.json')) + '.\nAt: ' + evidence.verifiedAt + '. Hours: ' + HOURS + '. No model/pause mutation used for verification. Root/fullAccess retained.\n'
        boundNow(); publication.status('vault', 'dispatching-outcome-unknown', { attempt, expectedRevision: note.revision })
        const written = await newClient.fetch('/api/knowledge/note', { method: 'PUT', body: JSON.stringify({ path: notePath, content, revision: note.revision, actor: '01a0c024-a380-7312-a73c-a4949cd6d89b' }), signal: AbortSignal.timeout(15000) })
        if (written.status === 409) { await written.arrayBuffer(); publication.status('vault', 'conflict-not-applied', { attempt }); continue }
        assert(written.ok, 'publication-note-write-failed')
        const saved = await written.json() // Consume/authenticate the complete response before confirming the mutation.
        assert(saved.path === notePath && saved.revision === hash(content), 'publication-note-response-mismatch')
        updated = true; break
      }
      assert(updated, 'publication-note-conflict')
      publication.status('vault', 'confirmed', { notePath })
      atomicBytes(join(outside, 'publication-receipt.json'), JSON.stringify({ app: APP, ...evidence, status: 'verified-publication', servicesUpdated: true, checkedVaultNote: notePath }) + '\n', 0o600)
    },
  }
  return ops
}

async function verifyInfrastructure(receipt) {
  const { resolve4 } = await import('node:dns/promises')
  const { connect } = await import('node:tls')
  for (const host of HOSTS) {
    assert((await resolve4(host)).length > 0, 'preview-dns-not-ready:' + host)
    // Normal CA+hostname verification both public CF and direct origin; no rejectUnauthorized:false.
    for (const address of [host, '103.195.237.172']) {
      await new Promise((resolve, reject) => {
        const socket = connect({ host: address, port: 443, servername: host, rejectUnauthorized: true }, () => {
          const fingerprint = socket.getPeerCertificate().fingerprint256
          socket.end()
          const expected = address === host ? receipt.publicCertificateFingerprints[host] : receipt.originCertificateFingerprint
          if (fingerprint !== expected) reject(Error('tls-certificate-drift:' + host)); else resolve()
        })
        socket.setTimeout(10000, () => { socket.destroy(); reject(Error('tls-timeout')) })
        socket.once('error', () => reject(Error('tls-verification-failed:' + host)))
      })
    }
    assert(/^\/\.well-known\/acme-challenge\/[A-Za-z0-9_-]+$/.test(receipt.canaryPath), 'unsafe-canary-path')
    const canary = await fetch('http://' + host + receipt.canaryPath, { redirect: 'error', signal: AbortSignal.timeout(10000), cache: 'no-store' })
    assert(canary.ok && hash(Buffer.from(await canary.arrayBuffer())) === receipt.canaryDigest, 'public-canary-mismatch:' + host)
  }
}
