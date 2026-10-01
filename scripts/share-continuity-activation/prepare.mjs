import assert from 'node:assert/strict'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { atomic, hash, identity, tree } from '../preview-share-release/core.mjs'
import { TARGET_SOURCE, PORTS, HOSTS, PAYLOAD, patchEnvironment } from './plan.mjs'

const R = '/root/RUNNING-SERVICES/codex-remote-secure', S = '/root/.local/state/codex-remote-secure'
const STAGE = S + '/releases/share-service-continuity-posttls-20261001'
const release = resolve(process.argv[2] ?? ''), root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
assert(dirname(release) === S + '/releases' && release.includes('share-service-continuity-activation-'), 'Use a new private NEW release path')
assert(!existsSync(release), 'Release already exists; never overwrite or reseal')
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'Commit runner before sealing')
execFileSync('git', ['merge-base', '--is-ancestor', TARGET_SOURCE, 'HEAD'])
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const mark = path => ({ sha256: hash(path), identity: identity(path) })
const linkMark = path => { const stat = lstatSync(path); assert(stat.isSymbolicLink()); return { target: realpathSync(path), dev: String(stat.dev), ino: String(stat.ino), mode: String(stat.mode), uid: String(stat.uid), gid: String(stat.gid) } }
const unit = name => {
  const values = Object.fromEntries(execFileSync('systemctl', ['show', name, '-p', 'MainPID', '-p', 'ActiveState', '-p', 'UnitFileState', '-p', 'ExecMainStartTimestampMonotonic'], { encoding: 'utf8' }).trim().split('\n').map(line => line.split('=')))
  return { ...values, definition: createHash('sha256').update(execFileSync('systemctl', ['cat', name])).digest('hex') }
}
const env = parseEnv(readFileSync(S + '/instance.env', 'utf8'))
assert.equal(env.CODEX_REMOTE_PORT, '5174'); assert.equal(env.CODEX_REMOTE_HOST, '127.0.0.1')
assert.equal(env.CODEX_REMOTE_PUBLIC_ORIGIN, 'https://remote.danhkhai.io.vn'); assert.equal(env.CODEX_REMOTE_SECURE_API, 'required')
const nginx = realpathSync('/etc/nginx/sites-enabled/codex-preview-ports'), certLive = '/etc/letsencrypt/live/codex-preview-ports-v2/fullchain.pem', certKeyLive = '/etc/letsencrypt/live/codex-preview-ports-v2/privkey.pem'
const cert = realpathSync(certLive), certKey = realpathSync(certKeyLive), renewal = '/etc/letsencrypt/renewal/codex-preview-ports-v2.conf'
const sans = execFileSync('openssl', ['x509', '-in', cert, '-noout', '-ext', 'subjectAltName'], { encoding: 'utf8' })
for (const host of HOSTS) assert(sans.includes('DNS:' + host), 'Certificate missing ' + host)
assert.deepEqual([...sans.matchAll(/DNS:([^,\s]+)/g)].map(x => x[1]).sort(), [...HOSTS].sort(), 'Certificate SAN allowlist')
const hours = Object.fromEntries(readdirSync(S + '/hours').sort().flatMap(name => {
  const path = S + '/hours/' + name, stat = lstatSync(path); return stat.isFile() ? [[name, mark(path)]] : []
}))
const baseline = {
  at: new Date().toISOString(), source: TARGET_SOURCE, runnerSource: git('rev-parse', 'HEAD'),
  sourceTree: git('rev-parse', TARGET_SOURCE + '^{tree}'),
  sourceFiles: Object.fromEntries(['server/services.ts', 'scripts/services.mjs'].map(path => [path, {
    blob: git('rev-parse', TARGET_SOURCE + ':' + path), sha256: createHash('sha256').update(execFileSync('git', ['-C', root, 'show', TARGET_SOURCE + ':' + path])).digest('hex'),
  }])),
  units: { new: unit('codex-remote-secure.service'), old: unit('codex-remote.service') },
  runtime: { backend: tree(R + '/dist-server'), client: tree(R + '/dist'), scripts: tree(R + '/scripts') },
  env: mark(S + '/instance.env'), envCurrentPorts: env.CODEX_REMOTE_PREVIEW_SHARE_PORTS,
  envPatchedSha256: createHash('sha256').update(patchEnvironment(readFileSync(S + '/instance.env'), parseEnv)).digest('hex'),
  key: mark(env.CODEX_REMOTE_SECURE_KEY_FILE), registry: mark(env.CODEX_REMOTE_SERVICES_FILE), grants: mark(env.CODEX_REMOTE_PREVIEW_SHARE_STATE),
  nginx: { path: nginx, enabledLink: linkMark('/etc/nginx/sites-enabled/codex-preview-ports'), ...mark(nginx) },
  certificate: { path: cert, liveLink: linkMark(certLive), keyPath: certKey, keyLiveLink: linkMark(certKeyLive), key: mark(certKey), renewal: mark(renewal), lineage: 'codex-preview-ports-v2', ...mark(cert), sans: HOSTS },
  hours, hoursRuntime: {
    generator: mark(R + '/working-hours/update.py'), adapter: mark(R + '/scripts/remote-instance/hours-update.py'),
    template: mark(R + '/working-hours/dashboard.template.html'), backend: mark(R + '/dist-server/work-hours.js'), backendMap: mark(R + '/dist-server/work-hours.js.map'),
  },
  dependencies: { nodeModules: realpathSync(R + '/node_modules'), package: mark(R + '/package.json'), lock: mark(R + '/package-lock.json') },
}
assert(Number(baseline.units.new.MainPID) > 1 && baseline.units.new.ActiveState === 'active')
assert.equal(baseline.units.old.MainPID, '0'); assert.equal(baseline.units.old.ActiveState, 'inactive'); assert.equal(baseline.units.old.UnitFileState, 'disabled')
const stageManifest = json(STAGE + '/manifest.json'), stageSeal = json(STAGE + '/review-seal.json')
assert.equal(stageManifest.source, TARGET_SOURCE); assert.equal(hash(STAGE + '/manifest.json'), stageSeal.manifest)
assert.equal(hash(nginx), stageManifest.infrastructure['nginx-active.conf'], 'Active Nginx must match the reviewed ten-host configuration')
assert.equal(hash(STAGE + '/infra/nginx-active.conf'), stageManifest.infrastructure['nginx-active.conf'])
mkdirSync(release, { mode: 0o700 })
for (const path of PAYLOAD) {
  assert.equal(hash(STAGE + '/payload/' + path), stageManifest.payload[path])
  atomic(release + '/payload/' + path, readFileSync(STAGE + '/payload/' + path))
}
cpSync(STAGE + '/frozen', release + '/frozen', { recursive: true, dereference: false })
if (!existsSync(release + '/frozen/node_modules')) symlinkSync(realpathSync(R + '/node_modules'), release + '/frozen/node_modules')
for (const name of ['runner.mjs', 'plan.mjs']) atomic(release + '/' + name, readFileSync(dirname(fileURLToPath(import.meta.url)) + '/' + name))
atomic(release + '/baseline.json', JSON.stringify(baseline, null, 2) + '\n')
const manifest = { version: 1, status: 'prepared-not-armed', source: TARGET_SOURCE, runnerSource: baseline.runnerSource, parentStage: STAGE,
  sourceTree: baseline.sourceTree, sourceFiles: baseline.sourceFiles,
  parentReviewSeal: hash(STAGE + '/review-seal.json'), payload: Object.fromEntries(PAYLOAD.map(path => [path, hash(release + '/payload/' + path)])),
  configPatch: { key: 'CODEX_REMOTE_PREVIEW_SHARE_PORTS', value: PORTS.join(',') }, service: 'codex-remote-secure.service', clientWrites: 0,
  stateWrites: 0, allowedRuntimeWrites: [...PAYLOAD, S + '/instance.env'], recovery: 'Before publication, prepare a fresh package. After any publication/attempt, verify-only or reviewed forward fix; never replay or restore registry/grants.' }
atomic(release + '/manifest.json', JSON.stringify(manifest, null, 2) + '\n')
const sealed = ['manifest.json', 'baseline.json', 'runner.mjs', 'plan.mjs', ...PAYLOAD.map(path => 'payload/' + path)]
for (const name of Object.keys(stageManifest.frozen)) sealed.push('frozen/' + name)
const files = Object.fromEntries(sealed.sort().map(path => [path, hash(release + '/' + path)]))
atomic(release + '/seal.json', JSON.stringify({ version: 1, status: 'review-required-not-armed', files }, null, 2) + '\n')
console.log(JSON.stringify({ release, source: TARGET_SOURCE, runnerSource: baseline.runnerSource, seal: hash(release + '/seal.json'), payload: manifest.payload, armed: false }))
