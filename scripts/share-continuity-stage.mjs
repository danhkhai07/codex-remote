// Review-only payload, fresh preimages and frozen NEW maintenance/readiness closure.
// Deliberately no apply/restart option: final activation must bind TLS/ingress after review.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, realpathSync, symlinkSync } from 'node:fs'
import { resolve, join, dirname, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { parseEnv } from 'node:util'
import { PRESERVED_BUILD_DIFFERENCES } from './preview-share-release/plan.mjs'
const R = '/root/RUNNING-SERVICES/codex-remote-secure', S = '/root/.local/state/codex-remote-secure'
const [output, infra] = process.argv.slice(2)
assert(output && infra, 'Usage: node scripts/share-continuity-stage.mjs NEW_OUTPUT INFRA_PLAN_DIR')
const sha = value => createHash('sha256').update(value).digest('hex'), hash = p => sha(readFileSync(p))
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'Commit tested source before packaging')
const source = git('rev-parse', 'HEAD'), root = process.cwd()
const tree = p => Object.fromEntries(readdirSync(p).sort().flatMap(n => { const s = lstatSync(join(p, n)); return s.isDirectory() ? Object.entries(tree(join(p, n))).map(([k, v]) => [n + '/' + k, v]) : s.isFile() ? [[n, hash(join(p, n))]] : [] }))
const backend = tree(root + '/dist-server'), live = tree(R + '/dist-server'), changed = new Set(['services.js', 'services.js.map'])
for (const [name, value] of Object.entries(backend)) if (value !== live[name] && !changed.has(name)) {
  const known = PRESERVED_BUILD_DIFFERENCES[name]
  assert(known?.baseline === live[name] && known?.candidate === value, 'Unexpected backend delta: ' + name)
}
for (const name of Object.keys(live)) assert(backend[name], 'Missing backend ' + name)
assert.equal(live['work-hours.js'], 'b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93')
assert.equal(live['work-hours.js.map'], '6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8')
assert.equal(hash(root + '/package-lock.json'), hash(R + '/package-lock.json'))
const env = parseEnv(readFileSync(S + '/instance.env', 'utf8'))
assert.equal(env.CODEX_REMOTE_PORT, '5174'); assert.equal(env.CODEX_REMOTE_HOST, '127.0.0.1'); assert.equal(env.CODEX_REMOTE_PUBLIC_ORIGIN, 'https://remote.danhkhai.io.vn'); assert.equal(env.CODEX_REMOTE_SECURE_API, 'required')
const units = Object.fromEntries(['codex-remote-secure.service', 'codex-remote.service'].map(unit => [unit, execFileSync('systemctl', ['show', unit, '-p', 'MainPID', '-p', 'ActiveState', '-p', 'UnitFileState', '-p', 'ExecMainStartTimestampMonotonic'], { encoding: 'utf8' })]))
assert.match(units['codex-remote.service'], /MainPID=0\n/); assert.match(units['codex-remote.service'], /ActiveState=inactive/); assert.match(units['codex-remote.service'], /UnitFileState=disabled/)
mkdirSync(output, { mode: 0o700 })
const put = (name, bytes) => { const p = join(output, name); mkdirSync(dirname(p), { recursive: true, mode: 0o700 }); writeFileSync(p, bytes, { mode: 0o600, flag: 'wx' }); return sha(bytes) }
const payload = Object.fromEntries(['dist-server/services.js', 'dist-server/services.js.map', 'scripts/services.mjs'].map(name => [name, put('payload/' + name, readFileSync(join(root, name)))]))
const infrastructure = Object.fromEntries(['plan.json', 'nginx-bootstrap.conf', 'nginx-active.conf'].map(name => [name, put('infra/' + name, readFileSync(join(infra, name)))]))
const frozen = {}
const visit = name => {
  if (frozen[name]) return
  const p = resolve(R, name); assert(p.startsWith(R + '/'))
  const bytes = readFileSync(p); frozen[name] = put('frozen/' + name, bytes)
  for (const m of bytes.toString().matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)) visit(relative(R, resolve(dirname(p), m[1])))
}
for (const name of ['package.json', 'dist-server/config.js', 'scripts/secure-maintenance.mjs']) visit(name)
for (const name of ['core.mjs', 'readiness.mjs']) frozen['release/' + name] = put('frozen/release/' + name, readFileSync(join(root, 'scripts/preview-share-release', name)))
symlinkSync(realpathSync(R + '/node_modules'), join(output, 'frozen/node_modules'))
const mark = p => { const s = lstatSync(p); return { sha256: hash(p), dev: s.dev, ino: s.ino, mode: s.mode, uid: s.uid, gid: s.gid } }
const baseline = { at: new Date().toISOString(), units, backend: live, frontend: tree(R + '/dist'), cli: mark(R + '/scripts/services.mjs'), env: mark(S + '/instance.env'),
  key: mark(env.CODEX_REMOTE_SECURE_KEY_FILE), nginx: mark(realpathSync('/etc/nginx/sites-enabled/codex-preview-ports')),
  cert: mark(realpathSync('/etc/letsencrypt/live/codex-preview-ports/fullchain.pem')),
  registry: mark(env.CODEX_REMOTE_SERVICES_FILE), grants: mark(env.CODEX_REMOTE_PREVIEW_SHARE_STATE),
  template: hash(R + '/working-hours/dashboard.template.html'), isolatedTemplate: hash(S + '/hours/dashboard.template.html'), generator: hash(R + '/working-hours/update.py') }
const manifest = { version: 1, status: 'review-only-not-armable', source, base: '5378c9330a2711c0e52a86ee6b44698b93fda38a', payload, infrastructure, frozen,
  publicationService: 'codex-remote-secure.service', noClientPublication: true, noRegistryOrGrantRewrite: true, envFieldAllowlist: ['CODEX_REMOTE_PREVIEW_SHARE_PORTS'],
  gates: ['Root review', 'Three DNS hosts verified, exact ten SAN certificate issued and trusted', 'Exact staged Nginx active ingress and TLS verification', 'Fresh locked activation baseline/seal after infrastructure', 'ALL NEW turns/results/queues/pending/native unsettled idle twice, no exemptions'],
  readiness: 'frozen/release/readiness.mjs: allReadiness + metadataReadiness', lifecycle: 'frozen/release/core.mjs: workflow; 5 second dual idle, final check, NEW only',
  mutationOrder: ['private activation backup under shared deployment.lock', 'services.js/map + services CLI + one env value', 'exactly one ordinary NEW restart after final complete idle', 'verify new PID, hashes, local/public health, encrypted read-only services/shares, private preview auth; no real share mutation'],
  rollback: 'No data/key restore. If already restarted use verify-only/forward fix; never replay an apply or roll back registration identities/grants.' }
const baselineHash = put('baseline.json', JSON.stringify(baseline, null, 2) + '\n')
const manifestHash = put('manifest.json', JSON.stringify(manifest, null, 2) + '\n')
put('review-seal.json', JSON.stringify({ scope: 'review-only; not factual infrastructure/activation readiness', manifest: manifestHash, baseline: baselineHash }, null, 2) + '\n')
console.log(JSON.stringify({ source, prepared: output, backendFiles: 2, maintenanceFiles: 1, clientWrites: 0, productionWrites: 0, status: manifest.status }))
