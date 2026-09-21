import { readFileSync, mkdirSync, rmdirSync, existsSync, renameSync, symlinkSync, realpathSync, lstatSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { APP, BASE, HOURS, HOSTS, MAIN, assert, json, fileHash, hash, record, tree, command, same, inside, atomicBytes, serviceIdentity } from './common.mjs'
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
  const outside = release + '.activation', marker = outside + '/attempt.json', lock = outside + '/lock'
  let acquired = false, gated = false, copied = false, activated = false, clientPublished = false, newClient, config, appliedEnvHash, ownedWatcher
  const appliedConfigs = new Map()
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
  function sourceCheck(applying = false) {
    const head = command('git', ['rev-parse', 'HEAD']), wanted = applying ? APP : BASE
    assert(head === wanted, applying ? 'main-must-be-exact-reviewed-app-before-activation' : 'main-baseline-drift')
    assert(command('git', ['status', '--porcelain']) === '', 'dirty-main')
    // BASE check is exact source+metadata; approved APP switch checks every tracked blob against Git.
    if (!applying) for (const [path, value] of Object.entries(baseline.source)) same(record(join(MAIN, path)), value, 'source-baseline-drift:' + path)
  }
  function stableCheck({ applying = false, after = false } = {}) {
    sourceCheck(applying)
    for (const [path, value] of Object.entries(baseline.nginxTempDirectories)) same({ ...record(path), ino: lstatSync(path).ino }, value, 'nginx-temp-metadata-drift')
    for (const [path, value] of Object.entries(baseline.stable)) {
      if (activated && path === join(MAIN, '.env')) { assert(fileHash(path) === appliedEnvHash, 'activated-environment-drift'); continue }
      if (after && path === '/root/GITHUB/Workboard/server.py') continue
      same(record(path), value, 'config-baseline-drift:' + path)
    }
    for (const [path, expected] of appliedConfigs) assert(fileHash(path) === expected, 'applied-config-drift')
    if (!gated) same(tree('/etc/nginx'), baseline.nginxFiles, 'nginx-baseline-drift')
    else for (const [path, value] of Object.entries(baseline.nginxFiles)) {
      if (['sites-available/codex.danhkhai.io.vn', 'sites-available/codex-preview-ports', 'snippets/codex-cloudflare-real-ip.conf'].includes(path)) continue
      same(record(join('/etc/nginx', path)), value, 'excluded-nginx-drift:' + path)
    }
    for (const [unit, digest] of Object.entries(baseline.unitHashes)) {
      if (after && unit === 'workboard.service') continue
      assert(hash(command('systemctl', ['cat', unit])) === digest, 'service-unit-drift:' + unit)
    }
    if (!after) { same(record('/etc/systemd/system/workboard.service.d').absent ? {} : tree('/etc/systemd/system/workboard.service.d'), baseline.workboardDropins, 'workboard-dropins-drift'); assert(serviceIdentity('workboard.service') === baseline.workboard, 'workboard-process-drift') }
    if (!after) assert(serviceIdentity('codex-remote.service') === baseline.service, 'gateway-process-drift')
    assert(fileHash(join(MAIN, 'dist-server/work-hours.js')) === HOURS, 'hours-drift')
    const expected = { ...baseline.backend }
    if (copied) for (const item of inventory.groups.backend) expected[item.path.slice(12)] = { ...record(join(release, 'payload', item.path)), mode: baseline.backend[item.path.slice(12)]?.mode ?? 0o644 }
    // Object key order is normalized for new modules.
    const actual = tree(join(MAIN, 'dist-server'))
    assert(JSON.stringify(Object.entries(actual).sort()) === JSON.stringify(Object.entries(expected).sort()), 'backend-or-excluded-module-drift')
  }
  async function candidateConfig() {
    const { loadConfig } = await import(pathToFileURL(join(release, 'operator/dist-server/config.js')).href)
    config = loadConfig({ ...envBase(), ...envPatch, NODE_ENV: 'production' })
    assert(config.secureApiRequired && config.publicOrigin.origin === publicOrigin && config.host === '127.0.0.1' && config.port === 5173, 'required-config-contract')
    const { readOwnerKey } = await import(pathToFileURL(join(release, 'operator/dist-server/secure-key.js')).href)
    assert((lstatSync(dirname(meta.keyFile)).mode & 0o077) === 0 && lstatSync(dirname(meta.keyFile)).uid === 0, 'key-directory-permissions')
    readOwnerKey(meta.keyFile, meta.fileRoots) // No returned value is logged/persisted.
  }
  async function gates(applying = false) {
    const blockers = []; let seal
    try { seal = sealCheck() } catch (error) { blockers.push(error.message) }
    try { stableCheck({ applying }) } catch (error) { blockers.push(error.message) }
    try { same(tree(join(MAIN, 'node_modules')), baseline.dependencies, 'dependency-baseline-drift') } catch (error) { blockers.push(error.message) }
    let evidence = {}
    try { evidence = json(join(outside, 'evidence.json')) } catch { /* Missing receipt is a blocker, never a bypass. */ }
    blockers.push(...evidenceErrors(outside, seal, evidence))
    if (!blockers.length) { try { await verifyInfrastructure(evidence.infrastructure) } catch (error) { blockers.push(error.message) } }
    try { await candidateConfig() } catch { blockers.push('private-owner-key-or-required-config-not-ready') }
    if (applying) {
      try {
        const authority = json(join(outside, 'authorization.json'))
        assert(authority.app === APP && authority.seal === seal && authority.runner === fileHash(join(release, 'runner/production.mjs')) && authority.evidence === fileHash(join(outside, 'evidence.json')) && authority.action === 'publish-reviewed-release' && typeof authority.operator === 'string' && authority.operator.length > 0, 'activation-not-authorized')
        assert(Date.now() - Date.parse(authority.at) < 60 * 60_000 && Date.parse(authority.at) <= Date.now(), 'activation-authority-expired')
        assert(command('git', ['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0] === APP, 'remote-main-not-exact-app')
      } catch (error) { blockers.push(error.message) }
    }
    return { status: blockers.length ? 'preparationblocked' : 'prepared-not-armed', app: APP, seal, blockers: [...new Set(blockers)], productionChanged: false }
  }
  const runOld = (args, wait = false) => {
    const script = join(release, 'old/scripts/restart-when-idle.mjs')
    if (!wait) return jsonOutput(command(process.execPath, ['--env-file=' + join(MAIN, '.env'), script, ...args], MAIN, { PATH: process.env.PATH, HOME: '/root' }))
    return new Promise((resolve, reject) => {
      // Do not inherit CODEX_REMOTE_* overrides; the sealed old config must use original env values.
      const child = spawn(process.execPath, ['--env-file=' + join(outside, 'backup/original.env'), script], { cwd: MAIN, stdio: 'ignore', env: { PATH: process.env.PATH, HOME: '/root' } })
      ownedWatcher = child
      const timer = setInterval(() => { try { sealCheck(); stableCheck({ applying: true, after: serviceIdentity('codex-remote.service') !== baseline.service }) } catch { child.kill('SIGTERM') } }, 5000)
      const timeout = setTimeout(() => child.kill('SIGTERM'), 12 * 60 * 60_000)
      child.once('error', () => { clearInterval(timer); clearTimeout(timeout); reject(Error('old-watcher-start-failed')) })
      child.once('exit', code => { ownedWatcher = undefined; clearInterval(timer); clearTimeout(timeout); if (code === 0) resolve(); else reject(Error('old-watcher-failed')) })
    })
  }
  const jsonOutput = value => { try { return JSON.parse(value) } catch { throw Error('old-readiness-invalid') } }
  function installConfig(source, destination) { assert(!record(destination).link, 'refuse-config-symlink'); atomicBytes(destination, readFileSync(join(release, 'infra', source)), record(destination).mode ?? 0o644); appliedConfigs.set(destination, fileHash(destination)) }
  function nginxReload() { command('/usr/sbin/nginx', ['-t']); command('systemctl', ['reload', 'nginx.service']) } // Only apply, NEVER preparation/fixture.
  const ops = {
    modules: inventory.groups.backend.map(item => item.path), sleep, now: Date.now,
    onTerminate(save) {
      const handlers = ['SIGTERM', 'SIGINT'].map(signal => {
        const handler = async () => { ownedWatcher?.kill('SIGTERM'); try { await save() } finally { process.exit(signal === 'SIGTERM' ? 143 : 130) } }
        process.once(signal, handler); return [signal, handler]
      })
      return () => { for (const [signal, handler] of handlers) process.removeListener(signal, handler) }
    },
    check: () => gates(false),
    async acquire() {
      assert(existsSync(outside) && lstatSync(outside).uid === 0 && (lstatSync(outside).mode & 0o077) === 0, 'private-activation-directory-required')
      assert(!existsSync(marker), 'previous-attempt-requires-new-release')
      mkdirSync(lock, { mode: 0o700 }); acquired = true
    },
    async release() { newClient?.close(); if (acquired) rmdirSync(lock) },
    async state(value) { atomicBytes(marker, JSON.stringify({ ...value, app: APP, at: new Date().toISOString() }) + '\n', 0o600) },
    async preflight() { const result = await gates(true); assert(!result.blockers.length, 'activation-gates:' + result.blockers.join(',')); same(tree(join(MAIN, 'dist')), baseline.client, 'client-baseline-drift') },
    async drift() { stableCheck({ applying: true }); sealCheck() },
    async oldReadiness() { return runOld(['--check']) },
    async gateIngress() {
      // Ensure authorized SAN parked config exists before touching ingress.
      assert(existsSync('/etc/letsencrypt/live/codex-preview-ports/fullchain.pem'), 'preview-certificate-missing')
      installConfig('admin-maintenance.conf', sites.admin); installConfig('preview-parked.conf', sites.preview); nginxReload(); gated = true
    },
    async preCopy() { stableCheck({ applying: true }); sealCheck(); same(tree(join(MAIN, 'node_modules')), baseline.dependencies, 'dependency-baseline-drift') },
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
      for (const item of inventory.groups.client.filter(item => item.path !== 'dist/index.html')) {
        const target = join(MAIN, item.path), previous = baseline.client[item.path.slice(5)]
        same(record(target), previous ?? { absent: true }, 'client-target-drift:' + item.path)
        atomicBytes(target, readFileSync(join(release, 'payload', item.path)))
      }
    },
    async install(path) {
      const item = inventory.groups.backend.find(item => item.path === path); assert(item, 'module-not-allowlisted')
      same(record(join(MAIN, path)), baseline.backend[path.slice(12)] ?? { absent: true }, 'precopy-module-drift:' + path)
      atomicBytes(join(MAIN, path), readFileSync(join(release, 'payload', path)), baseline.backend[path.slice(12)]?.mode ?? 0o644)
    },
    async assertInstalled() { copied = true; stableCheck({ applying: true }) },
    async activateDependenciesConfig() {
      // Rename/symlink only after ALL-idle checks. No npm install in live directory.
      assert(!record(join(MAIN, 'node_modules')).link, 'unexpected-live-dependency-link')
      renameSync(join(MAIN, 'node_modules'), join(outside, 'backup/node_modules'))
      symlinkSync(join(release, 'dependencies/node_modules'), join(MAIN, 'node_modules'))
      const existing = readFileSync(join(MAIN, '.env'), 'utf8')
      const names = new Set(Object.keys(envPatch))
      const kept = existing.split('\n').filter(line => !names.has(line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/)?.[1])).join('\n')
      atomicBytes(join(MAIN, '.env'), kept + '\n' + Object.entries(envPatch).map(([name, value]) => `${name}=${value}`).join('\n') + '\n', baseline.stable[join(MAIN, '.env')].mode)
      appliedEnvHash = fileHash(join(MAIN, '.env')); activated = true
    },
    async oldWatcherRestart() { await runOld([], true) },
    async newBackend() {
      const identity = serviceIdentity('codex-remote.service')
      assert(identity.match(/MainPID=(\d+)/)?.[1] !== baseline.service.match(/MainPID=(\d+)/)?.[1] && /MainPID=[1-9]\d*/.test(identity) && identity.includes('ActiveState=active') && BigInt(identity.match(/ExecMainStartTimestampMonotonic=(\d+)/)?.[1] ?? 0) > BigInt(baseline.service.match(/ExecMainStartTimestampMonotonic=(\d+)/)?.[1] ?? 0), 'no-fresh-gateway-process')
      stableCheck({ applying: true, after: true })
      assert(realpathSync('/proc/' + identity.match(/MainPID=(\d+)/)[1] + '/cwd') === MAIN, 'new-gateway-cwd-drift')
      assert(hash(readFileSync('/proc/' + identity.match(/MainPID=(\d+)/)[1] + '/cmdline')) === baseline.processCommand, 'new-entry-command-drift')
      const { maintenanceClient } = await import(pathToFileURL(join(release, 'operator/scripts/secure-maintenance.mjs')).href)
      await candidateConfig(); newClient = await maintenanceClient(config)
      const response = await newClient.fetch('/api/session', { signal: AbortSignal.timeout(10000) }); assert(response.ok, 'encrypted-proof-failed'); await response.arrayBuffer()
    },
    async workboard() {
      assert(fileHash('/root/GITHUB/Workboard/server.py') === baseline.stable['/root/GITHUB/Workboard/server.py'].sha256, 'workboard-source-drift')
      atomicBytes('/root/GITHUB/Workboard/server.py', readFileSync(join(release, 'infra/workboard-server.py')), baseline.stable['/root/GITHUB/Workboard/server.py'].mode)
      atomicBytes('/etc/systemd/system/workboard.service.d/isolated-preview.conf', readFileSync(join(release, 'infra/workboard-isolated.conf')))
      appliedConfigs.set('/root/GITHUB/Workboard/server.py', fileHash('/root/GITHUB/Workboard/server.py'))
      appliedConfigs.set('/etc/systemd/system/workboard.service.d/isolated-preview.conf', fileHash('/etc/systemd/system/workboard.service.d/isolated-preview.conf'))
      command('systemctl', ['daemon-reload']); command('systemctl', ['restart', 'workboard.service'])
    },
    async index() {
      same(record(join(MAIN, 'dist/index.html')), baseline.client['index.html'], 'index-drift')
      atomicBytes(join(MAIN, 'dist/index.html'), readFileSync(join(release, 'payload/dist/index.html'))); clientPublished = true
    },
    async openIngress() {
      assert(clientPublished, 'index-not-published'); installConfig('cloudflare-real-ip.conf', sites.ip)
      installConfig('admin-active.conf', sites.admin); installConfig('preview-active.conf', sites.preview); nginxReload()
    },
    async verify() {
      const { postverify } = await import('./verify.mjs')
      const evidence = await postverify({ release, meta, baseline, inventory, client: newClient, config })
      stableCheck({ applying: true, after: true }); return evidence
    },
    async bookkeeping(evidence) {
      // Bookkeeping follows actual publication proof, never preparation. No leader handoff write.
      const service = await newClient.fetch('/api/services', { method: 'PUT', body: JSON.stringify({ port: null, path: '/', name: 'Codex Remote', branch: 'main', directory: MAIN, kind: 'app', prUrl: '', prLabel: 'No PR · Security ' + APP.slice(0, 7), summary: 'Required encrypted API and ciphertext browser cache; isolated HTTPS previews; root/fullAccess retained. Published and verified ' + APP.slice(0, 7) + '.' }), signal: AbortSignal.timeout(15000) })
      assert(service.ok && (await service.json()).service?.path === '/', 'published-services-update-failed')
      const notePath = 'References/Codex-Remote-Secure-Release-Publication-' + APP.slice(0, 7) + '.md'
      let updated = false
      for (let attempt = 0; attempt < 3; attempt++) {
        const prior = await newClient.fetch('/api/knowledge/note?path=' + encodeURIComponent(notePath), { signal: AbortSignal.timeout(15000) })
        assert(prior.ok || prior.status === 404, 'publication-note-read-failed')
        const note = prior.ok ? await prior.json() : { revision: '', content: '' }
        const content = (note.content || '---\ntype: reference\nstatus: confirmed\nscope: Codex Remote publication\n---\n') + '\nPublication verified: ' + APP + '.\nRelease seal: ' + fileHash(join(release, 'seal.json')) + '.\nAt: ' + evidence.verifiedAt + '. Hours: ' + HOURS + '. No model/pause mutation used for verification. Root/fullAccess retained.\n'
        const written = await newClient.fetch('/api/knowledge/note', { method: 'PUT', body: JSON.stringify({ path: notePath, content, revision: note.revision, actor: '01a0c024-a380-7312-a73c-a4949cd6d89b' }), signal: AbortSignal.timeout(15000) })
        if (written.status === 409) { await written.body?.cancel(); continue }
        assert(written.ok, 'publication-note-write-failed'); await written.body?.cancel(); updated = true; break
      }
      assert(updated, 'publication-note-conflict')
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
