import { randomUUID } from 'node:crypto'
import { fold, noteBody, revisionOf, wikiTargets } from './knowledge-metadata.js'
import type { ContextSnippet, ContextTrace, NoteDocument } from './knowledge-types.js'

export const CONTEXT_NOTE_BUDGET = 24_000
export type ContextTask = { text?: string; cwd?: string; group?: string; groupPath?: string; title?: string }
const stop = new Set('a an the and for from with this that to of in is it on or do can you i my task please va la cua cho voi cac nhung mot toi ban minh hay lam tiep di nay do thi duoc khi da se nhu co ve tu trong o'.split(' '))
const terms = (text: string) => [...new Set(fold(text).match(/[a-z0-9]+/g) ?? [])].filter(term => term.length > 1 && !stop.has(term))
const identity = (text: string) => fold(text).replace(/[^a-z0-9]/g, '')
const historical = (text: string) => /lich su|truoc day|quyet dinh cu|da thay the|superseded|previous|historical|history/.test(fold(text))
const repoKey = (text: string) => text.replace(/-worktrees\/.*$/, '').replace(/\/.git$/, '').replace(/\/$/, '')
const topic = (path: string) => /^(Profile|Patterns|Projects|Ideas|Decisions|References|Inbox)\//.test(path)
const bytes = (value: string) => Buffer.byteLength(value)

function blocks(content: string) {
  let heading = ''
  return noteBody(content).trim().split(/\n\s*\n/).map((text, index) => {
    const title = text.match(/^#{1,6}\s+(.+)$/m)?.[1]
    if (title) heading = title
    return { text, heading, index }
  }).filter(block => block.text)
}

function excerpt(note: NoteDocument, budget: number, query: string, includeHistory: boolean, handoff: boolean) {
  const search = terms(query)
  const eligible = blocks(note.content).filter(block => includeHistory || !/^(?:\*\*)?(?:da thay the|superseded|obsolete)\b/.test(fold(block.text.replace(/^#+\s*/, ''))))
  const ranked = eligible.map(block => {
    const body = fold(block.text), heading = fold(block.heading)
    const overlap = search.reduce((sum, word) => sum + (body.includes(word) ? 1 : 0) + (heading.includes(word) ? 3 : 0), 0)
    const current = /current|hien hanh|dang lam|trang thai|next|tiep theo|con lai|muc tieu/.test(heading) ? 30 : 0
    const recent = handoff ? Math.max(...[...block.text.matchAll(/20\d{2}-\d{2}-\d{2}/g)].map(match => Number(match[0].replaceAll('-', ''))), 0) / 1e7 : 0
    return { ...block, score: (handoff ? current + recent : 0) + overlap + (block.index === 0 ? 4 : 0) }
  }).sort((a, b) => b.score - a.score || a.index - b.index)
  const chosen: typeof ranked = []
  let remaining = budget
  for (const block of ranked) {
    const rendered = block.heading && !block.text.startsWith('#') ? `### ${block.heading}\n${block.text}` : block.text
    const cost = bytes(rendered) + (chosen.length ? 2 : 0)
    if (cost > remaining) continue
    chosen.push({ ...block, text: rendered }); remaining -= cost
  }
  if (!handoff) chosen.sort((a, b) => a.index - b.index)
  let text = chosen.map(block => block.text).join('\n\n')
  // An unusually large single paragraph is the only case that requires a marked text cut.
  if (!text && ranked.length && budget > 100) {
    const buffer = Buffer.from(ranked[0].text)
    text = buffer.subarray(0, budget - 80).toString('utf8').replace(/\ufffd$/, '') + '\n[Paragraph excerpt; read the full note.]'
  }
  return { text, omitted: chosen.length < blocks(note.content).length }
}

export function selectKnowledgeContext(documents: NoteDocument[], threadId: string, task: ContextTask, index?: NoteDocument): ContextTrace {
  const query = task.text ?? '', includeHistory = historical(query), search = terms(`${query} ${task.title ?? ''}`)
  const cwd = repoKey(task.cwd ?? ''), group = identity(task.group ?? '')
  const paths = new Map(documents.map(note => [note.path, note]))
  const handoffPath = `Conversations/${threadId}/Context.md`
  type Candidate = { note: NoteDocument; score: number; reason: string[]; cap: number; priority: number }
  const chosen = new Map<string, Candidate>(), omitted: ContextTrace['omitted'] = []
  const add = (note: NoteDocument | undefined, score: number, reason: string, cap: number, priority: number) => {
    if (!note) return
    if (['superseded', 'archived'].includes(note.status) && !includeHistory) { omitted.push({ path: note.path, reason: 'Superseded/archived; task is not asking for history' }); return }
    const existing = chosen.get(note.path)
    if (existing) { existing.reason.push(reason); existing.score = Math.max(score, existing.score); return }
    chosen.set(note.path, { note, score, reason: [reason], cap, priority })
  }
  add(paths.get('Shared/Context.md'), 100, 'Essential shared rules', 5000, 100)
  add(paths.get(handoffPath), 100, 'Current conversation handoff', 4500, 98)
  add(paths.get('Profile/Context.md'), 100, 'Profile orientation', 1800, 97)
  if (task.groupPath) add(paths.get(task.groupPath), 100, 'Current group context', 2000, 96)
  for (const note of documents) if (note.path.startsWith('Profile/') && note.scope === 'global' && note.status === 'confirmed') add(note, 90, 'Confirmed global preference', 3000, 95)

  const scored: Candidate[] = []
  for (const note of documents.filter(note => topic(note.path))) {
    if (chosen.has(note.path)) continue
    if (['superseded', 'archived'].includes(note.status) && !includeHistory) { omitted.push({ path: note.path, reason: 'Superseded/archived; excluded from current guidance' }); continue }
    const nameTerms = terms([note.path, note.title, ...note.aliases].join(' ')), body = fold(noteBody(note.content))
    const matched = search.filter(word => nameTerms.includes(word))
    const bodyMatched = search.filter(word => body.includes(word))
    const reasons: string[] = []
    let score = matched.length * 6 + Math.min(bodyMatched.length, 8)
    if (matched.length) reasons.push(`Task matches title/alias: ${matched.join(', ')}`)
    else if (bodyMatched.length) reasons.push(`Task matches note: ${bodyMatched.join(', ')}`)
    const repoMatch = Boolean(cwd && cwd !== '/root' && (note.repositories.some(repo => repoKey(repo) === cwd || cwd.startsWith(repoKey(repo) + '/')) || body.includes(fold(cwd))))
    if (repoMatch) { score += 25; reasons.push('Matches task repository/worktree') }
    const scope = identity(note.scope)
    if (group && scope.includes(group)) { score += 12; reasons.push('Matches conversation group scope') }
    const foreign = /^(Projects|Decisions)\//.test(note.path) && scope && scope !== 'global' && group && !scope.includes(group) && !repoMatch
    if (foreign && !matched.length) { omitted.push({ path: note.path, reason: 'Different project scope, without an explicit task match' }); continue }
    if (score >= 6) scored.push({ note, score, reason: reasons, cap: 4000, priority: 70 })
  }
  // Follow direct knowledge links from orientation/handoff notes. Do not recursively expand
  // the whole graph: source transcripts remain evidence to open on demand.
  for (const source of chosen.values()) for (const target of wikiTargets(source.note.content)) {
    const path = target.split('#')[0] + '.md', linked = paths.get(path)
    if (linked && topic(path)) {
      const ranked = scored.find(candidate => candidate.note.path === path)
      if (ranked) { ranked.score += 8; ranked.reason.push(`Linked from ${source.note.path}`) }
      else if (source.note.path === 'Shared/Context.md' || source.note.path === handoffPath || source.note.path === task.groupPath) scored.push({ note: linked, score: 10, reason: [`Linked from ${source.note.path}`], cap: 2500, priority: 70 })
    }
  }
  scored.sort((a, b) => b.score - a.score || a.note.path.localeCompare(b.note.path))
  for (const candidate of scored.slice(0, 8)) for (const reason of candidate.reason) add(candidate.note, candidate.score, reason, candidate.cap, candidate.priority)
  for (const candidate of scored.slice(8)) if (!chosen.has(candidate.note.path)) omitted.push({ path: candidate.note.path, reason: 'Lower relevance than the selected notes' })
  if (index) add(index, 0, 'Knowledge map for further lookup', 1400, 10)

  const ordered = [...chosen.values()].sort((a, b) => b.priority - a.priority || b.score - a.score)
  // Initial caps leave room for relevant topics; unused capacity then expands clipped notes.
  const allocations = new Map<string, number>()
  let remaining = CONTEXT_NOTE_BUDGET - ordered.length * 2
  for (const candidate of ordered) {
    const size = Math.min(bytes(noteBody(candidate.note.content)) + 300, candidate.cap, remaining)
    if (size < 200) { omitted.push({ path: candidate.note.path, reason: 'Context byte budget exhausted' }); continue }
    allocations.set(candidate.note.path, size); remaining -= size
  }
  for (const candidate of ordered) {
    const assigned = allocations.get(candidate.note.path)
    if (assigned === undefined || remaining <= 0) continue
    const extra = Math.min(remaining, Math.max(0, bytes(noteBody(candidate.note.content)) + 300 - assigned))
    allocations.set(candidate.note.path, assigned + extra); remaining -= extra
  }
  const snippets: ContextSnippet[] = []
  for (const candidate of ordered) {
    const allocation = allocations.get(candidate.note.path)
    if (!allocation) continue
    const note = candidate.note
    const heading = `Context source: ${JSON.stringify(note.path)}\nStatus: ${note.status.slice(0, 60)}; scope: ${(note.scope || 'unspecified').slice(0, 200)}\n`
    const clipped = excerpt(note, Math.max(0, allocation - bytes(heading) - 90), query, includeHistory, note.path === handoffPath)
    const rendered = heading + clipped.text + (clipped.omitted ? '\n[Excerpt capped; read the source file for the remaining context.]' : '')
    if (bytes(rendered) > allocation) { omitted.push({ path: note.path, reason: 'Source metadata exceeds the available excerpt allocation' }); continue }
    snippets.push({ path: note.path, title: note.title, revision: note.revision, status: note.status, scope: note.scope, reason: candidate.reason, bytes: bytes(rendered), excerpt: rendered, omitted: clipped.omitted })
  }
  return { id: randomUUID(), threadId, at: new Date().toISOString(), task: query.slice(0, 500), cwd: task.cwd ?? '', group: task.group ?? '', budgetBytes: CONTEXT_NOTE_BUDGET, usedBytes: snippets.reduce((sum, snippet) => sum + snippet.bytes, 0) + Math.max(0, snippets.length - 1) * 2, snippets, omitted }
}

export function indexDocument(content: string): NoteDocument {
  return { path: 'Index.md', title: 'Knowledge map', content, revision: revisionOf(content), bytes: bytes(content), modifiedAt: '', issues: [], type: 'map', status: 'reference', scope: 'global', updated: '', sources: [], related: [], aliases: [], repositories: [], decisionKey: '', supersedes: [] }
}
