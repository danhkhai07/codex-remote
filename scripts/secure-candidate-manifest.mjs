// Source/artifact inventory only. No live baseline, sealing, key provisioning or activation.
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
const target = process.argv[2]
if (!target) throw Error('Usage: node scripts/secure-candidate-manifest.mjs /temporary/new-manifest.json')
const main = '783b1e3ae0efd683458c9fa0b3518b2e476b06a9'
const preserved = 'b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93'
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const digest = async path => ({ path, size: (await stat(path)).size, sha256: createHash('sha256').update(await readFile(path)).digest('hex') })
const walk = async directory => {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(path))
    else if (entry.isFile()) files.push(path)
    else throw Error('Artifact symlink is not allowed: ' + path)
  }
  return files.sort()
}
const changes = git('diff', '--name-only', main, 'HEAD', '--', 'server').split('\n').filter(path => /^server\/[^/]+\.ts$/.test(path) && !path.endsWith('.test.ts'))
const backend = []
for (const source of changes) {
  if (source === 'server/work-hours.ts') throw Error('Pause-aware Hours source must match main baseline')
  const path = source.replace('server/', 'dist-server/').replace(/\.ts$/, '.js')
  backend.push(await digest(path), await digest(path + '.map'))
}
const hours = await digest('dist-server/work-hours.js')
if (hours.sha256 !== preserved) throw Error('Hours build differs from the approved new runtime hash')
const groups = {
  backend,
  client: await Promise.all((await walk('dist')).map(digest)),
  dependencies: await Promise.all(['package.json', 'package-lock.json'].map(digest)),
  operator: await Promise.all(['scripts/secure-key.mjs', 'scripts/secure-maintenance.mjs', 'scripts/knowledge.mjs', 'scripts/services.mjs', 'scripts/restart-when-idle.mjs', 'scripts/restart-readiness.mjs', 'scripts/session-cookie.mjs'].map(digest)),
  adminProxy: [await digest('deploy/nginx/secure-api-location.conf')],
  preserveHours: await Promise.all(['dist-server/work-hours.js', 'dist-server/work-hours.js.map', 'working-hours/update.py', 'working-hours/dashboard.template.html'].map(digest)),
}
const manifest = {
  version: 1, status: 'candidate-inventory-not-a-release', commit: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'), worktree: process.cwd(), dirty: Boolean(git('status', '--porcelain')),
  sourceBases: { encryption: 'd88b163dc9c39412307031e037f655576e2ee311', foundation: '1706f3ba9b844885ccffea8069015e13894052c7', main },
  freshRuntimeBaseline: 'PENDING recovery-owner verification and leader inventory; no runtime read or snapshot in this task',
  gates: ['independent protocol review', 'Hours recovery verification and fresh baseline', 'DNS/TLS/Nginx/Workboard', 'new browser profile', 'new seal and ALL-idle activation'],
  noProductionKeyOrStateIncluded: true, adminSecureRequestBodyLimit: '36m', node: '22.23.2', npm: '10.9.8', groups,
}
await writeFile(resolve(target), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify({ commit: manifest.commit, dirty: manifest.dirty, target: resolve(target), backendFiles: backend.length, clientFiles: groups.client.length, preservedHours: hours.sha256, freshRuntimeBaseline: 'pending' }))
