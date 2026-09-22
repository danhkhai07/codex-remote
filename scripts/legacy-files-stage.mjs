// Build beforehand in the task worktree. Staging only: never installs or restarts.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'
import { payloadNames, patchEnvironment, record, tree } from './legacy-files-install.mjs'

const main = '/root/RUNNING-SERVICES/codex-remote', base = '783b1e3ae0efd683458c9fa0b3518b2e476b06a9'
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
assert.equal(git(main, 'rev-parse', 'HEAD'), base)
assert.equal(git(main, 'status', '--porcelain'), '')
assert.equal(git(process.cwd(), 'status', '--porcelain'), '')
const candidate = git(process.cwd(), 'rev-parse', 'HEAD')
assert(candidate !== base); assert.equal(git(process.cwd(), 'merge-base', base, candidate), base)
const release = '/root/.local/state/codex-remote/releases/legacy-files-' + candidate.slice(0, 7)
const roots = ['/root/GITHUB', '/root/RUNNING-SERVICES', '/root/WORKTREES', '/root/VAULTS']
const policy = await import(pathToFileURL(path.resolve('dist-server/file-policy.js')).href)
for (const root of roots) { assert.equal(fs.realpathSync(root), root); assert(policy.validFileRoot(root)) }
const backend = tree(path.join(main, 'dist-server')), built = tree(path.resolve('dist-server'))
const buildDelta = Object.keys(built).filter(name => built[name].sha256 !== backend[name]?.sha256).sort()
assert.deepEqual(buildDelta.filter(name => !payloadNames.includes(name)), ['event-hub.js.map'], 'Unexpected excluded build delta')
assert.equal(built['event-hub.js'].sha256, backend['event-hub.js'].sha256)
assert.equal(backend['work-hours.js'].sha256, 'b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93')
assert.equal(backend['work-hours.js.map'].sha256, '6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8')
const environment = fs.readFileSync(path.join(main, '.env'), 'utf8')
const desired = patchEnvironment(environment, roots)
const config = (await import(pathToFileURL(path.resolve('dist-server/config.js')).href)).loadConfig({ ...parseEnv(desired), NODE_ENV: 'production' })
assert.deepEqual(config.fileRoots, roots); assert.deepEqual(config.workspaceRoots, ['/root']); assert.equal(config.publicOrigin.origin, 'https://codex.danhkhai.io.vn')
assert(!('secureApiRequired' in config))
const service = 'codex-remote.service'
const pid = execFileSync('/usr/bin/systemctl', ['show', service, '-p', 'MainPID', '--value'], { encoding: 'utf8' }).trim()
assert.equal(pid, '1758426')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const baseline = { capturedAt: new Date().toISOString(), main, base, candidate, roots, service, pid,
  processStart: fs.readFileSync('/proc/' + pid + '/stat', 'utf8').split(') ').at(-1).split(' ')[19],
  unitSha256: digest(execFileSync('/usr/bin/systemctl', ['cat', service])), origin: config.publicOrigin.origin, port: config.port,
  environment: record(path.join(main, '.env')), backend, client: tree(path.join(main, 'dist')), buildDelta,
  excludedBuildDrift: { file: 'event-hub.js.map', runtime: backend['event-hub.js.map'].sha256, rebuilt: built['event-hub.js.map'].sha256, action: 'preserve existing runtime map; JS and source unchanged by this task' },
}
fs.mkdirSync(release, { mode: 0o700 })
fs.mkdirSync(path.join(release, 'payload'), { mode: 0o700 })
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 }); fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL) }
for (const name of payloadNames) copy(path.resolve('dist-server', name), path.join(release, 'payload', name))
const watcherFiles = ['scripts/restart-when-idle.mjs', 'scripts/restart-readiness.mjs', 'dist-server/auth.js', 'dist-server/config.js', 'dist-server/localhost-preview.js', 'dist-server/preview-paths.js']
for (const name of watcherFiles) copy(path.join(main, name), path.join(release, 'watcher', name))
fs.writeFileSync(path.join(release, 'watcher/package.json'), '{"type":"module"}\n', { flag: 'wx', mode: 0o600 })
fs.writeFileSync(path.join(release, 'environment.desired'), desired, { flag: 'wx', mode: 0o600 })
fs.writeFileSync(path.join(release, 'baseline.json'), JSON.stringify(baseline, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
copy(path.resolve('scripts/legacy-files-install.mjs'), path.join(release, 'install.mjs'))
copy(path.resolve('docs/security/legacy-files-rollout.md'), path.join(release, 'README.md'))
const inventory = { source: candidate, applicationBase: base, state: 'prepared-not-armed', payload: Object.fromEntries(payloadNames.map(name => [name, record(path.join(release, 'payload', name))])),
  files: Object.fromEntries(['baseline.json', 'environment.desired', 'install.mjs', 'README.md', ...payloadNames.map(name => 'payload/' + name)].map(name => [name, record(path.join(release, name))])), watcher: tree(path.join(release, 'watcher')) }
fs.writeFileSync(path.join(release, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
execFileSync(process.execPath, [path.join(release, 'install.mjs'), '--check', release], { stdio: ['ignore', 'ignore', 'ignore'] })
console.log(JSON.stringify({ release, candidate, payload: payloadNames, inventorySha256: record(path.join(release, 'inventory.json')).sha256, state: 'prepared-not-armed', environmentChangedFields: ['CODEX_REMOTE_FILE_ROOTS'], excludedBuildDrift: baseline.excludedBuildDrift }, null, 2))
