import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, symlinkSync, linkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { digest, stage, verify, observe, validateContract, validateObserved, privateOutput } from './leader-post-security-package.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'leader-package-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'source'), destination = join(root, 'stage'), contract = join(root, 'contract.json')
  const payload = Object.fromEntries([
    ...['controller', 'http-app', 'orchestration'].flatMap(n => ['dist-server/' + n + '.js', 'dist-server/' + n + '.js.map']),
    'dist/index.html', ...Array.from({ length: 24 }, (_, i) => `dist/assets/item-${i}.js`),
  ].map(p => [p, digest(p)]))
  const c = { kind: 'EXPECTED-POST-SECURITY-CONTRACT', observedPostSecurity: false, armable: false,
    targetSource: 'a'.repeat(40), productSource: 'b'.repeat(40), securitySource: 'c'.repeat(40), securityApp: 'd'.repeat(40),
    securityPackage: join(root, 'security'), main: source, retiredPreSecurityPid: 12, payload,
    expectedRuntime: { 'dist-server/controller.js': digest('security'), 'dist/index.html': digest('security-html') } }
  for (const p of Object.keys(payload)) { mkdirSync(dirname(join(source, p)), { recursive: true }); writeFileSync(join(source, p), p) }
  const save = () => writeFileSync(contract, JSON.stringify(c) + '\n')
  save()
  return { root, source, destination, contract, c, save, stage: () => stage(contract, source, destination) }
}
function facts(c) {
  return { source: c.securitySource, remote: c.securitySource, branch: 'main', dirty: '', pid: 13, secureRequired: true,
    securityAttempt: { status: 'complete', source: c.securitySource, publication: { path: c.securityPackage + '.activation/postverify.json', sha256: digest('proof') } },
    securityProof: { source: c.securitySource, app: c.securityApp }, securityProofSha256: digest('proof'),
    backend: { 'controller.js': digest('security') }, runtime: structuredClone(c.expectedRuntime) }
}
test('exact 31 accepted bytes stage privately; verify is read-only and never arms', t => {
  const f = fixture(t), result = f.stage()
  assert.equal(result.payloadFiles, 31)
  const before = readFileSync(join(f.destination, 'prepared.json'))
  assert.equal(verify(f.destination, f.contract).status, 'prepared-not-armable')
  assert.deepEqual(readFileSync(join(f.destination, 'prepared.json')), before)
  assert.equal(JSON.parse(before).actualBackup, null)
  assert.throws(f.stage, /EEXIST/)
})
test('source drift rejects before any stage is created', t => {
  const f = fixture(t); writeFileSync(join(f.source, 'dist/index.html'), 'wrong')
  assert.throws(f.stage, /source artifact drift/); assert.equal(existsSync(f.destination), false)
})
for (const kind of ['extra', 'hash', 'permission', 'symlink', 'hardlink', 'armed', 'source']) test('verify rejects ' + kind + ' drift', t => {
  const f = fixture(t); f.stage(); const p = join(f.destination, 'payload/dist/index.html')
  if (kind === 'extra') writeFileSync(join(f.destination, 'unexpected'), '', { mode: 0o600 })
  if (kind === 'hash') writeFileSync(p, 'wrong')
  if (kind === 'permission') chmodSync(p, 0o644)
  if (kind === 'symlink') { rmSync(p); symlinkSync(join(f.source, 'dist/index.html'), p) }
  if (kind === 'hardlink') linkSync(p, join(f.root, 'linked'))
  if (kind === 'armed' || kind === 'source') {
    const path = join(f.destination, 'prepared.json'), data = JSON.parse(readFileSync(path))
    if (kind === 'armed') data.armable = true
    else data.source = 'wrong'
    writeFileSync(path, JSON.stringify(data))
  }
  assert.throws(() => verify(f.destination, f.contract))
})
test('allowlist rejects traversal and a seventh backend even at the same total count', t => {
  const { c } = fixture(t)
  delete c.payload['dist/assets/item-0.js']; c.payload['dist/../state.json'] = digest('state')
  assert.throws(() => validateContract(c), /unsafe payload path/)
  delete c.payload['dist/../state.json']; c.payload['dist-server/secure-key.js'] = digest('excluded')
  assert.throws(() => validateContract(c))
})
test('valid observation requires complete bound security evidence but cannot arm or back up', t => {
  const { c } = fixture(t); const f = facts(c)
  assert.equal(validateObserved(c, f), undefined)
  assert.equal(c.armable, false); assert.equal(c.observedPostSecurity, false)
})
for (const kind of ['old-source', 'remote', 'dirty', 'branch', 'incomplete', 'proof-hash', 'proof-path', 'proof-app', 'encryption', 'old-pid', 'runtime', 'extra-backend']) test('post-security contract rejects ' + kind, t => {
  const { c } = fixture(t), f = facts(c)
  if (kind === 'old-source') f.source = 'e'.repeat(40)
  if (kind === 'remote') f.remote = 'e'.repeat(40)
  if (kind === 'dirty') f.dirty = 'M source'
  if (kind === 'branch') f.branch = 'candidate'
  if (kind === 'incomplete') f.securityAttempt.status = 'running'
  if (kind === 'proof-hash') f.securityAttempt.publication.sha256 = digest('different')
  if (kind === 'proof-path') f.securityAttempt.publication.path = '/some-other-proof'
  if (kind === 'proof-app') f.securityProof.app = 'wrong'
  if (kind === 'encryption') f.secureRequired = false
  if (kind === 'old-pid') f.pid = c.retiredPreSecurityPid
  if (kind === 'runtime') f.runtime['dist/index.html'] = digest('wrong')
  if (kind === 'extra-backend') f.backend['unexpected.js'] = digest('wrong')
  assert.throws(() => validateObserved(c, f))
})
test('actual observe on wrong Git source fails before missing .env/proof and creates no observation', t => {
  const f = fixture(t); f.stage()
  const git = args => execFileSync('git', ['-C', f.source, ...args], { stdio: 'pipe' })
  git(['init', '--initial-branch=main']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@invalid', 'commit', '--allow-empty', '-m', 'fixture'])
  const output = join(f.root, 'actual.json')
  assert.throws(() => observe(f.destination, f.contract, output), /security source is not live; no baseline captured/)
  assert.equal(existsSync(output), false)
})
test('observations cannot write to payload, production or public/symlink directories', t => {
  const f = fixture(t); f.stage()
  assert.throws(() => privateOutput(join(f.destination, 'actual.json'), [f.destination]), /preserved directory/)
  assert.throws(() => privateOutput(join(f.source, 'actual.json'), [f.source]))
  const linked = join(f.root, 'linked'); symlinkSync(f.root, linked)
  assert.throws(() => privateOutput(join(linked, 'actual.json'), []), /symlink/)
  assert.doesNotThrow(() => privateOutput(join(f.root, 'actual.json'), [f.source, f.destination]))
})
test('CLI has no arm, apply or restart path', t => {
  const f = fixture(t)
  for (const action of ['arm', 'apply', 'restart']) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./leader-post-security-package.mjs', import.meta.url)), action, f.destination], { encoding: 'utf8' })
    assert.equal(result.status, 2); assert.equal(existsSync(f.destination), false)
  }
})
test('runbook backend old/new hashes match the exact contract', () => {
  const c = JSON.parse(readFileSync(new URL('../docs/releases/leader-post-security-source.json', import.meta.url)))
  const text = readFileSync(new URL('../docs/releases/leader-post-security-runbook.md', import.meta.url), 'utf8')
  for (const [path, sha] of Object.entries(c.payload).filter(([p]) => p.startsWith('dist-server/'))) {
    assert(text.includes(`| ${path.slice(12)} | \`${c.expectedRuntime[path]}\` → \`${sha}\` |`), path)
  }
})
test('future operator JS snippets parse together without executing any commands', () => {
  const text = readFileSync(new URL('../docs/releases/leader-post-security-runbook.md', import.meta.url), 'utf8')
  const body = [...text.matchAll(/```js\n([\s\S]*?)```/g)].map(match => match[1]).join('\n')
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  assert(body.includes('lock.acquire()') && body.includes("publish('dist/index.html')"))
  assert.doesNotThrow(() => new AsyncFunction(body)) // Compile only; never call it.
})
