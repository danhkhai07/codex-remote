import { readFileSync, readdirSync, existsSync, openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'
import { connect } from 'node:net'
import { APP, SOURCE, MAIN, assert, json, fileHash, hash, record, tree, same, command, atomicBytes, inside } from './common.mjs'
import { Destinations } from './destinations.mjs'
import { provisionPlan, ownerIdentity, processStart } from './key-state.mjs'

export const parseProperties = text => Object.fromEntries(text.split('\n').filter(Boolean).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)] }))
export const servicePolicy = value => Object.fromEntries(['Type', 'KillMode', 'SendSIGKILL', 'TriggeredBy'].map(key => [key, value[key]]))
export function assertServicePolicy(value) {
  assert(value.Type === 'simple' && value.KillMode === 'control-group' && value.SendSIGKILL === 'yes' && value.TriggeredBy === '', 'unproven-service-stop-policy')
}
export function cgroupEmpty(path) {
  try {
    if (readFileSync(join(path, 'cgroup.procs'), 'utf8').trim()) return false
    return readdirSync(path, { withFileTypes: true }).filter(entry => entry.isDirectory()).every(entry => cgroupEmpty(join(path, entry.name)))
  } catch (error) { if (error.code === 'ENOENT' && !existsSync(path)) return true; throw error }
}
export const listenerClosed = (host, port) => new Promise((resolve, reject) => {
  const socket = connect({ host, port }); socket.setTimeout(1500)
  socket.once('connect', () => { socket.destroy(); resolve(false) })
  socket.once('timeout', () => { socket.destroy(); reject(Error('listener-proof-timeout')) })
  socket.once('error', error => { socket.destroy(); if (error.code === 'ECONNREFUSED') resolve(true); else reject(Error('listener-proof-failed')) })
})
export function receiptBinding(outside, evidence) {
  return { evidence: record(join(outside, 'evidence.json')), authority: record(join(outside, 'authorization.json')),
    files: Object.fromEntries(Object.values(evidence).flatMap(value => (value?.files ?? []).map(item => { const path = inside(outside, item.path); return [path, record(path)] }))) }
}

// Optional I/O injection is for owned process fixtures; the executable adapter has
// no override flags/env and always uses the fixed production service/paths below.
export async function cutoverOps(release, fixtureIO) {
  const meta = json(join(release, 'metadata.json')), outside = release + '.activation', permit = json(join(outside, 'key-cutover-permit.json'))
  assert(meta.app === APP && meta.sourceTarget === SOURCE && meta.requiredEncryption && meta.activationEligible && (fixtureIO || meta.main === MAIN), 'cutover-release-contract')
  const seal = fileHash(join(release, 'seal.json'))
  assert(permit.release === release && permit.app === APP && permit.seal === seal, 'cutover-permit-mismatch')
  const { readOwnerKey, assertKeyLocation } = await import(pathToFileURL(join(release, 'operator/dist-server/secure-key.js')).href)
  const { loadConfig } = await import(pathToFileURL(join(release, 'operator/dist-server/config.js')).href)
  const io = fixtureIO ?? {
    properties: () => parseProperties(command('/usr/bin/systemctl', ['show', 'codex-remote.service', '-p', 'Type', '-p', 'KillMode', '-p', 'SendSIGKILL', '-p', 'TriggeredBy', '-p', 'ActiveState', '-p', 'SubState', '-p', 'MainPID', '-p', 'ControlPID', '-p', 'ControlGroup'])),
    control: action => command('/usr/bin/systemctl', [action, 'codex-remote.service']), processStart,
    cgroupEmpty: () => cgroupEmpty('/sys/fs/cgroup' + permit.old.cgroup), listenerClosed,
    source: () => {
      assert(command('git', ['symbolic-ref', '--short', 'HEAD']) === 'main' && command('git', ['rev-parse', 'HEAD']) === SOURCE && command('git', ['status', '--porcelain', '--untracked-files=all']) === '', 'cutover-source-drift')
      for (const kind of ['fetch', 'push']) assert(hash(command('git', ['remote', 'get-url', ...(kind === 'push' ? ['--push'] : []), 'origin'])) === permit.remote[kind], 'cutover-remote-url-drift')
      assert(command('git', ['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0] === SOURCE, 'cutover-remote-drift')
    },
  }
  const destinations = new Destinations(permit.destinations.entries, permit.destinations.parents)
  let config, binding, generated
  const createdPath = join(outside, 'key-created.json')
  function generatedKey() {
    assert(generated, 'generated-key-identity-missing')
    same(json(createdPath), generated.receipt, 'generated-key-receipt-drift')
    assert(fileHash(createdPath) === generated.sha256, 'generated-key-receipt-drift')
    same(ownerIdentity(meta, readOwnerKey), generated.receipt.key, 'generated-owner-key-drift')
    return generated.receipt.key
  }
  function authority() {
    assert(processStart(permit.runner.pid) === permit.runner.start, 'cutover-runner-not-alive')
    same(json(permit.lock + '/owner.json'), { release, pid: permit.runner.pid }, 'cutover-lock-owner-drift')
    const marker = json(join(outside, 'attempt.json'))
    assert(marker.status === 'running' && marker.phase === 'old-watcher-restart', 'cutover-parent-phase-invalid')
    same(receiptBinding(outside, json(join(outside, 'evidence.json'))), permit.receipts, 'cutover-bound-receipts-drift')
    const authority = json(join(outside, 'authorization.json')), now = Date.now()
    assert(Number.isFinite(Date.parse(authority.at)) && now >= Date.parse(authority.at) && now - Date.parse(authority.at) < 60 * 60_000, 'cutover-readiness-expired')
    for (const value of Object.values(json(join(outside, 'evidence.json')))) assert(Number.isFinite(Date.parse(value.at)) && now >= Date.parse(value.at) && now - Date.parse(value.at) <= 24 * 60 * 60_000, 'cutover-evidence-expired')
  }
  function installed() {
    const actual = tree(release); delete actual['seal.json']; same(actual, json(join(release, 'seal.json')).files, 'cutover-seal-drift')
    destinations.all(); same(tree(join(meta.main, 'dist-server')), permit.backend, 'cutover-installed-app-drift')
    same(tree(join(meta.main, 'node_modules')), permit.dependencies, 'cutover-dependencies-drift')
    for (const [path, value] of Object.entries(permit.stable)) same(record(path), value, 'cutover-config-drift')
    const properties = io.properties(); assertServicePolicy(properties); same(servicePolicy(properties), permit.servicePolicy, 'cutover-unit-policy-drift')
    if (!fixtureIO) for (const [unit, digest] of Object.entries(permit.unitHashes)) assert(hash(command('/usr/bin/systemctl', ['cat', unit])) === digest, 'cutover-effective-unit-drift')
    io.source()
    config = loadConfig({ ...parseEnv(readFileSync(join(meta.main, '.env'), 'utf8')), NODE_ENV: 'production' })
    assert(config.secureApiRequired && config.secureKeyFile === meta.keyFile && config.host === '127.0.0.1' && config.port === permit.port, 'cutover-required-config-drift')
    same(config.fileRoots, meta.fileRoots, 'cutover-file-roots-drift')
    authority() // Last potentially slow checks finished; do not extend the execution lifetime.
  }
  function stoppedNow() {
    const properties = io.properties(); assertServicePolicy(properties)
    assert(properties.ActiveState === 'inactive' && properties.SubState === 'dead' && properties.MainPID === '0' && properties.ControlPID === '0', 'old-service-not-stopped')
    assert(io.processStart(permit.old.pid) !== permit.old.start && io.cgroupEmpty(), 'old-process-or-cgroup-survives')
    authority()
  }
  async function isolated() {
    stoppedNow()
    assert(await io.listenerClosed('127.0.0.1', permit.port), 'old-listener-survives')
    stoppedNow() // Recheck after the socket await, before the next effect.
  }
  return {
    claim: async () => { const fd = openSync(join(outside, 'key-cutover-claimed.json'), 'wx', 0o600); try { writeFileSync(fd, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, seal }) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }; const parent = openSync(outside, 'r'); try { fsyncSync(parent) } finally { closeSync(parent) } },
    state: async value => atomicBytes(join(outside, 'key-cutover-state.json'), JSON.stringify({ ...value, release, seal, old: permit.old, at: new Date().toISOString() }) + '\n', 0o600),
    preStop: async () => { installed(); same(provisionPlan(meta, assertKeyLocation), permit.provision, 'cutover-provision-drift'); assert(record(createdPath).absent && record(join(outside, 'key-binding.json')).absent, 'previous-key-binding'); assert(io.processStart(permit.old.pid) === permit.old.start && io.properties().MainPID === String(permit.old.pid), 'old-process-changed-before-stop') },
    stop: async () => { authority(); await io.control('stop') },
    isolated,
    preProvision: async () => { installed(); same(provisionPlan(meta, assertKeyLocation), permit.provision, 'cutover-provision-drift'); await isolated() },
    init: async () => {
      await isolated(); installed(); same(provisionPlan(meta, assertKeyLocation), permit.provision, 'cutover-provision-drift'); stoppedNow()
      command(process.execPath, [join(release, 'runner/key-init.mjs'), release], meta.main, { PATH: process.env.PATH, NODE_ENV: 'production' })
      // Capture the creator's known-value receipt synchronously before any later
      // phase/socket await. Interrupted creation is never adopted on retry.
      const receipt = json(createdPath)
      assert(receipt.version === 1 && receipt.release === release && receipt.seal === seal && receipt.app === APP && receipt.keyFile === meta.keyFile, 'generated-key-receipt-invalid')
      same(receipt.old, permit.old, 'generated-key-old-boundary-drift')
      generated = { receipt, sha256: fileHash(createdPath) }
      generatedKey()
    },
    bind: async () => {
      await isolated(); const key = generatedKey()
      binding = { release, seal, app: APP, oldGone: true, old: permit.old, at: new Date().toISOString(), created: { path: createdPath, sha256: generated.sha256 }, key }
      assert(record(join(outside, 'key-binding.json')).absent, 'key-binding-already-exists')
      atomicBytes(join(outside, 'key-binding.json'), JSON.stringify(binding) + '\n', 0o600)
      return { path: join(outside, 'key-binding.json'), sha256: fileHash(join(outside, 'key-binding.json')) }
    },
    beforeStart: async () => { installed(); same(generatedKey(), binding.key, 'bound-owner-key-drift'); await isolated() },
    start: async () => { await isolated(); installed(); same(generatedKey(), binding.key, 'bound-owner-key-drift'); stoppedNow(); await io.control('start') },
  }
}
