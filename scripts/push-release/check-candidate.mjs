// Run ONLY inside codex-heavy. Builds this worktree, never production.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, openSync, closeSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hash, tree } from './core.mjs'

const worktree = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = resolve(process.argv[2] ?? '/tmp/push-answer-evidence')
const runtime = '/root/RUNNING-SERVICES/codex-remote-secure'
const previous = '/root/.local/state/codex-remote-secure/releases/push-browser-f27191c3'
const git = (...args) => execFileSync('git', ['-C', worktree, ...args], { encoding: 'utf8' }).trim()
assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'Commit source before checks')
const source = git('rev-parse', 'HEAD')
mkdirSync(output, { recursive: true, mode: 0o700 })
const logs = []
for (const [name, command, args] of [
  ['app-check', 'npm', ['run', 'check']],
  ['browser', process.execPath, ['scripts/contextual-push-browser.mjs']],
  ['runner', process.execPath, ['--test', 'scripts/push-release/core.node-test.mjs']],
  ['runner-syntax', process.execPath, ['--check', 'scripts/push-release/deploy.mjs']],
]) {
  const path = resolve(output, name + '.log'), fd = openSync(path, 'w', 0o600)
  try {
    execFileSync(command, args, { cwd: worktree, env: { ...process.env, TMPDIR: '/tmp', PUSH_SCREENSHOTS: output }, stdio: ['ignore', fd, fd] })
  } finally { closeSync(fd) }
  logs.push({ path, sha256: hash(path) })
}
assert.equal(git('rev-parse', 'HEAD'), source)
assert.equal(git('status', '--porcelain', '--untracked-files=no'), '')
const receipt = JSON.parse(readFileSync(previous + '/status.json', 'utf8'))
assert.equal(receipt.status, 'complete')
assert.equal(receipt.source, 'b67d1dc817658b36102c156694b2eeb98e1626e3')
const previousManifest = JSON.parse(readFileSync(previous + '/manifest.json', 'utf8'))
for (const [path, sha] of Object.entries(previousManifest.payload)) assert.equal(hash(runtime + '/' + path), sha, 'LIVE drift: ' + path)
const observedRuntimeBackend = tree(runtime + '/dist-server')
const backendDelta = Object.fromEntries(['controller', 'index', 'push'].flatMap(name => ['.js', '.js.map'].map(ext => {
  const path = name + ext
  return [path, { baseline: observedRuntimeBackend[path], candidate: hash(worktree + '/dist-server/' + path) }]
})))
const evidence = { source, liveSource: receipt.source, checks: { status: 'passed', logs }, candidateFrontend: tree(worktree + '/dist'), observedRuntimeBackend, backendDelta }
writeFileSync(output + '/candidate.json', JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 })
console.log(JSON.stringify({ evidence: output + '/candidate.json', source, status: 'checked-not-packaged', deployed: false }))
