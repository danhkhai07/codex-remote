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
