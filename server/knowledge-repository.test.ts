import { afterEach, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContextVault } from './context-vault.js'
import { knowledgeRepository } from './knowledge-repository.js'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
it('resolves real Git common-dir identity across separated worktrees and rejects forged backlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'knowledge-git-')); roots.push(root)
  const main = join(root, 'repos', 'alpha'), work = join(root, 'WORKTREES', 'task')
  mkdirSync(main, { recursive: true }); mkdirSync(join(root, 'WORKTREES'))
  execFileSync('git', ['init', '-q', main])
  execFileSync('git', ['-C', main, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture'])
  execFileSync('git', ['-C', main, 'worktree', 'add', '-q', '-b', 'fixture-task', work])
  mkdirSync(join(work, 'nested'))
  expect(knowledgeRepository(main)).toBe(main)
  expect(knowledgeRepository(join(work, 'nested'))).toBe(main)
  const vault = new ContextVault(join(root, 'vault'))
  vault.recordThread({ id: 'task', cwd: join(work, 'nested') })
  vault.knowledge.save('Projects/Alpha.md', `---\nstatus: confirmed\nscope: alpha\nrepositories: [${JSON.stringify(main)}]\n---\n# Alpha\n\nREPO_CURRENT_RULE`, '', 'fixture')
  expect(vault.prepareContext('task', { text: 'tiếp tục' }).trace.snippets.find(s => s.path === 'Projects/Alpha.md')?.excerpt).toContain('REPO_CURRENT_RULE')
  const unrelated = join(root, 'unrelated'); mkdirSync(unrelated)
  execFileSync('git', ['init', '-q', unrelated])
  expect(knowledgeRepository(unrelated)).toBe(unrelated)
  rmSync(join(unrelated, '.git'), { recursive: true })
  writeFileSync(join(unrelated, '.git'), `gitdir: ${join(main, '.git/worktrees/task')}`)
  expect(knowledgeRepository(unrelated)).toBeUndefined()
})
