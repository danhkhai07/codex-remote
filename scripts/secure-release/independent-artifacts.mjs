// Read-only independent artifact review; run under codex-heavy. No env/key/receipt creation.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import { APP, SOURCE, HOURS, fileHash, tree } from './common.mjs'
import { verifyClient } from './build.mjs'

const release = resolve(process.argv[2])
const independentBuild = resolve(process.argv[3])
const json = p => JSON.parse(readFileSync(p, 'utf8'))
const inventory = json(join(release, 'inventory.json')), seal = json(join(release, 'seal.json'))
const actual = tree(release); delete actual['seal.json']
assert.deepEqual(actual, seal.files)
assert.match(process.argv[4] ?? '', /^[a-f0-9]{64}$/)
assert.equal(fileHash(join(release, 'seal.json')), process.argv[4])
assert.equal(inventory.commit, APP)
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 24 * 1024 * 1024 })
for (const list of ['backend', 'client', 'operator', 'dependencies', 'adminProxy']) {
  for (const item of inventory.groups[list]) assert.equal(fileHash(join(release, 'payload', item.path)), item.sha256, item.path)
}
// Compare with CR2's prior fresh 80843c0 build, not CR3's original worktree outputs.
for (const item of inventory.groups.backend) assert.equal(fileHash(join(release, 'payload', item.path)), fileHash(join(independentBuild, item.path)), item.path)
const meta = json(join(release, 'metadata.json'))
assert.equal(meta.sourceTarget, SOURCE)
assert.equal(git('diff', '--name-only', APP, SOURCE).trim(), 'docs/security/encrypted-api-rereview-80843c0.md\nserver/secure-independent-review.test.ts')
for (const name of ['common.mjs', 'production.mjs', 'runner.mjs', 'verify.mjs', 'destinations.mjs', 'publication.mjs', 'lock.mjs', 'key-state.mjs', 'key-cutover.mjs', 'cutover-ops.mjs', 'cutover-bin/systemctl']) assert.equal(readFileSync(join(release, 'runner', name), 'utf8'), git('show', meta.runnerSource + ':scripts/secure-release/' + name))
for (const name of ['package.json', 'package-lock.json']) assert.equal(readFileSync(join(release, 'dependencies', name), 'utf8'), git('show', APP + ':' + name))
let checkedSources = 0
for (const item of inventory.groups.client.filter(item => item.path.endsWith('.map'))) {
  const map = json(join(release, 'payload', item.path))
  for (let i = 0; i < map.sources.length; i++) {
    const source = relative(join(release, 'payload'), resolve(dirname(join(release, 'payload', item.path)), map.sources[i]))
    if (!source.startsWith('src/')) continue
    assert.equal(map.sourcesContent[i], git('show', APP + ':' + source), item.path + ':' + source); checkedSources++
  }
}
// Use exact source checkout solely for helper graph/source checks after Git verifies its app blobs.
assert.equal(git('-C', inventory.worktree, 'rev-parse', 'HEAD').trim(), APP)
assert.equal(git('-C', inventory.worktree, 'status', '--porcelain').trim(), '')
const graph = verifyClient(inventory.worktree, inventory.groups.client)
assert.equal(readFileSync(join(release, 'payload/dist/sw.js'), 'utf8'), git('show', APP + ':public/sw.js'))
for (const name of ['jose', 'vitest']) {
  const dependency = json(join(release, 'dependencies/node_modules', name, 'package.json'))
  const lock = json(join(release, 'dependencies/package-lock.json'))
  assert.equal(dependency.version, lock.packages['node_modules/' + name].version)
}
const baseline = json(join(release, 'baseline.json'))
assert.equal(baseline.backend['work-hours.js'].sha256, HOURS)
assert.equal(baseline.backend['work-hours.js.map'].sha256, '6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8')
assert(!inventory.groups.backend.some(item => item.path.includes('work-hours')))
assert.deepEqual(meta.oldWatcherFiles, ['dist-server/auth.js', 'dist-server/config.js', 'dist-server/localhost-preview.js', 'dist-server/preview-paths.js', 'scripts/restart-readiness.mjs', 'scripts/restart-when-idle.mjs'])
const workboard = readFileSync(join(release, 'infra/workboard-server.py'), 'utf8')
const bundleHead = execFileSync('git', ['-C', '/root/WORKTREES/workboard-isolated-preview', 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
assert(bundleHead.startsWith('bc66e80'))
assert.equal(workboard, execFileSync('git', ['-C', '/root/WORKTREES/workboard-isolated-preview', 'show', bundleHead + ':server.py'], { encoding: 'utf8' }))
console.log(JSON.stringify({ seal: fileHash(join(release, 'seal.json')), app: APP, runner: meta.runnerSource, backend: inventory.groups.backend.length, client: inventory.groups.client.length, backendMatchesIndependentBuild: true, applicationMapSources: checkedSources, moduleGraph: graph.graph.length, dependencies: { jose: '6.2.12', vitest: '4.1.11' }, hoursPreserved: HOURS, workboard: bundleHead }))
