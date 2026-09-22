// Copy reviewed, immutable application bytes into a NEW directory. No live writes,
// process start, owner key, native state, or production credentials are included.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { renderNginx, HOST, PORT } from './nginx.mjs'
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SOURCE = '10f52e9410dd593e9182483701f043b43338ccf1'
const SECURITY = '/root/.local/state/codex-remote/releases/secure-api-80843c0-activation-0830369e'
const LEADER = '/root/.local/state/codex-remote/releases/leader-post-security-10f52e9-eaed96a1'
const MAIN = '/root/RUNNING-SERVICES/codex-remote'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const fileHash = file => hash(fs.readFileSync(file))
export function safeLocal(root, name) {
  assert(name && !path.isAbsolute(name) && !name.split('/').includes('..'), 'unsafe package path')
  return path.join(root, name)
}
export function copyVerified(from, to, sha256) {
  const st = fs.lstatSync(from)
  assert(st.isFile() && !st.isSymbolicLink(), 'nonregular source')
  assert.equal(fileHash(from), sha256, 'source hash drift: ' + from)
  fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 })
  fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL)
  fs.chmodSync(to, st.mode & 0o777)
  assert.equal(fileHash(to), sha256, 'copy mismatch')
  const copied = fs.statSync(to)
  assert.equal(copied.nlink, 1, 'shared inode')
  assert(!(st.dev === copied.dev && st.ino === copied.ino), 'hardlink')
  assert.equal(fileHash(from), sha256, 'source changed while copying')
}
function inventory(root, prefix = '', out = {}) {
  for (const name of fs.readdirSync(path.join(root, prefix)).sort()) {
    const local = path.join(prefix, name), file = path.join(root, local), st = fs.lstatSync(file)
    if (st.isSymbolicLink()) out[local] = { link: fs.readlinkSync(file) }
    else if (st.isDirectory()) inventory(root, local, out)
    else { assert(st.isFile()); out[local] = { size: st.size, mode: st.mode & 0o777, sha256: fileHash(file) } }
  }
  return out
}
export function prepare(output) {
  assert(path.isAbsolute(output), 'absolute output required')
  assert(!fs.existsSync(output), 'new output required')
  assert.equal(fileHash(path.join(LEADER, 'contract.json')), '78e89b842be6aebf335465d39143d9563fd078ad1989e2b68ee67e8ba0e5b6fd')
  const contract = json(path.join(LEADER, 'contract.json'))
  assert.equal(contract.targetSource, SOURCE)
  assert.equal(fileHash('/root/.local/state/codex-remote/security-activation-preparation-0830369e/package-tree.json'), '5d5629bc6fd150622bd9cea69537051e028275c0819659d2117ff21565a139aa')
  const sealed = json('/root/.local/state/codex-remote/security-activation-preparation-0830369e/package-tree.json')
  const sourceHash = execFileSync('git', ['rev-parse', SOURCE], { cwd: repo, encoding: 'utf8' }).trim()
  assert.equal(sourceHash, SOURCE)
  fs.mkdirSync(output, { mode: 0o700 })
  const app = path.join(output, 'app'); fs.mkdirSync(app, { mode: 0o700 })
  const archive = path.join(output, 'accepted-source.tar'), fd = fs.openSync(archive, 'wx', 0o600)
  try { execFileSync('git', ['archive', SOURCE], { cwd: repo, stdio: ['ignore', fd, 'pipe'] }) } finally { fs.closeSync(fd) }
  execFileSync('tar', ['--extract', '--file', archive, '--directory', app, '--no-same-owner'])
  fs.unlinkSync(archive)
  const copied = {}, provenance = {}
  const backend = Object.fromEntries(Object.entries(contract.expectedRuntime).filter(([name]) => name.startsWith('dist-server/')))
  for (const [name, expected] of Object.entries(backend)) {
    const overlay = contract.payload[name]
    const from = overlay ? path.join(LEADER, 'payload', name) : fs.existsSync(path.join(SECURITY, 'payload', name)) ? path.join(SECURITY, 'payload', name) : path.join(MAIN, name)
    const sha = overlay ?? expected
    copyVerified(from, safeLocal(app, name), sha); copied[name] = sha; provenance[name] = from
  }
  assert.equal(Object.keys(backend).length, 90)
  for (const [name, sha] of Object.entries(contract.payload).filter(([name]) => name.startsWith('dist/'))) {
    const from = path.join(LEADER, 'payload', name)
    copyVerified(from, safeLocal(app, name), sha); copied[name] = sha; provenance[name] = from
  }
  assert.equal(Object.keys(copied).filter(name => name.startsWith('dist/')).length, 25)
  for (const name of ['package.json', 'package-lock.json']) assert.equal(fileHash(path.join(app, name)), contract.expectedRuntime[name], name)
  const depRoot = path.join(output, 'dependencies/node_modules')
  fs.mkdirSync(depRoot, { recursive: true, mode: 0o700 })
  const entries = Object.entries(sealed).filter(([name]) => name.startsWith('dependencies/node_modules/'))
  for (const [name, value] of entries) {
    const to = safeLocal(output, name), from = safeLocal(SECURITY, name)
    if (value.directory) fs.mkdirSync(to, { recursive: true, mode: value.mode })
    else if (value.link) {
      assert.equal(fs.readlinkSync(from), value.link, 'dependency link drift')
      const resolved = path.resolve(path.dirname(to), value.link)
      assert(resolved.startsWith(depRoot + '/'), 'escaping dependency link')
      fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 }); fs.symlinkSync(value.link, to)
    } else copyVerified(from, to, value.sha256)
  }
  fs.symlinkSync('../dependencies/node_modules', path.join(app, 'node_modules'))
  for (const [name, version] of [['jose', '6.2.12'], ['vitest', '4.1.11']]) assert.equal(json(path.join(depRoot, name, 'package.json')).version, version)
  assert.equal(copied['dist-server/work-hours.js'], 'b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93')
  assert.equal(copied['dist-server/work-hours.js.map'], '6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8')
  assert.equal(copied['dist/sw.js'], fileHash(path.join(app, 'public/sw.js')))
  let mapped = 0
  for (const local of Object.keys(copied).filter(name => name.endsWith('.map'))) {
    const map = json(path.join(app, local))
    for (let i = 0; i < map.sources.length; i++) {
      if (!map.sourcesContent?.[i]) continue
      const file = path.resolve(path.dirname(path.join(app, local)), map.sources[i])
      if (file.startsWith(path.join(app, 'src') + '/')) { assert.equal(fs.readFileSync(file, 'utf8'), map.sourcesContent[i], 'transformed application source'); mapped++ }
    }
  }
  const infra = path.join(output, 'infra'); fs.mkdirSync(infra, { mode: 0o700 })
  for (const mode of ['bootstrap', 'parked', 'active']) fs.writeFileSync(path.join(infra, 'remote-' + mode + '.conf'), renderNginx(mode), { flag: 'wx', mode: 0o600 })
  const manifest = { kind: 'new-instance-prepared-not-activated', at: new Date().toISOString(), task: '79b51874-b784-4171-85d1-30d8ff21f35f', source: SOURCE, securityApp: '80843c0947c5e665a51a6207dbb871bf2c06a421', leaderProduct: 'b8c781a886017746c0b588ff3290d8df914477d6', host: HOST, port: PORT, backendFiles: 90, clientFiles: 25, mappedClientSources: mapped, copied, provenance, dependencyEntries: entries.length, noHardlinks: true, noProductionStateOrKeys: true, activationReady: false, missing: ['independently accepted legacy Files/key boundary', 'isolated native/Vault/state ownership verified', 'new-instance activation/postverify'], files: inventory(output) }
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  return { output, sha256: fileHash(path.join(output, 'manifest.json')), backendFiles: 90, clientFiles: 25, mappedClientSources: mapped, dependencyEntries: entries.length, activationReady: false }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077)
  console.log(JSON.stringify(prepare(path.resolve(process.argv[2] ?? '')), null, 2))
}
