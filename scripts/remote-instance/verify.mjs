// Read-only package verification. Does not create readiness, key or activation receipts.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
const root = path.resolve(process.argv[2])
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const manifestBytes = fs.readFileSync(path.join(root, 'manifest.json'))
assert.equal(hash(manifestBytes), '88f43bd538941920120a7d98612e84ed5866ffb019049a14782510f414b5d536', 'package manifest changed')
const manifest = JSON.parse(manifestBytes)
assert.equal(manifest.source, '10f52e9410dd593e9182483701f043b43338ccf1')
const files = new Set()
function walk(local = '') {
  for (const name of fs.readdirSync(path.join(root, local))) {
    const relative = path.join(local, name), file = path.join(root, relative), st = fs.lstatSync(file)
    if (st.isDirectory()) { walk(relative); continue }
    if (relative === 'manifest.json') continue
    files.add(relative)
    const expected = manifest.files[relative]
    assert(expected, 'extra package file: ' + relative)
    if (expected.link) {
      assert(st.isSymbolicLink()); assert.equal(fs.readlinkSync(file), expected.link)
      assert(fs.realpathSync(file).startsWith(root + '/'), 'link outside package')
    } else {
      assert(st.isFile() && !st.isSymbolicLink()); assert.equal(st.nlink, 1)
      assert.equal(st.size, expected.size); assert.equal(st.mode & 0o777, expected.mode)
      assert.equal(hash(fs.readFileSync(file)), expected.sha256, relative)
    }
  }
}
walk()
assert.deepEqual([...files].sort(), Object.keys(manifest.files).sort())
const app = path.join(root, 'app'), backendGraph = new Set(), pending = ['index.js']
while (pending.length) {
  const name = pending.pop()
  if (backendGraph.has(name)) continue
  assert(manifest.copied['dist-server/' + name], 'missing backend module: ' + name)
  backendGraph.add(name)
  const code = fs.readFileSync(path.join(app, 'dist-server', name), 'utf8')
  for (const match of code.matchAll(/(?:from\s*|import\s*\()\s*['"](\.\/[^'"]+\.js)['"]/g)) pending.push(match[1].slice(2))
}
const clientGraph = new Set(), html = fs.readFileSync(path.join(app, 'dist/index.html'), 'utf8')
const queue = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(m => 'dist' + m[1])
assert(queue.some(name => /index-.+\.js$/.test(name)))
while (queue.length) {
  const name = queue.pop()
  if (clientGraph.has(name)) continue
  assert(manifest.copied[name], 'missing client module: ' + name); clientGraph.add(name)
  const code = fs.readFileSync(path.join(app, name), 'utf8')
  for (const match of code.matchAll(/["'`](\.?\/?(?:assets\/)?[\w.-]+\.(?:js|mjs|css))["'`]/g)) {
    const value = match[1], local = value.startsWith('/') ? 'dist' + value : value.startsWith('assets/') ? 'dist/' + value : path.join(path.dirname(name), value)
    if (manifest.copied[local] || /-[\w-]{8}\.(js|mjs|css)$/.test(value)) queue.push(local)
  }
}
assert.equal(hash(fs.readFileSync(path.join(app, 'public/sw.js'))), manifest.copied['dist/sw.js'])
console.log(JSON.stringify({ manifestSha256: hash(manifestBytes), files: files.size, backendFiles: manifest.backendFiles, clientFiles: manifest.clientFiles, backendGraph: backendGraph.size, clientGraph: clientGraph.size, allInodesIndependent: true, noProductionWrites: true, activationReady: false }))
