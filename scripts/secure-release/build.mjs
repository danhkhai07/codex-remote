// Preparation only. Reads live files; writes ONLY a new root-private release directory.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, lstatSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { APP, BASE, HOURS, MAIN, INFRA, assert, hash, json, fileHash, record, tree, command, inside, writeJson, serviceIdentity } from './common.mjs'
const checkout = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export function verifyClient(source, inventory) {
  const files = new Set(inventory.map(item => item.path)), html = readFileSync(join(source, 'dist/index.html'), 'utf8')
  const entry = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(match => 'dist' + match[1])
  assert(entry.some(path => /index-.+\.js$/.test(path)), 'missing-client-entry')
  const visited = new Set(), pending = [...entry, ...inventory.filter(item => /\.(js|mjs|css)$/.test(item.path) && item.path.startsWith('dist/assets/')).map(item => item.path)]
  while (pending.length) {
    const path = pending.pop()
    if (visited.has(path)) continue
    assert(files.has(path), 'missing-client-import:' + path); visited.add(path)
    if (!/\.(js|mjs|css)$/.test(path)) continue
    const text = readFileSync(join(source, path), 'utf8')
    for (const match of text.matchAll(/["'`](\.?\/?(?:assets\/)?[\w.-]+\.(?:js|mjs|css))["'`]/g)) {
      const name = match[1], local = name.startsWith('/') ? 'dist' + name : name.startsWith('assets/') ? 'dist/' + name : join(dirname(path), name)
      if (files.has(local) || /-[\w-]{8}\.(js|mjs|css)$/.test(name)) pending.push(local)
    }
    // Bundle source maps must map directly to this exact checkout, including lazy pages.
    const mapPath = path + '.map'
    if (files.has(mapPath)) {
      const map = json(join(source, mapPath))
      for (let i = 0; i < map.sources.length; i++) {
        const local = resolve(dirname(join(source, mapPath)), map.sources[i])
        if (local.startsWith(source + '/src/')) assert(readFileSync(local, 'utf8') === map.sourcesContent[i], 'transformed-fixture-source:' + map.sources[i])
      }
    }
  }
  assert(fileHash(join(source, 'dist/sw.js')) === fileHash(join(source, 'public/sw.js')), 'transformed-service-worker')
  const sw = readFileSync(join(source, 'dist/sw.js'), 'utf8')
  for (const match of sw.matchAll(/'(\/[^'\n]+\.(?:png|svg|css|webmanifest))'/g)) assert(files.has('dist' + match[1]), 'missing-sw-precache')
  return { entry, graph: [...visited].sort(), swPrecache: 'entry-derived; all core and entry assets sealed', sourceMapsMatchSource: true }
}
function snapshotSource(root) {
  const names = command('git', ['ls-files', '-z'], root).split('\0').filter(Boolean).sort()
  return Object.fromEntries(names.map(path => [path, record(join(root, path))]))
}
export function prepare(output, inventoryPath) {
  const inventory = json(inventoryPath), source = inventory.worktree
  assert(inventory.commit === APP && !inventory.dirty, 'wrong-candidate')
  assert(command('git', ['rev-parse', 'HEAD'], source) === APP && command('git', ['status', '--porcelain'], source) === '', 'candidate-source-drift')
  assert(command('git', ['rev-parse', 'HEAD'], MAIN) === BASE && command('git', ['status', '--porcelain'], MAIN) === '', 'main-source-drift')
  assert(inventory.groups.backend.length === 46 && inventory.groups.client.length === 33, 'wrong-inventory-scope')
  for (const entries of Object.values(inventory.groups)) for (const item of entries) assert(fileHash(inside(source, item.path)) === item.sha256, 'candidate-artifact-drift:' + item.path)
  const replacements = new Set(inventory.groups.backend.map(item => item.path.slice(12)))
  const preservedDebugMapDifferences = []
  for (const [path, value] of Object.entries(tree(join(source, 'dist-server')))) {
    if (!value.sha256 || replacements.has(path)) continue
    const live = fileHash(join(MAIN, 'dist-server', path))
    if (path.endsWith('.js.map') && live !== value.sha256) preservedDebugMapDifferences.push({ path, live, candidate: value.sha256 })
    else assert(live === value.sha256, 'excluded-candidate-runtime-mismatch:' + path)
  }
  assert(fileHash(join(MAIN, 'dist-server/work-hours.js')) === HOURS, 'live-hours-drift')
  const graph = verifyClient(source, inventory.groups.client)
  assert((lstatSync(dirname(output)).mode & 0o077) === 0, 'release-parent-must-be-private')
  mkdirSync(output, { mode: 0o700 }) // Must be new, no recursive overwrite of old seals.
  const copy = (from, local) => { const to = inside(output, local); mkdirSync(dirname(to), { recursive: true, mode: 0o700 }); copyFileSync(from, to) }
  const groups = ['backend', 'client', 'dependencies', 'operator', 'adminProxy']
  for (const group of groups) for (const item of inventory.groups[group]) copy(join(source, item.path), 'payload/' + item.path)
  // Only transitive operator dependencies. Never copy the entire backend to live or operator.
  const operatorFiles = new Set(), operatorPending = inventory.groups.operator.map(item => item.path)
  while (operatorPending.length) {
    const path = operatorPending.pop(); if (operatorFiles.has(path)) continue; operatorFiles.add(path)
    copy(join(source, path), 'operator/' + path)
    for (const match of readFileSync(join(source, path), 'utf8').matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) operatorPending.push(join(dirname(path), match[1]))
  }
  copy(join(source, 'package.json'), 'operator/package.json')
  copy(join(source, 'package.json'), 'dependencies/package.json'); copy(join(source, 'package-lock.json'), 'dependencies/package-lock.json')
  // Snapshot only the old watcher's actual transitive JS imports (no secret config values).
  const old = new Set(), pending = ['scripts/restart-when-idle.mjs']
  while (pending.length) {
    const local = pending.pop(); if (old.has(local)) continue; old.add(local)
    const text = readFileSync(join(MAIN, local), 'utf8'); copy(join(MAIN, local), 'old/' + local)
    for (const match of text.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) pending.push(join(dirname(local), match[1]))
  }
  writeFileSync(join(output, 'old/package.json'), '{"type":"module"}\n')
  for (const name of ['common.mjs', 'runner.mjs', 'production.mjs', 'verify.mjs']) copy(join(checkout, 'scripts/secure-release', name), 'runner/' + name)
  const infraNames = ['admin-active.conf', 'admin-cutover-gated.conf', 'preview-active.conf', 'preview-parked.conf', 'cloudflare-real-ip.conf', 'workboard-isolated.conf', 'workboard-embedding.patch', 'workboard-review.bundle', 'workboard-delivery.json']
  for (const name of infraNames) copy(join(INFRA, name), 'infra/' + name)
  const admin = readFileSync(join(output, 'infra/admin-active.conf'), 'utf8')
  const secureLocation = readFileSync(join(source, 'deploy/nginx/secure-api-location.conf'), 'utf8')
  // The pre-encryption infra draft used GET /preview/... to mint a ticket. Required
  // mode deliberately rejects that route: send legacy bookmarks to the unlock-gated
  // Services UI, which obtains a launch ticket through the encrypted API instead.
  const secureAdmin = admin.replace('return 303 /preview/5180/workboard/;', 'return 303 /services;')
    .replace('rewrite ^/workboard/(.*)$ /preview/5180/workboard/$1 redirect;', 'return 303 /services;')
  writeFileSync(join(output, 'infra/admin-active.conf'), secureAdmin.replace('    location = /workboard', secureLocation + '\n    location = /workboard'))
  // During copy/restart block ALL public admin requests, while loopback readiness remains usable.
  const cutover = readFileSync(join(output, 'infra/admin-cutover-gated.conf'), 'utf8')
  writeFileSync(join(output, 'infra/admin-maintenance.conf'), cutover.replace('location / { proxy_pass http://127.0.0.1:5173; }', 'location / { add_header Cache-Control "no-store" always; return 503; }'))
  copy('/root/WORKTREES/workboard-isolated-preview/server.py', 'infra/workboard-server.py')
  assert(fileHash(join(output, 'infra/workboard-server.py')) === json(join(INFRA, 'workboard-delivery.json')).candidateServerSha256, 'workboard-bundle-drift')
  const env = parseEnv(readFileSync(join(MAIN, '.env'), 'utf8')) // Values never serialized.
  const configPaths = [join(MAIN, '.env'), '/etc/systemd/system/codex-remote.service', '/etc/systemd/system/workboard.service', '/root/GITHUB/Workboard/.env', '/root/GITHUB/Workboard/server.py', '/root/VAULTS/Flint-Software/Working-Hours/update.py', '/root/VAULTS/Flint-Software/Working-Hours/dashboard.template.html']
  const stable = Object.fromEntries(configPaths.map(path => [path, record(path)]))
  const observed = Object.fromEntries(Object.entries(env).filter(([name, value]) => /(?:STATE|PRESENCE_FILE|HOURS_FILE|SERVICES_FILE|READ_STATE_FILE)$/.test(name) && value.startsWith('/')).map(([, path]) => [path, record(path)]))
  for (const path of ['/root/.local/state/codex-remote/services.json', '/root/.local/state/codex-remote/sessions.json', join(MAIN, '.remote-push.json')]) observed[path] = record(path)
  const baseline = { capturedAt: new Date().toISOString(), main: BASE, service: serviceIdentity('codex-remote.service'), workboard: serviceIdentity('workboard.service'), nginx: serviceIdentity('nginx.service'),
    processCommand: fileHash('/proc/1758426/cmdline'), processCwd: realpathSync('/proc/1758426/cwd'), backend: tree(join(MAIN, 'dist-server')), client: tree(join(MAIN, 'dist')), source: snapshotSource(MAIN), stable,
    nginxFiles: tree('/etc/nginx'), workboardDropins: record('/etc/systemd/system/workboard.service.d').absent ? {} : tree('/etc/systemd/system/workboard.service.d'), dependencies: tree(join(MAIN, 'node_modules')), observedMutableState: observed,
    nginxTempDirectories: Object.fromEntries(['body', 'proxy', 'fastcgi', 'uwsgi', 'scgi'].map(name => { const path = '/var/lib/nginx/' + name; return [path, { ...record(path), ino: lstatSync(path).ino }] })),
    unitHashes: Object.fromEntries(['codex-remote.service', 'workboard.service', 'nginx.service'].map(unit => [unit, hash(command('systemctl', ['cat', unit]))])) }
  assert(baseline.service.includes('MainPID=1758426\n'), 'live-process-drift')
  writeJson(join(output, 'baseline.json'), baseline); writeJson(join(output, 'inventory.json'), inventory); writeJson(join(output, 'client-graph.json'), graph)
  writeJson(join(output, 'excluded-coherence.json'), { excludedExecutableModulesMatch: true, preservedDebugMapDifferences, policy: 'All excluded files including existing debug maps are preserved byte-for-byte; only the 46 allowlisted files deploy' })
  // Source-only review snapshots, outside served code roots; never .env/state/history.
  for (const path of Object.keys(baseline.source)) copy(join(MAIN, path), 'source-baseline/' + path)
  for (const item of inventory.groups.backend) {
    const from = join(MAIN, item.path)
    if (!record(from).absent) copy(from, 'backup-baseline/' + item.path)
  }
  copy(join(MAIN, 'dist/index.html'), 'backup-baseline/dist/index.html')
  for (const path of ['/etc/nginx/sites-available/codex.danhkhai.io.vn', '/root/GITHUB/Workboard/server.py']) copy(path, 'backup-baseline' + path)
  writeJson(join(output, 'metadata.json'), { version: 1, status: 'prepared-not-armed', app: APP, base: BASE, release: output, main: MAIN, runnerSource: command('git', ['rev-parse', 'HEAD'], checkout), hours: HOURS, nginxBodyLimit: '36m', requiredEncryption: true,
    oldWatcherFiles: [...old].sort(), fileRoots: ['/root/RUNNING-SERVICES', '/root/WORKTREES', '/root/GITHUB', '/root/VAULTS'], keyFile: '/root/.local/state/codex-remote/secure-owner/owner-key.json',
    operatorFiles: [...operatorFiles].sort(), baselinePolicy: 'Stable files gate; mutable state is observation only, never restored or overwritten', activationAuthority: 'absent; no arm command in this preparation' })
  console.log(JSON.stringify({ status: 'prepared-not-sealed', output, app: APP, backend: 46, client: 33, graphFiles: graph.graph.length }))
}
if (process.argv[1] === fileURLToPath(import.meta.url)) prepare(resolve(process.argv[2]), resolve(process.argv[3]))
