// Read-only artifact provenance for the three bounded Leader review fixes.
// Run after npm run check through codex-heavy; never copies or publishes a payload.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, lstatSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const candidate = '/root/WORKTREES/cr-leader-resolution-history-security'
const capacity = '/root/WORKTREES/cr-leader-capacity-model-security'
const security = '/root/.local/state/codex-remote/releases/secure-api-80843c0-review-r6-dc9ee20'
const base = '790c064da950a46bfb6a6a862d606421f11f0627'
const git = (at, ...args) => execFileSync('git', ['-C', at, ...args], { encoding: 'utf8', maxBuffer: 24 * 1024 * 1024 }).trimEnd()
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
function files(at, prefix = '', output = {}) {
  for (const name of readdirSync(join(at, prefix)).sort()) {
    const path = join(prefix, name), stat = lstatSync(join(at, path))
    if (stat.isDirectory()) files(at, path, output)
    else { assert(stat.isFile(), 'nonregular artifact'); output[path] = hash(join(at, path)) }
  }
  return output
}
assert.equal(git(root, 'merge-base', base, 'HEAD'), base)
assert.equal(git(candidate, 'rev-parse', 'HEAD'), '100381eaabe7c54a55cc051a03f9a5499f6fe297')
assert.equal(git(capacity, 'rev-parse', 'HEAD'), 'd07206aeaefc591f7d4ae35a4b858883c154e53d')
assert.equal(git(candidate, 'status', '--porcelain'), '')
assert.equal(git(capacity, 'status', '--porcelain'), '')
const backend = files(join(root, 'dist-server'))
assert.equal(Object.keys(backend).length, 90)
const delta = before => Object.entries(backend).flatMap(([path, sha256]) => {
  const oldSha256 = hash(join(before, 'dist-server', path))
  return oldSha256 === sha256 ? [] : [{ path: 'dist-server/' + path, oldSha256, sha256 }]
})
const incremental = delta(candidate), sinceCapacity = delta(capacity)
const names = list => list.map(item => item.path.slice(12)).sort()
assert.deepEqual(names(incremental), ['orchestration.js', 'orchestration.js.map'])
assert.deepEqual(names(sinceCapacity), ['http-app.js', 'http-app.js.map', ...names(incremental)].sort())
const inventory = JSON.parse(readFileSync(join(security, 'inventory.json'), 'utf8'))
const combined = inventory.groups.backend.flatMap(item => {
  const sha256 = hash(join(root, item.path))
  return sha256 === item.sha256 ? [] : [{ path: item.path, oldSha256: item.sha256, sha256 }]
})
assert.deepEqual(names(combined), ['controller.js', 'controller.js.map', ...names(sinceCapacity)].sort())
for (const name of ['controller', 'http-app', 'orchestration']) {
  const source = readFileSync(join(root, 'server', name + '.ts'), 'utf8')
  const emitted = ts.transpileModule(source, { fileName: name + '.ts', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, esModuleInterop: true, sourceMap: true } })
  assert.equal(readFileSync(join(root, 'dist-server', name + '.js'), 'utf8'), emitted.outputText, name + ' source mismatch')
}
const hours = { js: backend['work-hours.js'], map: backend['work-hours.js.map'] }
assert.equal(hours.js, 'b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93')
assert.equal(hours.map, '6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8')
const hoursSources = Object.fromEntries(['server/work-hours.ts', 'working-hours/update.py', 'working-hours/dashboard.template.html'].map(path => {
  assert.equal(hash(join(root, path)), hash(join(candidate, path)), 'Hours source drift')
  return [path, hash(join(root, path))]
}))
for (const name of ['package.json', 'package-lock.json']) assert.equal(hash(join(root, name)), hash(join(security, 'dependencies', name)))
const client = files(join(root, 'dist')), html = readFileSync(join(root, 'dist/index.html'), 'utf8')
const entries = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(match => match[1].slice(1))
assert(entries.some(path => /index-.+\.js$/.test(path)))
const pending = [...entries], seen = new Set(), checkedSources = new Set()
while (pending.length) {
  const path = pending.pop()
  if (seen.has(path)) continue
  seen.add(path); assert(client[path], 'missing client graph file: ' + path)
  if (/\.(js|css)$/.test(path)) {
    const body = readFileSync(join(root, 'dist', path), 'utf8')
    for (const match of body.matchAll(/["'`]([./\w-]+\.(?:js|css))["'`]/g)) {
      const dependency = match[1].startsWith('/') ? match[1].slice(1) : match[1].startsWith('assets/') ? match[1] : join(dirname(path), match[1])
      if (client[dependency]) pending.push(dependency)
      else assert(!/-[\w-]{8}\.(js|css)$/.test(match[1]), 'missing hashed dependency: ' + dependency)
    }
    if (client[path + '.map']) {
      const map = JSON.parse(readFileSync(join(root, 'dist', path + '.map'), 'utf8'))
      for (let i = 0; i < map.sources.length; i++) {
        const local = resolve(root, 'dist', dirname(path), map.sources[i])
        if (local.startsWith(root + '/src/')) {
          assert.equal(readFileSync(local, 'utf8'), map.sourcesContent[i], local + ' map mismatch')
          checkedSources.add(local.slice(root.length + 1))
        }
      }
    }
  }
}
for (const name of ['src/ConversationTeam.tsx', 'src/teamTaskSelection.ts', 'src/App.tsx', 'src/api.ts']) assert(checkedSources.has(name), 'missing current map source: ' + name)
assert.equal(client['sw.js'], hash(join(root, 'public/sw.js')))
console.log(JSON.stringify({ head: git(root, 'rev-parse', 'HEAD'), dirty: git(root, 'status', '--porcelain'), base,
  backendCompared: Object.keys(backend).length, sealedSecurityCompared: inventory.groups.backend.length,
  incremental, sinceCapacity, combined, backend, clientEntries: entries, clientGraph: [...seen].sort(), checkedSources: [...checkedSources].sort(),
  completeClient: client, hours, hoursSources, unchangedDependencies: true, sourceEmissionMatch: true, noProductionWrites: true }, null, 2))
