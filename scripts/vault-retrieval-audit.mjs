// Characterization, not a claim of model recall quality. Imports exact installed modules,
// but never initializes the installed vault/config, starts native, or reads real chats.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const runtime = resolve(process.argv[2] ?? 'dist-server')
const output = process.argv[3]
const sha = value => createHash('sha256').update(value).digest('hex')
const modules = ['knowledge-context', 'context-vault', 'knowledge-store', 'knowledge-metadata',
  'knowledge-vault', 'vault-files', 'controller', 'orchestration', 'http-app', 'index']
const configFile = ts.readConfigFile('tsconfig.server.json', ts.sys.readFile)
assert(!configFile.error)
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, process.cwd())
const program = ts.createProgram(config.fileNames, config.options)
const alignment = []
for (const name of modules) {
  const emitted = new Map()
  const source = program.getSourceFile(resolve('server', name + '.ts'))
  assert(source)
  program.emit(source, (path, content) => emitted.set(basename(path), content))
  for (const suffix of ['.js', '.js.map']) {
    const file = name + suffix, live = readFileSync(join(runtime, file))
    assert.equal(emitted.get(file), live.toString(), `source/installed mismatch: ${file}`)
    alignment.push({ file, sha256: sha(live), sourceEmitExact: true })
  }
}
const load = name => import(pathToFileURL(join(runtime, name + '.js')).href)
const { selectKnowledgeContext, indexDocument } = await load('knowledge-context')
const { metadata, revisionOf } = await load('knowledge-metadata')
const { ContextVault } = await load('context-vault')
const { RemoteController } = await load('controller')
const note = (path, content) => ({ ...metadata(content), path, content, revision: revisionOf(content),
  title: path, bytes: Buffer.byteLength(content), modifiedAt: '', issues: [] })
const pick = (notes, text = 'continue', extra = {}) => selectKnowledgeContext(notes, 'chat', { text, ...extra })
const text = trace => trace.snippets.map(s => s.excerpt).join('\n\n')
const results = []
const test = async (name, fn) => { const data = await fn(); results.push({ name, passed: true, ...data }); console.log('PASS ' + name) }
const root = mkdtempSync(join(tmpdir(), 'vault-retrieval-audit-'))
const vault = new ContextVault(join(root, 'vault'))
const put = (path, content) => { mkdirSync(resolve(vault.root, path, '..'), { recursive: true }); writeFileSync(join(vault.root, path), content) }
try {
  await test('note status and inline superseded control; section descendants leak', () => {
    const current = note('Shared/Context.md', '# Rules\n\n## Superseded\n\nOLD_SECTION_RULE\n\n## Current\n\nCURRENT_RULE\n\n**Superseded:** INLINE_OLD_RULE')
    const old = note('Decisions/Rules.md', '---\nstatus: superseded\n---\n# Rules\n\nOLD_NOTE_RULE')
    const trace = pick([current, old], 'rules')
    assert(!text(trace).includes('OLD_NOTE_RULE'))
    assert(!text(trace).includes('INLINE_OLD_RULE'))
    assert(text(trace).includes('OLD_SECTION_RULE'))
    assert(text(trace).includes('### Superseded'))
    return { observed: 'Old section body remains; only its standalone heading and inline marker are filtered.' }
  })
  await test('history implementation keyword also enables historical policies', () => {
    const old = note('Decisions/History-API.md', '---\nstatus: superseded\n---\n# History API\n\nOLD_POLICY')
    assert(!text(pick([old], 'fix API')).includes('OLD_POLICY'))
    assert(text(pick([old], 'fix history API')).includes('OLD_POLICY'))
  })
  await test('selected oversized paragraph can become a heading-only excerpt', () => {
    const trace = pick([note('Shared/Context.md', '# Rules\n\nIMPORTANT_CONTENT ' + 'x'.repeat(30000))])
    assert(trace.snippets[0].omitted)
    assert(text(trace).includes('# Rules'))
    assert(!text(trace).includes('IMPORTANT_CONTENT'))
    return { usedBytes: trace.usedBytes, budgetBytes: trace.budgetBytes }
  })
  await test('generated repeated headings and handoff order differ from source', () => {
    const body = '# Handoff\n\n## Previous\n\nOLDER_TEXT\n\n## Current status\n\nCURRENT_TEXT\n\nNEXT_PARAGRAPH'
    const trace = pick([note('Conversations/chat/Context.md', body)])
    const out = text(trace)
    assert(out.indexOf('CURRENT_TEXT') < out.indexOf('# Handoff'))
    assert.equal((out.match(/Current status/g) ?? []).length, 3)
    return { currentHeadingOccurrencesInSource: 1, inExcerpt: 3, sourceOrderPreserved: false }
  })
  await test('lexical overlap can outrank current-first handoff preference', () => {
    const tokens = Array.from({ length: 40 }, (_, i) => 'marker' + i).join(' ')
    const trace = pick([note('Conversations/chat/Context.md', '# Handoff\n\n## Current status\n\nCURRENT_TEXT\n\n## Older\n\n' + tokens)], tokens)
    assert(text(trace).indexOf('marker0') < text(trace).indexOf('CURRENT_TEXT'))
  })
  await test('global rules can exhaust topic and map allocations', () => {
    const globals = Array.from({ length: 9 }, (_, i) => note(`Profile/Rule-${i}.md`, '---\nstatus: confirmed\nscope: global\n---\n# Rule\n\n' + 'r'.repeat(3500)))
    const trace = selectKnowledgeContext([...globals, note('Projects/Target.md', '# Target\n\nIMPORTANT_TARGET')], 'chat', { text: 'target' }, indexDocument('# Map'))
    assert(!text(trace).includes('IMPORTANT_TARGET'))
    assert(trace.omitted.some(n => n.path === 'Projects/Target.md' && n.reason.includes('budget')))
    assert(trace.usedBytes <= 24000)
    return { selected: trace.snippets.length, omitted: trace.omitted }
  })
  await test('one-hop wiki links only; markdown and second hop need agent lookup', () => {
    const docs = [note('Shared/Context.md', '# Rules\n\n[[Projects/Alpha]]\n\n[Gamma](Projects/Gamma.md)'),
      note('Projects/Alpha.md', '# Alpha\n\n[[References/Beta]]'), note('References/Beta.md', '# Beta\n\nBETA'), note('Projects/Gamma.md', '# Gamma\n\nGAMMA')]
    assert.deepEqual(pick(docs, 'zzquery').snippets.map(n => n.path), ['Shared/Context.md', 'Projects/Alpha.md'])
  })
  await test('duplicate links from one source add score repeatedly and evict stronger topic', () => {
    const strong = Array.from({ length: 8 }, (_, i) => note(`Projects/Topic-Anchor-${i}.md`, '# Topic Anchor\n\nCONTENT'))
    const weak = note('Projects/Weak.md', '# Weak\n\ntopic')
    const withLinks = count => pick([note('Shared/Context.md', '# Rules\n\n' + '[[Projects/Weak]] '.repeat(count)), ...strong, weak], 'topic anchor')
    const once = withLinks(1), repeated = withLinks(3)
    assert(!once.snippets.some(s => s.path === weak.path))
    assert(repeated.snippets.some(s => s.path === weak.path))
    assert.equal(repeated.snippets.filter(s => s.path.startsWith('Projects/Topic-Anchor')).length, 7)
    return { scoreWithOneLink: 10, scoreWithThreeLinks: 26, displacedTopicCount: 1 }
  })
  await test('repo normalization recognizes suffix layout but not arbitrary worktree paths', () => {
    const docs = [note('Projects/Alpha.md', '---\nrepositories: ["/repo/alpha"]\n---\n# Alpha\n\nCONTENT')]
    assert.equal(pick(docs, 'zzquery', { cwd: '/repo/alpha-worktrees/task' }).snippets.length, 1)
    assert.equal(pick(docs, 'zzquery', { cwd: '/root/WORKTREES/cr-task' }).snippets.length, 0)
  })
  await test('supersedes metadata warns but does not itself invalidate old confirmed note', () => {
    put('Decisions/Alpha.md', '---\nstatus: confirmed\nscope: global\n---\n# Alpha\n\nOLD_POLICY')
    put('Decisions/Beta.md', '---\nstatus: confirmed\nscope: global\nsupersedes: ["Decisions/Alpha"]\n---\n# Beta\n\nNEW_POLICY')
    assert(vault.knowledge.snapshot().issues.some(i => i.path === 'Decisions/Alpha.md' && i.message.includes('thay thế')))
    assert(text(pick(vault.knowledge.documents(), 'Alpha Beta')).includes('OLD_POLICY'))
  })
  await test('oversized maintained note is absent from both candidates and trace omissions', () => {
    put('Projects/Oversized.md', '# Oversized\n\n' + 'x'.repeat(256001))
    const trace = vault.previewContext('chat', { text: 'Oversized' })
    assert(!trace.snippets.some(n => n.path === 'Projects/Oversized.md'))
    assert(!trace.omitted.some(n => n.path === 'Projects/Oversized.md'))
    assert(vault.knowledge.snapshot().issues.some(n => n.path === 'Projects/Oversized.md' && n.message.includes('256 KB')))
  })
  await test('refresh has no retrieval cache; preview does not record an injection', () => {
    put('Shared/Context.md', '# Shared\n\nBEFORE_EDIT')
    const before = vault.prepareContext('chat', { text: 'shared' })
    put('Shared/Context.md', '# Shared\n\nAFTER_EDIT')
    const after = vault.prepareContext('chat', { text: 'shared' })
    assert(before.text.includes('BEFORE_EDIT')); assert(after.text.includes('AFTER_EDIT'))
    assert.equal(vault.knowledge.traces('chat').length, 0)
    return { excerptBytes: after.trace.usedBytes, wrapperAndExcerptBytes: Buffer.byteLength(after.text),
      wrapperBytes: Buffer.byteLength(after.text) - after.trace.usedBytes }
  })
  await test('24000-byte cap covers excerpts, not wrapper or orchestration', () => {
    const dense = new ContextVault(join(root, 'dense-vault'))
    writeFileSync(join(dense.root, 'Shared/Context.md'), '# Rules\n\n' + Array.from({ length: 100 }, (_, i) => `Fact ${i}: ` + 'z'.repeat(450)).join('\n\n'))
    const context = dense.prepareContext('chat')
    assert(context.trace.usedBytes <= 24000)
    assert(Buffer.byteLength(context.text) > 24000)
    return { excerptBytes: context.trace.usedBytes, vaultMessageBytes: Buffer.byteLength(context.text), orchestrationIncluded: false }
  })
  await test('revision CAS rejects stale API writer; intermediate direct write is unobserved', () => {
    const path = 'References/Cas.md'
    const a = vault.knowledge.save(path, '# Initial', '')
    const b = vault.knowledge.save(path, '# Second', a.revision)
    assert.throws(() => vault.knowledge.save(path, '# Stale', a.revision), e => e.status === 409)
    put(path, '# Unobserved intermediate'); put(path, '# Final external')
    vault.knowledge.captureExternal()
    const revisions = vault.knowledge.versions(path).map(v => v.revision)
    assert(revisions.includes(b.revision)); assert(revisions.includes(revisionOf('# Final external')))
    assert(!revisions.includes(revisionOf('# Unobserved intermediate')))
  })
  await test('generated transcript excluded from retrieval until knowledge is maintained', () => {
    vault.recordThread({ id: 'chat', cwd: '/tmp', turns: [{ id: 'turn-export', status: 'completed', items: [
      { type: 'userMessage', id: 'u', content: [{ type: 'text', text: 'ZEBRA_FACT_ONLY_IN_TRANSCRIPT' }] },
      { type: 'commandExecution', id: 'tool', output: 'NOT_EXPORTED' },
    ] }] })
    assert(vault.knowledge.source('Conversations/chat/Turns/turn-export.md').content.includes('ZEBRA_FACT_ONLY_IN_TRANSCRIPT'))
    assert(!text(vault.previewContext('chat', { text: 'ZEBRA_FACT_ONLY_IN_TRANSCRIPT' })).includes('ZEBRA_FACT_ONLY_IN_TRANSCRIPT'))
    assert(!vault.knowledge.source('Conversations/chat/Turns/turn-export.md').content.includes('NOT_EXPORTED'))
  })
  await test('trace keeps only 100 globally; it is not an unlimited conversation ledger', () => {
    for (let i = 0; i < 101; i++) vault.knowledge.recordTrace({ id: String(i), threadId: i ? 'other' : 'original', snippets: [] })
    assert.equal(vault.knowledge.traces().length, 100)
    assert.equal(vault.knowledge.traces('original').length, 0)
  })
  await test('fake native: resume alone no injection; inject accepted then turn failure still leaves trace', async () => {
    const testVault = new ContextVault(join(root, 'controller-vault'))
    class FakeNative extends EventEmitter {
      calls = []; failInject = false; failTurn = true
      async request(method, params, _timeout, guard) {
        guard?.(); this.calls.push({ method, params })
        if (method === 'thread/read' || method === 'thread/resume') return { thread: { id: 'chat', cwd: '/tmp', turns: [] } }
        if (method === 'thread/inject_items' && this.failInject) throw Error('synthetic injection failure')
        if (method === 'turn/start' && this.failTurn) throw Error('synthetic start failure')
        if (method === 'turn/start') return { turn: { id: 'fake-turn', status: 'inProgress' } }
        return {}
      }
    }
    const app = new FakeNative()
    const controller = new RemoteController({ workspaceRoots: ['/tmp'] }, app, testVault)
    await controller.resumeThread('chat')
    assert(!app.calls.some(c => c.method === 'thread/inject_items'))
    await assert.rejects(controller.startTurn('chat', 'synthetic request'), /synthetic start failure/)
    assert.equal(testVault.knowledge.traces('chat').length, 1)
    assert.deepEqual(app.calls.slice(-2).map(c => c.method), ['thread/inject_items', 'turn/start'])
    const firstInjection = app.calls.find(c => c.method === 'thread/inject_items').params.items[0]
    assert.equal(firstInjection.role, 'developer')
    const wireBytes = Buffer.byteLength(firstInjection.content[0].text)
    const excerptBytes = testVault.knowledge.traces('chat')[0].usedBytes
    app.failInject = true
    await assert.rejects(controller.startTurn('chat', 'synthetic retry'), /synthetic injection failure/)
    assert.equal(testVault.knowledge.traces('chat').length, 1)
    assert.equal(app.calls.at(-1).method, 'thread/inject_items')
    app.failInject = false; app.failTurn = false
    await controller.startTurn('chat', 'synthetic success')
    assert.equal(testVault.knowledge.traces('chat').length, 2)
    assert.equal(app.calls.filter(c => c.method === 'thread/inject_items').length, 3)
    return { noRealNativeProcess: true, failedStartStillTraced: true, wireBytes, excerptBytes }
  })
  const evidence = { schema: 1, at: new Date().toISOString(), runtime, source: '4ee45dbd559c9c975a0c26fb1fb2d2af3d3920a0', alignment, results,
    productionDataAccess: false, nativeProcessStarted: false, modelRecallEvaluated: false }
  if (output) writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 })
  console.log(JSON.stringify({ passed: results.length, exactAlignedArtifacts: alignment.length }))
} finally { rmSync(root, { recursive: true, force: true }) }
