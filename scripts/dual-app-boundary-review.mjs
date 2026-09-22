// Disposable controls for the coexistence assessment. Never start native Codex.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const legacy = '/root/RUNNING-SERVICES/codex-remote'
assert.equal(execFileSync('git', ['-C', legacy, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), '783b1e3ae0efd683458c9fa0b3518b2e476b06a9')
const ts = createRequire(legacy + '/package.json')('typescript')
const root = mkdtempSync(join(tmpdir(), 'cr2-coexistence-'))
const passed = []
const servers = []
const load = path => import(pathToFileURL(path).href)
const forbidden = error => error.status === 403
try {
  const built = join(root, 'modules'), project = join(root, 'project'), privateDir = join(root, 'private')
  for (const dir of [built, project, privateDir]) mkdirSync(dir, { mode: 0o700 })
  writeFileSync(join(built, 'package.json'), '{"type":"module"}', { mode: 0o600 })
  for (const name of ['file-policy', 'server-files', 'directory-listing']) {
    const source = readFileSync(resolve('server', name + '.ts'), 'utf8')
    assert.equal(source, execFileSync('git', ['show', `80843c0947c5e665a51a6207dbb871bf2c06a421:server/${name}.ts`], { encoding: 'utf8' }))
    writeFileSync(join(built, name + '.js'), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText, { mode: 0o600 })
  }
  const oldFiles = await load(legacy + '/dist-server/server-files.js')
  const guarded = await load(join(built, 'server-files.js'))
  const listing = await load(join(built, 'directory-listing.js'))
  const key = join(privateDir, 'owner-key.json')
  writeFileSync(key, 'FAKE CANARY ONLY', { mode: 0o600 })
  writeFileSync(join(project, 'note.txt'), 'ordinary project file', { mode: 0o600 })
  writeFileSync(join(project, '.env'), 'FAKE CANARY ONLY', { mode: 0o600 })
  symlinkSync(key, join(project, 'linked.json'))
  assert.equal((await oldFiles.inspectServerFile(key, ['/'])).path, key)
  passed.push('legacy root policy accepts owner-only canary')
  await assert.rejects(oldFiles.inspectServerFile(key, [project]), forbidden)
  passed.push('legacy explicit roots deny outside canary')
  await assert.rejects(guarded.inspectServerFile(key, ['/']), forbidden)
  await assert.rejects(guarded.inspectServerFile(join(project, 'linked.json'), [project]), forbidden)
  await assert.rejects(guarded.inspectServerFile(join(project, '.env'), [project]), forbidden)
  passed.push('accepted guard rejects broad root, symlink escape and secret name')
  assert.equal((await guarded.inspectServerFile(join(project, 'note.txt'), [project])).name, 'note.txt')
  const entries = (await listing.listDirectory(new URLSearchParams({ path: project, hidden: '1' }), [project])).entries
  assert(!entries.some(entry => entry.name === '.env'))
  assert.equal(entries.find(entry => entry.name === 'linked.json').kind, 'unavailable')
  passed.push('guard preserves normal Files shape and filters private listing')

  const { ReadStateStore } = await load(legacy + '/dist-server/read-state.js')
  const shared = join(root, 'read-state.json')
  const left = new ReadStateStore(shared), right = new ReadStateStore(shared)
  left.observe('thread-a', ['reply-a'], true)
  right.observe('thread-b', ['reply-b'], true)
  assert.deepEqual(new ReadStateStore(shared).snapshot().unread, { 'thread-b': ['reply-b'] })
  passed.push('shared cached state deterministically loses first writer update')
  const a = new ReadStateStore(join(root, 'a.json')), b = new ReadStateStore(join(root, 'b.json'))
  a.observe('thread-a', ['reply-a'], true); b.observe('thread-b', ['reply-b'], true)
  assert.deepEqual(new ReadStateStore(join(root, 'a.json')).snapshot().unread, { 'thread-a': ['reply-a'] })
  assert.deepEqual(new ReadStateStore(join(root, 'b.json')).snapshot().unread, { 'thread-b': ['reply-b'] })
  passed.push('separate state paths preserve both independent writers')

  const { listenOrchestration } = await load(legacy + '/dist-server/orchestration-socket.js')
  const fake = socketPath => ({ socketPath, command: async () => { throw Error('No commands allowed in this fixture') } })
  const first = await listenOrchestration(fake(join(root, 'shared.sock'))); servers.push(first)
  await assert.rejects(listenOrchestration(fake(join(root, 'shared.sock'))), /already in use/)
  assert(first.listening)
  passed.push('same Vault socket refuses second gateway without stopping first')
  const second = await listenOrchestration(fake(join(root, 'separate.sock'))); servers.push(second)
  assert(first.listening && second.listening)
  passed.push('independent Vault sockets can coexist')
  console.log(JSON.stringify({ cases: passed.length, passed, scope: 'owned canary files and fake Unix sockets only; no native turns, key provisioning or production writes' }, null, 2))
} finally {
  for (const server of servers) await new Promise(resolve => server.close(resolve))
  rmSync(root, { recursive: true, force: true })
}
