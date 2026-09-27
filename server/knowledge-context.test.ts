import { expect, it } from 'vitest'
import { indexDocument, selectKnowledgeContext, CONTEXT_NOTE_BUDGET } from './knowledge-context.js'
import { metadata, revisionOf } from './knowledge-metadata.js'
import type { NoteDocument } from './knowledge-types.js'

const note = (path: string, content: string): NoteDocument => ({ ...metadata(content), path, content, revision: revisionOf(content), title: path.replaceAll('-', ' '), bytes: Buffer.byteLength(content), modifiedAt: '', issues: [] })
const docs = [
  note('Shared/Context.md', '# Rules\n\nRead the relevant knowledge before acting.'),
  note('Profile/Git-Worktree-Lifecycle.md', '---\nstatus: confirmed\nscope: global\n---\n# Git worktree\n\nTask mới tạo worktree mới. PR đã merge thì dừng service chạy thử và xóa worktree.'),
  note('Projects/Kiotclone.md', '---\nstatus: confirmed\nscope: Kiotclone\nrepositories: ["/root/GITHUB/PhuTungOToTinhMo"]\naliases: [POS]\n---\n# Kiotclone POS\n\nReview qua localhost preview.\n\n**Đã thay thế:** yêu cầu ngrok trước đây.'),
  note('Projects/Codex-Remote.md', '---\nstatus: confirmed\nscope: Codex-Remote\n---\n# Services\n\nHost app thì cập nhật /services với PR và nội dung. Restart khi không có lượt đang chạy.'),
  note('Decisions/Old-Review.md', '---\nstatus: superseded\nscope: Kiotclone\n---\n# Kiotclone review\n\nOld policy: ngrok.'),
  note('Ideas/Shared-Browser.md', '---\nstatus: proposed\nscope: Kiotclone\n---\n# Shared Browser\n\nĐề xuất trình duyệt trên VPS, chưa chốt.'),
  note('Projects/Flint-Company-Deck.md', '---\nstatus: confirmed\nscope: Flint Software\n---\n# Deck\n\nUse a large presentation font.'),
]

it('retrieves current project knowledge, global lifecycle and worktree repository matches', () => {
  const trace = selectKnowledgeContext(docs, 'chat', { text: 'Làm tiếp POS', cwd: '/root/GITHUB/PhuTungOToTinhMo-worktrees/pos', group: 'KiotClone' })
  expect(trace.snippets.map(item => item.path)).toContain('Profile/Git-Worktree-Lifecycle.md')
  const project = trace.snippets.find(item => item.path === 'Projects/Kiotclone.md')!
  expect(project.excerpt).toContain('localhost preview')
  expect(project.reason).toContain('Matches task repository/worktree')
  expect(project.excerpt).not.toContain('yêu cầu ngrok')
  expect(trace.snippets.map(item => item.path)).not.toContain('Decisions/Old-Review.md')
  expect(trace.snippets.map(item => item.path)).not.toContain('Projects/Flint-Company-Deck.md')
})

it.each([
  ['Khi host app cập nhật services thế nào?', 'Codex Remote', 'Projects/Codex-Remote.md', 'cập nhật /services'],
  ['Quy trình review Kiotclone hiện tại?', 'KiotClone', 'Projects/Kiotclone.md', 'localhost preview'],
  ['Lịch sử review Kiotclone trước đây dùng gì?', 'KiotClone', 'Decisions/Old-Review.md', 'ngrok'],
  ['Shared Browser đã chốt chưa?', 'KiotClone', 'Ideas/Shared-Browser.md', 'Status: proposed'],
])('retrieval acceptance: %s', (text, group, path, expected) => {
  const trace = selectKnowledgeContext(docs, 'chat', { text, group })
  expect(trace.snippets.find(item => item.path === path)?.excerpt).toContain(expected)
})

it('preserves current handoff content in long notes and redistributes unused space without breaking UTF-8', () => {
  const long = note('Conversations/chat/Context.md', '# Handoff\n\n## Past history\n\n' + 'Old deployment 🦊. '.repeat(2000) + '\n\n## Current status\n\nLATEST TASK IS STILL RUNNING\n\n## Next steps\n\nVerify restore conflict before deploy.')
  const trace = selectKnowledgeContext([...docs, long], 'chat', { text: 'Tiếp tục task', group: 'KiotClone' }, indexDocument('# Index\n\n' + 'Map entry\n'.repeat(4000)))
  expect(trace.snippets.find(item => item.path === long.path)?.excerpt).toContain('LATEST TASK IS STILL RUNNING')
  expect(trace.snippets.find(item => item.path === long.path)?.excerpt).toContain('Verify restore conflict')
  expect(trace.usedBytes).toBeLessThanOrEqual(CONTEXT_NOTE_BUDGET)
  expect(trace.snippets.some(item => item.omitted)).toBe(true)
  expect(trace.snippets.map(item => item.excerpt).join('')).not.toContain('\ufffd')
})

it('understands aliases, block lists and quoted Vietnamese metadata', () => {
  expect(metadata('---\nstatus: "confirmed"\naliases:\n  - POS\n  - "Bán hàng"\nrepositories: [/root/repo, /root/another]\n---\n')).toMatchObject({ status: 'confirmed', aliases: ['POS', 'Bán hàng'], repositories: ['/root/repo', '/root/another'] })
})

it('accounts for source metadata and separators inside the excerpt budget', () => {
  const largeMetadata = note('Projects/' + 'Deep/'.repeat(100) + 'POS.md', '---\nstatus: confirmed\nscope: ' + 'Kiotclone '.repeat(1000) + '\n---\n# POS\n\nCurrent POS guidance.')
  const trace = selectKnowledgeContext([...docs, largeMetadata], 'chat', { text: 'POS', group: 'KiotClone' })
  expect(Buffer.byteLength(trace.snippets.map(snippet => snippet.excerpt).join('\n\n'))).toBe(trace.usedBytes)
  expect(trace.usedBytes).toBeLessThanOrEqual(trace.budgetBytes)
})

it('excludes obsolete section descendants but keeps current siblings; history API is not a policy-history request', () => {
  const n = note('Projects/History.md', '# History API\n\n## Superseded\n\nOLD_RULE\n\n### Nested\n\nOLD_CHILD\n\n## Current\n\nACTIVE_RULE')
  const trace = selectKnowledgeContext([n], 'chat', { text: 'fix history API' })
  expect(trace.snippets[0].excerpt).toContain('ACTIVE_RULE')
  expect(trace.snippets[0].excerpt).not.toMatch(/OLD_RULE|OLD_CHILD|Superseded/)
  const history = selectKnowledgeContext([n], 'chat', { text: 'Historical History API decisions' })
  expect(history.snippets[0].excerpt).toContain('OLD_CHILD')
})

it('returns useful content for a giant paragraph, preserves Unicode and emits each real heading once', () => {
  const n = note('Shared/Context.md', '# Rules\n\n## Current\n\nIMPORTANT_CONTENT ' + '🦊 điều kiện '.repeat(5000))
  const trace = selectKnowledgeContext([n], 'chat', {})
  expect(trace.snippets[0].excerpt).toContain('IMPORTANT_CONTENT')
  expect(trace.snippets[0].excerpt.match(/## Current/g)).toHaveLength(1)
  expect(trace.snippets[0].excerpt.match(/# Rules/g)).toHaveLength(1)
  expect(trace.snippets[0].excerpt).not.toContain('\ufffd')
  expect(trace.snippets[0].ranges?.[0]).toMatchObject({ startLine: 5, partial: true })
})

it('repeated aliases/anchors cannot change linked topic membership or reasons', () => {
  const topics = Array.from({ length: 8 }, (_, i) => note(`Projects/Alpha-Beta-${i}.md`, '# Alpha Beta\n\nUseful topic'))
  const linked = note('Ideas/Else.md', '# Else\n\nLinked guidance')
  const pick = (links: string) => selectKnowledgeContext([note('Shared/Context.md', '# Rules\n\n' + links), ...topics, linked], 'chat', { text: 'alpha beta' }).snippets.map(s => ({ path: s.path, reason: s.reason }))
  expect(pick('[[Ideas/Else]] [[Ideas/Else#One|alias]] [[Ideas/Else#Two]]')).toEqual(pick('[[Ideas/Else]]'))
})

it('global preferences cannot starve a directly matched project and map', () => {
  const globals = Array.from({ length: 9 }, (_, i) => note(`Profile/Rule-${i}.md`, '---\nstatus: confirmed\nscope: global\n---\n# Rule\n\nRULE_' + i + ' ' + 'more rule content '.repeat(500)))
  const project = note('Projects/Needle.md', '# Needle\n\nTASK_CONTEXT')
  const trace = selectKnowledgeContext([...globals, project], 'chat', { text: 'Needle' }, indexDocument('# Map\n\n[[Projects/Needle]]'))
  expect(trace.snippets.find(s => s.path === project.path)?.excerpt).toContain('TASK_CONTEXT')
  expect(trace.snippets.find(s => s.path === 'Index.md')?.excerpt).toContain('Projects/Needle')
  for (const n of globals) expect(trace.snippets.find(s => s.path === n.path)?.excerpt).toContain('RULE_')
  expect(trace.usedBytes).toBe(Buffer.byteLength(trace.snippets.map(s => s.excerpt).join('\n\n')))
})

it('current handoff outranks an old keyword-heavy block and keeps source order within current sections', () => {
  const keywords = Array.from({ length: 80 }, (_, i) => 'keyword' + i).join(' ')
  const n = note('Conversations/chat/Context.md', '# Handoff\n\n## Earlier work\n\n' + (keywords + ' ').repeat(50) + '\n\n## Current\n\nACTIVE_FIRST\n\nACTIVE_SECOND\n\n## Next\n\nNEXT_STEP')
  const text = selectKnowledgeContext([n], 'chat', { text: keywords }).snippets[0].excerpt
  expect(text.indexOf('ACTIVE_FIRST')).toBeLessThan(text.indexOf('ACTIVE_SECOND'))
  expect(text).toContain('NEXT_STEP')
  expect(text.match(/## Current/g)).toHaveLength(1)
  if (text.includes('keyword0')) expect(text.indexOf('ACTIVE_FIRST')).toBeLessThan(text.indexOf('keyword0'))
})
