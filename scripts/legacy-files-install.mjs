// Scoped installer used only by a separately reviewed release. Never arms itself.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual, parseEnv } from 'node:util'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'

export const modules = ['file-policy', 'server-files', 'directory-listing', 'pptx-preview', 'http-app', 'config']
export const payloadNames = modules.flatMap(name => [name + '.js', name + '.js.map'])
const digest = value => createHash('sha256').update(value).digest('hex')
export function record(file) {
  try {
    const stat = fs.lstatSync(file)
    assert(stat.isFile() && !stat.isSymbolicLink(), 'Expected regular file')
    return { sha256: digest(fs.readFileSync(file)), mode: stat.mode & 0o777, uid: stat.uid, gid: stat.gid }
  } catch (error) { if (error.code === 'ENOENT') return { absent: true }; throw error }
}
export function tree(directory) {
  const result = {}
  const walk = prefix => { for (const name of fs.readdirSync(path.join(directory, prefix)).sort()) {
    const local = path.join(prefix, name), file = path.join(directory, local), stat = fs.lstatSync(file)
    if (stat.isSymbolicLink()) result[local] = { symlink: fs.readlinkSync(file) }
    else if (stat.isDirectory()) walk(local)
    else result[local] = record(file)
  } }
  walk(''); return result
}
export function patchEnvironment(original, roots) {
  assert(roots.length > 0 && roots.every(root => /^\/[A-Za-z0-9_./-]+$/.test(root) && !['/', '/root'].includes(root)))
  const setting = 'CODEX_REMOTE_FILE_ROOTS=' + roots.join(',')
  const pattern = /^[ \t]*(?:export[ \t]+)?CODEX_REMOTE_FILE_ROOTS[ \t]*=.*$/gm
  const matches = original.match(pattern) ?? []
  assert(matches.length <= 1, 'Duplicate file-roots assignment')
  const next = matches.length ? original.replace(pattern, setting) : original + (original.endsWith('\n') ? '' : '\n') + setting + '\n'
  const before = parseEnv(original), after = parseEnv(next)
  delete before.CODEX_REMOTE_FILE_ROOTS; delete after.CODEX_REMOTE_FILE_ROOTS
  if (!isDeepStrictEqual(after, before)) throw Error('Environment change exceeded file roots')
  assert.equal(parseEnv(next).CODEX_REMOTE_FILE_ROOTS, roots.join(','))
  return next
}
export async function installAfterIdle(ops) {
  ops.phase('waiting-for-idle')
  for (;;) {
    ops.preflight()
    if (!(await ops.ready()).ready) { await ops.pause(10_000); continue }
    await ops.pause(5000)
    if (!(await ops.ready()).ready) continue
    ops.preflight()
    if (!(await ops.ready()).ready) continue
    ops.preflight() // No awaited work between final drift guard, backup and publication.
    ops.phase('backup'); ops.backup()
    ops.phase('publication'); ops.publish()
    ops.phase('stock-idle-watcher'); await ops.restart()
    ops.phase('verification'); const proof = await ops.verify()
    ops.phase('complete', proof); return proof
  }
}
function atomic(file, bytes, mode = 0o600) {
  const temporary = file + '.' + randomUUID() + '.tmp'
  const fd = fs.openSync(temporary, 'wx', mode)
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(temporary, file)
  const parent = fs.openSync(path.dirname(file), 'r')
  try { fs.fsyncSync(parent) } finally { fs.closeSync(parent) }
}
async function main() {
  assert(process.getuid() === 0, 'Operator must be root')
  assert(process.argv.length === 4 && ['--check', '--apply'].includes(process.argv[2]), 'Use --check|--apply /absolute/release')
  const release = fs.realpathSync(process.argv[3]), baseline = JSON.parse(fs.readFileSync(path.join(release, 'baseline.json'), 'utf8'))
  const inventory = JSON.parse(fs.readFileSync(path.join(release, 'inventory.json'), 'utf8'))
  const main = '/root/RUNNING-SERVICES/codex-remote', service = 'codex-remote.service'
  assert.equal(baseline.main, main); assert.equal(baseline.service, service)
  assert.deepEqual(Object.keys(inventory.payload).sort(), [...payloadNames].sort())
  const git = (...args) => execFileSync('git', ['-C', main, ...args], { encoding: 'utf8' }).trim()
  const pid = () => execFileSync('/usr/bin/systemctl', ['show', service, '-p', 'MainPID', '--value'], { encoding: 'utf8' }).trim()
  const life = id => fs.readFileSync('/proc/' + id + '/stat', 'utf8').split(') ').at(-1).split(' ')[19]
  const marker = '/root/.local/state/codex-remote/legacy-files-deploy.json'
  const activity = release + '.activation'
  const checkArtifacts = () => {
    for (const [local, expected] of Object.entries(inventory.files)) assert.deepEqual(record(path.join(release, local)), expected, 'Release artifact drift: ' + local)
    assert.deepEqual(tree(path.join(release, 'watcher')), inventory.watcher, 'Frozen watcher drift')
    assert.equal(digest(fs.readFileSync(path.join(release, 'environment.desired'))), digest(patchEnvironment(fs.readFileSync(path.join(main, '.env'), 'utf8'), baseline.roots)), 'Unexpected environment transform')
  }
  const preflight = () => {
    checkArtifacts()
    assert([baseline.base, baseline.candidate].includes(git('rev-parse', 'HEAD')), 'Source head drift')
    assert.equal(git('status', '--porcelain'), '', 'Production source not clean')
    assert.deepEqual(record(path.join(main, '.env')), baseline.environment, 'Environment drift')
    assert.equal(pid(), baseline.pid, 'Gateway lifetime changed'); assert.equal(life(baseline.pid), baseline.processStart)
    assert.equal(digest(execFileSync('/usr/bin/systemctl', ['cat', service])), baseline.unitSha256, 'Service unit drift')
    assert.deepEqual(tree(path.join(main, 'dist')), baseline.client, 'Frontend drift')
    assert.deepEqual(tree(path.join(main, 'dist-server')), baseline.backend, 'Backend drift')
    for (const root of baseline.roots) assert.equal(fs.realpathSync(root), root, 'Root path drift')
  }
  preflight()
  if (process.argv[2] === '--check') { console.log(JSON.stringify({ status: 'prepared-not-armed', candidate: baseline.candidate, files: payloadNames.length, roots: baseline.roots })); return }
  assert.equal(git('rev-parse', 'HEAD'), baseline.candidate, 'Root must integrate reviewed candidate first')
  assert.equal(git('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0], baseline.candidate, 'Remote main must match reviewed candidate')
  assert(!fs.existsSync(marker) && !fs.existsSync(activity), 'Previous/unknown attempt: inspect it; never replay blindly')
  const lock = '/root/.local/state/codex-remote/legacy-files-deploy.lock'
  const ownership = JSON.stringify({ pid: process.pid, release, token: randomUUID() })
  fs.writeFileSync(lock, ownership, { flag: 'wx', mode: 0o600 })
  fs.mkdirSync(activity, { mode: 0o700 })
  let phase = 'starting'
  const phaseRecord = (name, proof) => { phase = name; atomic(marker, Buffer.from(JSON.stringify({ phase, release, candidate: baseline.candidate, at: new Date().toISOString(), ...(proof ? { proof } : {}) }, null, 2) + '\n')) }
  const auth = await import(pathToFileURL(path.join(release, 'watcher/dist-server/auth.js')).href)
  const readiness = await import(pathToFileURL(path.join(release, 'watcher/scripts/restart-readiness.mjs')).href)
  const configModule = await import(pathToFileURL(path.join(release, 'watcher/dist-server/config.js')).href)
  const config = configModule.loadConfig({ ...parseEnv(fs.readFileSync(path.join(main, '.env'), 'utf8')), NODE_ENV: 'production' })
  assert.equal(config.publicOrigin.origin, baseline.origin); assert.equal(config.port, baseline.port)
  const base = `http://${config.host}:${config.port}`
  const call = async (pathname, authenticated = false, origin = base) => {
    const response = await fetch(origin + pathname, { headers: authenticated ? { Cookie: `codex_remote_session=${auth.createSession(config.sessionSecret, 60).token}`, Origin: config.publicOrigin.origin } : {}, redirect: 'manual', signal: AbortSignal.timeout(15_000) })
    const bytes = Buffer.from(await response.arrayBuffer()); return { response, bytes }
  }
  const readApi = async pathname => { const { response, bytes } = await call(pathname, true); assert(response.ok, 'Readiness HTTP failure'); return JSON.parse(bytes.toString()) }
  try {
    await installAfterIdle({
      phase: phaseRecord, preflight, ready: () => readiness.restartReadiness(readApi), pause: ms => new Promise(resolve => setTimeout(resolve, ms)),
      backup: () => {
        for (const name of payloadNames) if (!baseline.backend[name]?.absent && baseline.backend[name]) fs.copyFileSync(path.join(main, 'dist-server', name), path.join(activity, name), fs.constants.COPYFILE_EXCL)
        fs.copyFileSync(path.join(main, '.env'), path.join(activity, 'environment.before'), fs.constants.COPYFILE_EXCL)
        fs.chmodSync(path.join(activity, 'environment.before'), 0o600)
        atomic(path.join(activity, 'preimage.json'), Buffer.from(JSON.stringify({ environment: record(path.join(main, '.env')), backend: tree(path.join(main, 'dist-server')) }, null, 2)))
      },
      publish: () => {
        for (const name of payloadNames) atomic(path.join(main, 'dist-server', name), fs.readFileSync(path.join(release, 'payload', name)), baseline.backend[name]?.mode ?? 0o644)
        atomic(path.join(main, '.env'), fs.readFileSync(path.join(release, 'environment.desired')), baseline.environment.mode)
      },
      restart: () => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--env-file=' + path.join(main, '.env'), path.join(release, 'watcher/scripts/restart-when-idle.mjs')], { cwd: main, env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/root', NODE_ENV: 'production' }, stdio: ['ignore', 'ignore', 'ignore'] })
        child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error('Stock idle watcher failed; inspect its marker')))
      }),
      verify: async () => {
        assert.equal(git('rev-parse', 'HEAD'), baseline.candidate, 'Source changed during deployment')
        assert.equal(git('status', '--porcelain'), '', 'Source changed during deployment')
        assert.equal(digest(execFileSync('/usr/bin/systemctl', ['cat', service])), baseline.unitSha256, 'Unit changed during deployment')
        const fresh = pid(); assert(fresh !== '0' && fresh !== baseline.pid, 'No fresh gateway PID')
        const expected = { ...baseline.backend }
        for (const name of payloadNames) expected[name] = { ...inventory.payload[name], mode: baseline.backend[name]?.mode ?? 0o644 }
        assert.deepEqual(tree(path.join(main, 'dist-server')), expected, 'Published/excluded backend mismatch')
        assert.deepEqual(tree(path.join(main, 'dist')), baseline.client, 'Frontend changed')
        assert.equal(record(path.join(main, '.env')).sha256, record(path.join(release, 'environment.desired')).sha256)
        for (const origin of [base, config.publicOrigin.origin]) {
          const health = await call('/api/healthz', false, origin); assert.equal(health.response.status, 200); assert.equal(JSON.parse(health.bytes).status, 'ok')
          const html = await call('/', false, origin); assert.equal(html.response.status, 200); assert.equal(digest(html.bytes), baseline.client['index.html'].sha256)
        }
        const canary = path.join(activity, 'private-canary.json'); fs.writeFileSync(canary, 'NONSECRET FILES CANARY', { flag: 'wx', mode: 0o600 })
        const denied = await call('/api/files/content?path=' + encodeURIComponent(canary), true); assert.equal(denied.response.status, 403, 'Private canary unexpectedly readable')
        const normal = await call('/api/files/content?path=' + encodeURIComponent(path.join(main, 'README.md')), true); assert.equal(normal.response.status, 200); assert.equal(digest(normal.bytes), record(path.join(main, 'README.md')).sha256)
        return { pid: fresh, processStart: life(fresh), privateCanary: 403, normalProjectFile: 200, localPublicHealthAndHtml: true, excludedBackendFrontendPreserved: true }
      },
    })
    assert.equal(fs.readFileSync(lock, 'utf8'), ownership, 'Installer lock ownership changed')
    fs.unlinkSync(lock)
    console.log(JSON.stringify({ phase: 'complete', marker }))
  } catch { phaseRecord('failed', { failedPhase: phase, recovery: 'Preserve activation/backup/marker; inspect actual state. No automatic rollback or replay.' }); throw Error('Legacy Files deployment failed; inspect private marker and stock watcher status') }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Legacy Files installer rejected; inspect reviewed baselines and private markers. No automatic recovery.'); process.exitCode = 1 })
