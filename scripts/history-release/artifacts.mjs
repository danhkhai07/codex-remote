// codex-heavy only. Snapshot a built candidate; never build/copy into runtime.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { hash, tree } from './core.mjs'
import { BACKEND, assertDelta, PRESERVED_BUILD_DIFFERENCES } from './plan.mjs'
const runtime = '/root/RUNNING-SERVICES/codex-remote-secure', worktree = process.cwd()
const output = resolve(process.argv[2]), logPaths = process.argv.slice(3)
assert(logPaths.length >= 3, 'Require full-check, native and browser logs')
const git = (...args) => execFileSync('git', ['-C', worktree, ...args], { encoding: 'utf8' }).trim()
assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'Commit reviewed source first')
const previous = '/root/.local/state/codex-remote-secure/releases/push-browser-answer-378b37ef'
const receipt = JSON.parse(readFileSync(previous + '/status.json', 'utf8'))
assert.equal(receipt.status, 'complete'); assert.equal(receipt.source, '6f6fe30a08f3e763d74eed440824ffa84f831aa9')
assert.equal(git('diff', receipt.source, '--', 'server/secure-client.ts', 'server/event-hub.ts'), '', 'Preserved historical modules changed in source')
const previousManifest = JSON.parse(readFileSync(previous + '/manifest.json', 'utf8'))
for (const [p, h] of Object.entries(previousManifest.payload)) assert.equal(hash(join(runtime, p)), h, 'LIVE drift ' + p)
const baseline = tree(runtime + '/dist-server'), candidate = tree(worktree + '/dist-server')
assertDelta(baseline, candidate)
const backendDelta = Object.fromEntries(BACKEND.map(p => [p.slice(12), { baseline: baseline[p.slice(12)] ?? null, candidate: candidate[p.slice(12)] }]))
for (const folder of ['server', 'src', 'public']) assert.equal(git('diff', 'HEAD', '--', folder), '')
const productSource = Object.fromEntries(git('ls-files', 'server', 'src', 'public', 'package.json', 'package-lock.json', 'vite.config.ts', 'index.html').split('\n').filter(Boolean).map(p => [p, hash(join(worktree,p))]))
const evidence = { source: git('rev-parse', 'HEAD'), liveSource: receipt.source, checks: { status: 'passed', logs: logPaths.map(path => ({ path: resolve(path), sha256: hash(path) })) },
 candidateFrontend: tree(worktree + '/dist'), observedRuntimeBackend: baseline, backendDelta, productSource,
 rawBuildDifferences: Object.keys(candidate).filter(p => baseline[p] !== candidate[p]),
 changedBackend: BACKEND.map(p => p.slice(12)), preservedBuildDifferences: PRESERVED_BUILD_DIFFERENCES, excludedBackendWillRemainUnchanged: true,
 runtimeMutation: false, armed: false }
mkdirSync(output, { recursive: true, mode: 0o700 })
writeFileSync(output + '/candidate.json', JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
console.log(JSON.stringify({ source: evidence.source, evidence: output + '/candidate.json', changedBackend: evidence.changedBackend, clientFiles: Object.keys(evidence.candidateFrontend).length, armed: false }))
