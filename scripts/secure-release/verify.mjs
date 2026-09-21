import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { APP, HOURS, MAIN, assert, fileHash, hash, serviceIdentity } from './common.mjs'
/** Only read-only production probes. Tickets/logout/key rotation/real pause stay in isolated fixtures. */
export async function postverify({ release, meta, baseline, inventory, client, config, fetcher = fetch }) {
  const checks = []
  const origins = ['http://127.0.0.1:5173', 'https://codex.danhkhai.io.vn']
  for (const origin of origins) {
    const health = await fetcher(origin + '/api/healthz', { signal: AbortSignal.timeout(15000), cache: 'no-store' })
    assert(health.ok && (await health.json()).status === 'ok', 'public-local-health')
    const hashes = {}
    for (const item of inventory.groups.client.filter(item => !item.path.endsWith('.map'))) {
      const response = await fetcher(origin + '/' + item.path.slice(5), { signal: AbortSignal.timeout(15000), cache: 'no-store' })
      const digest = hash(Buffer.from(await response.arrayBuffer()))
      assert(response.ok && digest === item.sha256, 'public-local-full-body-hash:' + item.path)
      hashes[item.path] = digest
    }
    checks.push({ origin, hashes })
  }
  const { createSession } = await import(pathToFileURL(join(release, 'operator/dist-server/auth.js')).href)
  const session = createSession(config.sessionSecret, 60, config.password)
  const legacy = await fetcher(origins[0] + '/api/threads', { headers: { Cookie: '__Host-codex_remote_session=' + session.token, Origin: origins[1] }, signal: AbortSignal.timeout(10000) })
  assert(legacy.status === 403, 'cookie-only-legacy-not-rejected'); await legacy.body?.cancel()
  const privateChecks = {}
  for (const path of ['/api/session', '/api/files/roots', '/api/services', '/api/working-hours', '/api/localhost-preview', '/api/pending']) {
    const response = await client.fetch(path, { signal: AbortSignal.timeout(10000) })
    assert(response.ok, 'encrypted-read-failed:' + path)
    const bytes = Buffer.from(await response.arrayBuffer())
    const value = JSON.parse(bytes)
    if (path === '/api/files/roots') assert(Array.isArray(value.roots) && value.roots.length && !value.roots.includes('/'), 'file-roots-contract')
    if (path === '/api/localhost-preview') assert(value.enabled === true, 'isolated-preview-unavailable')
    privateChecks[path] = { bytes: bytes.length, sha256: hash(bytes) } // Never store session csrf or private content.
  }
  const streamController = new AbortController()
  const stream = await client.fetch('/api/events', { signal: AbortSignal.any([streamController.signal, AbortSignal.timeout(10000)]) })
  assert(stream.ok && stream.body, 'encrypted-stream-unavailable')
  const reader = stream.body.getReader()
  const event = await reader.read()
  assert(!event.done && event.value.byteLength > 0, 'encrypted-stream-empty')
  streamController.abort(); await reader.cancel().catch(() => {})
  const workboard = await fetcher('http://127.0.0.1:5180/workboard/', { signal: AbortSignal.timeout(10000) })
  assert(workboard.ok && workboard.headers.get('content-security-policy')?.includes(origins[1]) && !workboard.headers.has('x-frame-options'), 'workboard-headers')
  await workboard.body?.cancel()
  for (const item of inventory.groups.backend) assert(fileHash(join(MAIN, item.path)) === item.sha256, 'post-module-hash')
  for (const item of inventory.groups.preserveHours.slice(0, 2)) assert(fileHash(join(MAIN, item.path)) === item.sha256, 'hours-module-map-not-preserved')
  for (const path of ['/root/VAULTS/Flint-Software/Working-Hours/update.py', '/root/VAULTS/Flint-Software/Working-Hours/dashboard.template.html']) assert(fileHash(path) === baseline.stable[path].sha256, 'hours-generator-not-preserved')
  const identity = serviceIdentity('codex-remote.service')
  assert(identity !== baseline.service && fileHash(join(MAIN, 'dist-server/work-hours.js')) === HOURS, 'gateway-or-hours-not-current')
  const excluded = Object.entries(baseline.backend).filter(([path, item]) => item.sha256 && !inventory.groups.backend.some(entry => entry.path === 'dist-server/' + path))
  for (const [path, item] of excluded) assert(fileHash(join(MAIN, 'dist-server', path)) === item.sha256, 'excluded-backend-not-preserved')
  for (const [path, item] of Object.entries(baseline.client)) if (path.startsWith('assets/') && item.sha256) assert(fileHash(join(MAIN, 'dist', path)) === item.sha256, 'old-hashed-assets-not-retained')
  return { app: APP, verifiedAt: new Date().toISOString(), process: identity, checks, privateChecks, encryptedProof: true, legacyStatus: legacy.status, encryptedStream: true, workboardHeaders: true, hours: meta.hours, excludedBackendPreserved: true,
    mutatingSecurityAcceptance: 'exact-app isolated fixture receipts; no production ticket/logout/rotation/pause test', statePolicy: 'untouched; no database restore', index: hash(readFileSync(join(MAIN, 'dist/index.html'))) }
}
