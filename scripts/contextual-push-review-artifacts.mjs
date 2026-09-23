// Read-only source/runtime verification and private fixture artifact copy.
// Run under codex-heavy; never writes the candidate author or production tree.
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const author = '/root/WORKTREES/cr-push-services-hours'
const runtime = '/root/RUNNING-SERVICES/codex-remote-secure'
const manifest = JSON.parse(await readFile('/tmp/push-services-hours-evidence/candidate-manifest.json', 'utf8'))
assert.equal(manifest.source, 'd4775efeb98764d0858eceafbf6491346259807c')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const get = async (path, expected) => { const bytes = await readFile(path); assert.equal(hash(bytes), expected, path); return bytes }
for (const [path, expected] of Object.entries(manifest.logs)) await get(path, expected)
// Author has advanced to a title-integrated build. This review uses its own
// clean client build at the fixed reviewed source instead of mutable output.
const clientHashes = {}
async function inventory(path, prefix = '') {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const relative = prefix + entry.name
    if (entry.isDirectory()) await inventory(join(path, entry.name), relative + '/')
    else clientHashes[relative] = hash(await readFile(join(path, entry.name)))
  }
}
await inventory(resolve('dist'))
assert.equal(hash(await readFile('public/sw.js')), clientHashes['sw.js'])
const backendDelta = Object.keys(manifest.backendDelta).sort()
assert.deepEqual(backendDelta, ['controller.js', 'controller.js.map', 'index.js', 'index.js.map', 'push.js', 'push.js.map'])
await mkdir('dist-server', { recursive: true })
for (const [path, liveHash] of Object.entries(manifest.observedRuntimeBackend)) {
  await get(join(runtime, 'dist-server', path), liveHash)
  const candidateHash = manifest.backendDelta[path]?.candidate ?? manifest.excludedBuildDifferences[path]?.candidate ?? liveHash
  const bytes = await get(join(author, 'dist-server', path), candidateHash)
  await writeFile(resolve('dist-server', path), bytes)
}
assert.equal((await readdir(join(runtime, 'dist-server'))).filter(name => /\.js(?:\.map)?$/.test(name)).length, Object.keys(manifest.observedRuntimeBackend).length)
await get(join(runtime, 'dist-server/work-hours.js'), 'b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93')
await get(join(runtime, 'dist-server/work-hours.js.map'), '6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8')
for (const path of [resolve('working-hours/dashboard.template.html'), join(runtime, 'working-hours/dashboard.template.html'), '/root/.local/state/codex-remote-secure/hours/dashboard.template.html']) await get(path, manifest.hours.candidateTemplate)
const receipt = { reviewed: manifest.source, backendCount: Object.keys(manifest.observedRuntimeBackend).length, clientCount: Object.keys(clientHashes).length, clientHashes, backendDelta, exclusions: Object.keys(manifest.excludedBuildDifferences), logHashesVerified: true, liveHoursAndTemplatesMatch: true, productionWrites: false }
console.log(JSON.stringify(receipt, null, 2))
