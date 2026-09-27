// Fixed synthetic notes only. Baseline modules are read/copy-only; never use a real Vault.
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
const [baselineDirectory, output] = process.argv.slice(2)
assert(baselineDirectory && output, 'Supply installed baseline modules and private output')
const temporary = mkdtempSync(join(tmpdir(), 'vault-context-measure-')), baseline = join(temporary, 'baseline')
const modules = ['context-vault.js', 'knowledge-context.js', 'knowledge-store.js', 'knowledge-vault.js', 'knowledge-metadata.js', 'vault-files.js']
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex')
try {
  mkdirSync(baseline); writeFileSync(join(temporary, 'package.json'), '{"type":"module"}')
  for (const file of modules) cpSync(join(baselineDirectory, file), join(baseline, file))
  const Before = (await import(pathToFileURL(join(baseline, 'context-vault.js')).href)).ContextVault
  const After = (await import(pathToFileURL(resolve('dist-server/context-vault.js')).href)).ContextVault
  const results = []
  for (const scenario of ['short-current-task', 'dense-globals-and-project', 'giant-rule-paragraph', 'dense-paragraphs-large-role']) {
    const values = []
    for (const [label, Vault] of [['before', Before], ['after', After]]) {
      const root = join(temporary, 'fixture-vault'), vault = new Vault(root)
      vault.recordThread({ id: 'fixture', name: 'Needle task' })
      const save = (path, body) => writeFileSync(join(root, path), body)
      save('Shared/Context.md', '# Rules\n\nOWNER_RULE keep authenticated access and active user scope.\n\n[[Projects/Needle]]')
      save('Profile/Context.md', '# Preferences\n\nConcise Vietnamese. No invented user preferences.')
      save('Conversations/fixture/Context.md', '# Handoff\n\n## Current\n\nACTIVE_TASK implement Needle, preserve context and data.\n\n## Next\n\nVerify candidate before deployment.')
      save('Projects/Needle.md', '---\nstatus: confirmed\nscope: global\n---\n# Needle\n\nTASK_RULE preserve the original history.\n\n## Superseded\n\nOLD_RULE delete history automatically.\n\n## Current\n\nCurrent source and next step matter.')
      if (scenario === 'dense-globals-and-project') for (let i = 0; i < 9; i++) save(`Profile/Rule-${i}.md`, '---\nstatus: confirmed\nscope: global\n---\n# Global rule\n\nGLOBAL_' + i + ' stable rule. ' + 'Detailed supporting guidance. '.repeat(140))
      if (scenario === 'giant-rule-paragraph') save('Shared/Context.md', '# Rules\n\nOWNER_RULE ' + 'Không đổi quyền người dùng 🦊. '.repeat(1500))
      if (scenario === 'dense-paragraphs-large-role') for (let i = 0; i < 9; i++) save(`Profile/Rule-${i}.md`, '---\nstatus: confirmed\nscope: global\n---\n# Global rule\n\nGLOBAL_' + i + ' stable rule.\n\n' + ('Detailed supporting guidance. '.repeat(8) + '\n\n').repeat(40))
      const role = 'AUTH_ROLE current worker may not delegate or borrow credentials; direct user instructions win.' + (scenario === 'dense-paragraphs-large-role' ? '\nRole constraint.'.repeat(700) : '')
      const c = vault.prepareContext('fixture', { text: 'Continue Needle task', cwd: '/tmp/fixture-project' }, label === 'after' ? role : undefined)
      const text = label === 'after' ? c.text : c.text + '\n\n' + role
      values.push({ label, excerptBytes: c.trace.usedBytes, assembledBytes: Buffer.byteLength(text), noteCount: c.trace.snippets.length,
        activeTask: text.includes('ACTIVE_TASK'), ownerRule: text.includes('OWNER_RULE'), taskRule: text.includes('TASK_RULE'), obsoleteLeak: text.includes('OLD_RULE'), rolePreserved: text.includes(role) })
      if (label === 'after') { assert(values.at(-1).activeTask && values.at(-1).ownerRule && values.at(-1).taskRule && !values.at(-1).obsoleteLeak); assert(Buffer.byteLength(text) <= 24000) }
      rmSync(root, { recursive: true, force: true })
    }
    results.push({ scenario, ...Object.fromEntries(values.map(({ label, ...value }) => [label, value])), bytesSaved: values[0].assembledBytes - values[1].assembledBytes })
  }
  writeFileSync(output, JSON.stringify({ fixtureOnly: true, modelTurns: 0, billingSavingsMeasured: false, baselineModules: Object.fromEntries(modules.map(file => [file, sha(join(baselineDirectory, file))])), candidateModules: Object.fromEntries(modules.map(file => [file, sha(join('dist-server', file))])), results }, null, 2) + '\n', { mode: 0o600 })
  console.log(JSON.stringify(results, null, 2))
} finally { rmSync(temporary, { recursive: true, force: true }) }
