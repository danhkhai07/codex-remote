// One bounded read-only observation. No wait/restart/turn exemption, no native full read.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { parseEnv } from 'node:util'
const release = resolve(process.argv[2] || '')
assert(process.argv[2], 'Supply the staged review package')
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex')
const json = p => JSON.parse(readFileSync(p, 'utf8'))
const seal = json(release + '/review-seal.json'), manifest = json(release + '/manifest.json')
assert.equal(hash(release + '/manifest.json'), seal.manifest); assert.equal(hash(release + '/baseline.json'), seal.baseline)
for (const [p, sha] of Object.entries(manifest.frozen)) assert.equal(hash(release + '/frozen/' + p), sha, 'Frozen closure drift')
const module = p => import(pathToFileURL(release + '/frozen/' + p).href)
const { loadConfig } = await module('dist-server/config.js'), { maintenanceClient } = await module('scripts/secure-maintenance.mjs')
const { allReadiness, metadataReadiness } = await module('release/readiness.mjs')
const config = loadConfig(parseEnv(readFileSync('/root/.local/state/codex-remote-secure/instance.env', 'utf8')))
assert.equal(config.host, '127.0.0.1'); assert.equal(config.port, 5174); assert.equal(config.publicOrigin.origin, 'https://remote.danhkhai.io.vn'); assert.equal(config.secureApiRequired, true)
const client = await maintenanceClient(config)
try {
  const api = async path => { const response = await client.fetch(path, { signal: AbortSignal.timeout(15000) }); assert(response.ok, 'Read-only readiness HTTP ' + response.status); return response.json() }
  const readiness = await allReadiness(api, metadataReadiness, () => json('/root/.local/state/codex-remote-secure/vault/.state/Orchestration.json'))
  console.log(JSON.stringify({ observationOnly: true, service: 'codex-remote-secure.service', ready: readiness.ready, busy: readiness.busy, pending: readiness.pending, queued: readiness.queued, incomplete: readiness.incomplete }))
} finally { client.close() }
