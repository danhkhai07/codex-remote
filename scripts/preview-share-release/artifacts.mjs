// Read-only evidence for the exact integrated candidate; no publication.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { hash, tree, same } from './core.mjs'
import { BACKEND, assertDelta } from './plan.mjs'
const root = resolve('.'), runtime = '/root/RUNNING-SERVICES/codex-remote-secure'
const mapPath = 'dist/assets/docx-preview-ByvNPTF_.js.map'
const normalization = { path: mapPath, built: hash(root + '/' + mapPath), live: hash(runtime + '/' + mapPath) }
if (process.argv.includes('--normalize-map') && normalization.built !== normalization.live) {
  const built = JSON.parse(readFileSync(root + '/' + mapPath)), liveMap = JSON.parse(readFileSync(runtime + '/' + mapPath))
  const normalized = m => ({ ...m, sources: m.sources.map(s => { assert(s.includes('/node_modules/')); return s.slice(s.indexOf('/node_modules/') + 1) }) })
  same(normalized(built), normalized(liveMap), 'Exact docx third-party map semantics')
  // Only this reviewed unchanged map; do not overwrite any runtime asset.
  writeFileSync(root + '/' + mapPath, readFileSync(runtime + '/' + mapPath))
  normalization.normalized = true
}
const backend = tree(root + '/dist-server'), live = tree(runtime + '/dist-server'), client = tree(root + '/dist')
assertDelta(live, backend)
assert.equal(Object.keys(client).length, 25)
const html = readFileSync(root + '/dist/index.html', 'utf8'), pending = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(m => m[1].slice(1)), seen = new Set(), sources = new Set()
while (pending.length) {
  const p = pending.pop(); if (seen.has(p)) continue
  seen.add(p); assert(client[p], 'Missing graph file ' + p)
  const body = readFileSync(root + '/dist/' + p, 'utf8')
  for (const m of body.matchAll(/["'`]([./\w-]+\.(?:js|css|mjs))["'`]/g)) {
    const dep = m[1].startsWith('/') ? m[1].slice(1) : m[1].startsWith('assets/') ? m[1] : join(dirname(p), m[1])
    if (client[dep]) pending.push(dep)
    else assert(!/-[\w-]{8}\.(js|css|mjs)$/.test(m[1]), 'Missing hashed import ' + dep)
  }
  if (client[p + '.map']) {
    const map = JSON.parse(readFileSync(root + '/dist/' + p + '.map'))
    map.sources.forEach((s, i) => { const local = resolve(root, 'dist', dirname(p), s); if (local.startsWith(root + '/src/')) { same(readFileSync(local, 'utf8'), map.sourcesContent[i], 'Map source ' + s); sources.add(local.slice(root.length + 1)) } })
  }
}
assert(sources.has('src/PreviewSharesDialog.tsx') && sources.has('src/api.ts'))
for (const p of BACKEND) if (p.endsWith('.map')) { const map = JSON.parse(readFileSync(root + '/' + p)); assert.deepEqual(map.sources, ['../server/' + p.slice(12, -7) + '.ts']) }
for (const p of ['package.json', 'package-lock.json']) same(hash(root + '/' + p), hash(runtime + '/' + p), 'Dependencies')
const runtimeClient = tree(runtime + '/dist')
const collisions = Object.entries(client).filter(([p, h]) => p.startsWith('assets/') && runtimeClient[p] && runtimeClient[p] !== h).map(([p]) => p)
assert.deepEqual(collisions, [], 'Same-name immutable asset collisions require explicit normalization evidence')
console.log(JSON.stringify({ source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), observedRuntimeBackend: live, observedRuntimeFrontend: tree(runtime + '/dist'), candidateFrontend: client,
  backendDelta: Object.fromEntries(BACKEND.map(p => [p.slice(12), { candidate: backend[p.slice(12)], live: live[p.slice(12)] ?? null }])),
  normalization, clientGraph: [...seen], checkedMapSources: [...sources], hoursTemplate: hash(root + '/working-hours/dashboard.template.html'), dependenciesUnchanged: true, productionWrites: false }, null, 2))
