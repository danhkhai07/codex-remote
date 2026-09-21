// Owned child fixture only; parent may SIGKILL this process while awaiting bookkeeping.
import { join } from 'node:path'
import { execute } from './runner.mjs'
import { Publication } from './publication.mjs'
import { atomicBytes, json, fileHash } from './common.mjs'
const [root, mode] = process.argv.slice(2)
if (mode === 'read') {
  const proof = json(join(root, 'postverify.json')), marker = json(join(root, 'attempt.json'))
  console.log(JSON.stringify({ proof, marker, services: json(join(root, 'services.json')), vault: json(join(root, 'vault.json')), proofHash: fileHash(join(root, 'postverify.json')) }))
} else {
  const publication = new Publication(root, { app: 'fake-app', seal: 'fake-seal', modules: { 'http-app.js': 'fake-module-hash' } })
  const ops = { modules: [], now: () => 0, sleep: async () => {},
    state: async value => atomicBytes(join(root, 'attempt.json'), JSON.stringify({ ...value, ...publication.references() }), 0o600),
    oldReadiness: async () => ({ ready: true, busy: 0, pending: 0, incomplete: false }),
    verify: async () => ({ freshPid: 4242, verifiedAt: '2026-09-21T12:00:00Z', hashes: { index: 'fake-index-sha' } }),
    persistProof: async evidence => publication.persist(evidence),
    onTerminate: save => { const handler = async () => { await save(); process.exit(143) }; process.once('SIGTERM', handler); return () => process.removeListener('SIGTERM', handler) },
    bookkeeping: async () => {
      publication.status('services', 'dispatching-outcome-unknown')
      if (mode === 'failure') throw Error('fixture-network-unknown')
      if (mode === 'success') { publication.status('services', 'confirmed'); publication.status('vault', 'confirmed'); return }
      process.send({ waiting: true }); await new Promise(() => { setInterval(() => {}, 1000) })
    },
  }
  for (const name of ['acquire', 'release', 'preflight', 'drift', 'validateReadiness', 'sourceTransition', 'backup', 'gateIngress', 'preCopy', 'assets', 'assertInstalled', 'activateDependenciesConfig', 'oldWatcherRestart', 'newBackend', 'workboard', 'index', 'openIngress']) ops[name] = async () => {}
  await execute(ops).catch(() => { process.exitCode = 1 })
}
