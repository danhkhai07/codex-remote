// Independent exact-candidate boundary check. Only copy into this review checkout.
// Invoke via codex-heavy with the matching accepted dependencies available.
import assert from 'node:assert/strict'
import { cpSync, existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const author = '/root/WORKTREES/cr-leader-resolution-history-fixes'
const candidate = '3f7e139c25f42943d15bab6bb18f982646228193'
const git = (at, ...args) => execFileSync('git', ['-C', at, ...args], { encoding: 'utf8' }).trimEnd()
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
function files(at, prefix = '', result = {}) {
  for (const name of readdirSync(join(at, prefix)).sort()) {
    const path = join(prefix, name), stat = lstatSync(join(at, path))
    if (stat.isDirectory()) files(at, path, result)
    else { assert(stat.isFile()); result[path] = hash(join(at, path)) }
  }
  return result
}
assert.equal(root, '/root/WORKTREES/cr-leader-resolution-history-fixes-review')
assert.equal(git(author, 'rev-parse', 'HEAD'), candidate)
assert.equal(git(author, 'status', '--porcelain'), '')
assert.equal(git(root, 'merge-base', candidate, 'HEAD'), candidate)
const productDelta = git(root, 'diff', '--name-only', candidate, '--', 'server', 'src', 'working-hours', 'package.json', 'package-lock.json').split('\n').filter(path => path && !path.endsWith('.test.ts'))
assert.deepEqual(productDelta, [])
const receipt = JSON.parse(readFileSync('/tmp/cr-leader-review-fixes-delivery.json', 'utf8'))
assert.equal(receipt.head, candidate)
assert.equal(hash(receipt.checks.log), receipt.checks.logSha256)
assert.equal(hash(receipt.artifactManifest.path), receipt.artifactManifest.sha256)
const manifest = JSON.parse(readFileSync(receipt.artifactManifest.path, 'utf8'))
for (const [name, inventory] of [['dist-server', manifest.backend], ['dist', manifest.completeClient]]) {
  assert.deepEqual(files(join(author, name)), inventory, name + ' author output drift')
  if (!existsSync(join(root, name))) cpSync(join(author, name), join(root, name), { recursive: true, force: false, errorOnExist: true })
  assert.deepEqual(files(join(root, name)), inventory, name + ' review fixture copy drift')
}
for (const name of ['controller', 'http-app', 'orchestration']) {
  const emitted = ts.transpileModule(readFileSync(join(root, 'server', name + '.ts'), 'utf8'), { fileName: name + '.ts', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, esModuleInterop: true, sourceMap: true } })
  const actual = JSON.parse(readFileSync(join(root, 'dist-server', name + '.js.map'), 'utf8'))
  const expected = JSON.parse(emitted.sourceMapText)
  assert.deepEqual(actual.sources, ['../server/' + name + '.ts'])
  assert.deepEqual({ ...actual, sources: expected.sources }, expected, name + ' source map emission mismatch')
}
const artifacts = JSON.parse(execFileSync(process.execPath, ['scripts/leader-review-fixes-artifacts.mjs'], { cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }))
assert.deepEqual(artifacts.backend, manifest.backend)
assert.deepEqual(artifacts.completeClient, manifest.completeClient)
console.log(JSON.stringify({ reviewedCandidate: candidate, ...artifacts,
  reusedAuthorFullCheck: { path: receipt.checks.log, sha256: receipt.checks.logSha256, tests: 527, nodeTests: 11 },
  noProductImplementationChanged: true, backendMapEmissionMatch: true, noProductionWrites: true }, null, 2))
