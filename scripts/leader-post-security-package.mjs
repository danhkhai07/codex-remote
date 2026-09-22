// Preparation only: no publish, arm, restart, key or state mutation operation.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const digest = bytes => createHash('sha256').update(bytes).digest('hex')
export const hashFile = path => digest(readFileSync(path))
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const command = (bin, args, cwd) => execFileSync(bin, args, { cwd, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const sorted = value => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
const backend = ['controller.js', 'controller.js.map', 'http-app.js', 'http-app.js.map', 'orchestration.js', 'orchestration.js.map'].map(name => 'dist-server/' + name)
export function regular(path) {
  const absolute = resolve(path)
  for (let at = absolute; ; at = dirname(at)) {
    assert(!lstatSync(at).isSymbolicLink(), 'symlink path: ' + at)
    if (at === dirname(at)) break
  }
  const st = lstatSync(absolute)
  assert(st.isFile() && st.nlink === 1, 'nonregular or shared artifact: ' + path)
  return st
}
export function files(root, prefix = '', result = {}) {
  for (const name of readdirSync(join(root, prefix)).sort()) {
    const path = join(prefix, name), full = join(root, path), st = lstatSync(full)
    assert(!st.isSymbolicLink(), 'symlink in tree')
    if (st.isDirectory()) files(root, path, result)
    else { regular(full); result[path] = hashFile(full) }
  }
  return result
}
export function validateContract(c) {
  assert.equal(c.kind, 'EXPECTED-POST-SECURITY-CONTRACT')
  assert.equal(c.observedPostSecurity, false)
  assert.equal(c.armable, false)
  for (const key of ['targetSource', 'productSource', 'securitySource', 'securityApp']) assert(/^[a-f0-9]{40}$/.test(c[key]), 'invalid source identity')
  assert.deepEqual(Object.keys(c.payload).filter(p => p.startsWith('dist-server/')).sort(), backend)
  assert.equal(Object.keys(c.payload).filter(p => p.startsWith('dist/')).length, 25)
  assert.equal(Object.keys(c.payload).length, 31)
  for (const [path, sha] of Object.entries(c.payload)) {
    assert(/^(dist|dist-server)\/[\w./-]+$/.test(path) && !path.split('/').some(p => p === '..' || p === '.' || !p), 'unsafe payload path')
    assert(/^[a-f0-9]{64}$/.test(sha), 'invalid artifact hash')
  }
}
export function stage(contractPath, source, destination) {
  const bytes = readFileSync(contractPath), c = JSON.parse(bytes); validateContract(c)
  // Verify everything before creating the exclusive destination. Never overwrite a stage.
  const payload = Object.fromEntries(Object.entries(c.payload).map(([path, sha]) => {
    regular(join(source, path)); const data = readFileSync(join(source, path))
    assert.equal(digest(data), sha, 'source artifact drift: ' + path)
    return [path, data]
  }))
  assert.equal(realpathSync(dirname(destination)), resolve(dirname(destination)), 'symlink stage parent')
  mkdirSync(destination, { mode: 0o700 })
  for (const [path, data] of Object.entries(payload)) {
    mkdirSync(dirname(join(destination, 'payload', path)), { recursive: true, mode: 0o700 })
    writeFileSync(join(destination, 'payload', path), data, { flag: 'wx', mode: 0o600 })
  }
  writeFileSync(join(destination, 'contract.json'), bytes, { flag: 'wx', mode: 0o600 })
  writeFileSync(join(destination, 'prepared.json'), JSON.stringify({ status: 'prepared-not-armable', contractSha256: digest(bytes), source: c.targetSource,
    observedPostSecurity: false, actualBaseline: null, actualBackup: null, activationAuthorized: false, armable: false }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  return verify(destination, contractPath)
}
export function verify(destination, contractPath) {
  const c = json(contractPath); validateContract(c)
  assert.equal(hashFile(join(destination, 'contract.json')), hashFile(contractPath), 'contract drift')
  const prepared = json(join(destination, 'prepared.json'))
  assert.equal(prepared.status, 'prepared-not-armable')
  assert.equal(prepared.source, c.targetSource); assert.equal(prepared.observedPostSecurity, false)
  assert.equal(prepared.contractSha256, hashFile(contractPath))
  assert.equal(prepared.actualBaseline, null); assert.equal(prepared.actualBackup, null)
  assert.equal(prepared.activationAuthorized, false); assert.equal(prepared.armable, false)
  const tree = files(destination)
  const expected = { 'contract.json': hashFile(contractPath), 'prepared.json': hashFile(join(destination, 'prepared.json')),
    ...Object.fromEntries(Object.entries(c.payload).map(([p, h]) => ['payload/' + p, h])) }
  assert.deepEqual(sorted(tree), sorted(expected), 'unexpected/missing staged file')
  function privateTree(path) {
    const st = lstatSync(path)
    assert.equal(st.uid, process.getuid(), 'stage owner mismatch')
    assert.equal(st.mode & 0o777, st.isDirectory() ? 0o700 : 0o600, 'stage is not private')
    if (st.isDirectory()) for (const n of readdirSync(path)) privateTree(join(path, n))
  }
  privateTree(destination)
  return { status: 'prepared-not-armable', payloadFiles: 31, contractSha256: hashFile(contractPath), targetSource: c.targetSource }
}
export function validateObserved(c, facts) {
  assert.equal(facts.source, c.securitySource, 'security source is not live')
  assert.equal(facts.remote, c.securitySource, 'remote main differs')
  assert.equal(facts.branch, 'main'); assert.equal(facts.dirty, '')
  assert.equal(facts.securityAttempt.status, 'complete', 'security activation is incomplete')
  assert.equal(facts.securityAttempt.source, c.securitySource)
  assert.equal(facts.securityProof.source, c.securitySource)
  assert.equal(facts.securityProof.app, c.securityApp)
  assert.equal(facts.securityAttempt.publication?.path, c.securityPackage + '.activation/postverify.json', 'unbound security proof')
  assert.equal(facts.securityAttempt.publication?.sha256, facts.securityProofSha256, 'security proof hash mismatch')
  assert.equal(facts.secureRequired, true)
  assert(facts.pid > 0 && facts.pid !== c.retiredPreSecurityPid, 'no post-security PID')
  assert.deepEqual(sorted(facts.runtime), sorted(c.expectedRuntime), 'expected post-security artifact mismatch')
  assert.deepEqual(sorted(facts.backend), sorted(Object.fromEntries(Object.entries(c.expectedRuntime)
    .filter(([p]) => p.startsWith('dist-server/')).map(([p, h]) => [p.slice(12), h]))), 'unexpected backend file')
}
export function privateOutput(output, excluded) {
  const absolute = resolve(output), parent = dirname(absolute)
  assert.equal(realpathSync(parent), parent, 'symlink output parent')
  const st = lstatSync(parent)
  assert.equal(st.uid, process.getuid()); assert.equal(st.mode & 0o777, 0o700, 'observation parent is not private')
  for (const path of excluded.map(p => resolve(p))) assert(absolute !== path && !absolute.startsWith(path + '/'), 'output inside preserved directory')
}
export function observe(destination, contractPath, output) {
  verify(destination, contractPath)
  const c = json(contractPath), main = c.main
  const git = (...args) => command('git', ['-C', main, ...args])
  // Fail on old runtime BEFORE reading config, any activation record or writing output.
  const source = git('rev-parse', 'HEAD')
  assert.equal(source, c.securitySource, 'security source is not live; no baseline captured')
  privateOutput(output, [main, destination, c.securityPackage, c.securityPackage + '.activation'])
  const env = parseEnv(readFileSync(join(main, '.env'), 'utf8'))
  const runtime = Object.fromEntries(Object.keys(c.expectedRuntime).map(path => { const full = path.startsWith('/') ? path : join(main, path); regular(full); return [path, hashFile(full)] }))
  const facts = { source, branch: git('branch', '--show-current'), dirty: git('status', '--porcelain', '--untracked-files=all'),
    remote: git('ls-remote', 'origin', 'refs/heads/main').split(/\s+/)[0],
    securityAttempt: json(c.securityPackage + '.activation/attempt.json'), securityProof: json(c.securityPackage + '.activation/postverify.json'),
    securityProofSha256: hashFile(c.securityPackage + '.activation/postverify.json'), backend: files(join(main, 'dist-server')),
    secureRequired: env.CODEX_REMOTE_SECURE_API === 'required',
    pid: Number(command('systemctl', ['show', 'codex-remote.service', '--property=MainPID', '--value'])), runtime }
  validateObserved(c, facts)
  const baseline = { kind: 'ACTUAL-POST-SECURITY-OBSERVATION', at: new Date().toISOString(), contractSha256: hashFile(contractPath),
    source: facts.source, remote: facts.remote, pid: facts.pid, runtime, client: files(join(main, 'dist')), backend: facts.backend,
    remoteUrls: Object.fromEntries(['fetch', 'push'].map(kind => [kind, digest(git('remote', 'get-url', ...(kind === 'push' ? ['--push'] : []), 'origin'))])),
    configSha256: hashFile(join(main, '.env')), unitSha256: digest(command('systemctl', ['cat', 'codex-remote.service'])),
    processIdentity: command('systemctl', ['show', 'codex-remote.service', '-p', 'MainPID', '-p', 'InvocationID', '-p', 'ExecMainStartTimestampMonotonic', '-p', 'ActiveState']),
    processCwd: realpathSync('/proc/' + facts.pid + '/cwd'), commandSha256: hashFile('/proc/' + facts.pid + '/cmdline'),
    securityProofSha256: hashFile(c.securityPackage + '.activation/postverify.json'), securityAttemptSha256: hashFile(c.securityPackage + '.activation/attempt.json'),
    allIdleProven: false, backupTaken: false, armable: false }
  assert.equal(baseline.processCwd, main)
  assert(baseline.processIdentity.includes('ActiveState=active'))
  assert.equal(git('rev-parse', 'HEAD'), source); assert.equal(hashFile(join(main, '.env')), baseline.configSha256)
  assert.equal(command('systemctl', ['show', 'codex-remote.service', '-p', 'MainPID', '-p', 'InvocationID', '-p', 'ExecMainStartTimestampMonotonic', '-p', 'ActiveState']), baseline.processIdentity, 'process changed during observation')
  assert.deepEqual(files(join(main, 'dist-server')), baseline.backend)
  assert.deepEqual(files(join(main, 'dist')), baseline.client)
  writeFileSync(output, JSON.stringify(baseline, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  return { status: 'observed-not-armable', path: output, sha256: hashFile(output), source, pid: facts.pid }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [action, destination, argument] = process.argv.slice(2)
  const contract = join(repository, 'docs/releases/leader-post-security-source.json')
  try {
    assert.equal(process.getuid(), 0, 'root-private package required')
    assert(destination && ['stage', 'verify', 'observe'].includes(action), 'Use stage DEST SOURCE | verify DEST | observe DEST NEW_OUTPUT')
    const result = action === 'stage' ? stage(contract, argument, destination) : action === 'verify' ? verify(destination, contract) : observe(destination, contract, argument)
    console.log(JSON.stringify(result))
  } catch (error) { console.error(error.message); process.exitCode = 2 }
}
