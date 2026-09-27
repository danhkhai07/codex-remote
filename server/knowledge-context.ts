import { randomUUID } from 'node:crypto'
import { fold, noteBody, revisionOf, wikiTargets } from './knowledge-metadata.js'
import type { ContextSnippet, ContextTrace, NoteDocument } from './knowledge-types.js'

export const CONTEXT_NOTE_BUDGET = 16_000
export const CONTEXT_MESSAGE_BUDGET = 24_000
export type ContextTask = { text?: string; cwd?: string; repository?: string; group?: string; groupPath?: string; title?: string }
const stop = new Set('a an the and for from with this that to of in is it on or do can you i my task please va la cua cho voi cac nhung mot toi ban minh hay lam tiep di nay do thi duoc khi da se nhu co ve tu trong o'.split(' '))
const terms = (text: string) => [...new Set(fold(text).match(/[a-z0-9]+/g) ?? [])].filter(term => term.length > 1 && !stop.has(term))
const identity = (text: string) => fold(text).replace(/[^a-z0-9]/g, '')
const historical = (text: string) => /truoc day|quyet dinh cu|da thay the|superseded|historical|previous (?:policy|decision|requirement)|history of (?:polic|decision)|lich su.*(?:quyet dinh|yeu cau|review|chinh sach)/.test(fold(text))
const repoKey = (text: string) => text.replace(/-worktrees\/.*$/, '').replace(/\/.git$/, '').replace(/\/$/, '')
const topic = (path: string) => /^(Profile|Patterns|Projects|Ideas|Decisions|References|Inbox)\//.test(path)
const bytes = (value: string) => Buffer.byteLength(value)
const obsolete = (text: string) => /^(?:da thay the|superseded|obsolete|archived|historical|past history|luu tru)\b/.test(fold(text.replace(/^[\s*#]+/, '')))
const current = (text: string) => /^(?:current|hien hanh|dang lam|trang thai|next|tiep theo|con lai|muc tieu)\b/.test(fold(text))
const clip = (text: string, limit: number) => Buffer.from(text).subarray(0, Math.max(0, limit)).toString('utf8').replace(/\ufffd+$/, '')
type Heading = { text: string; level: number; line: number; obsolete: boolean; current: boolean }
type Block = { text: string; headings: Heading[]; line: number; end: number; obsolete: boolean; current: boolean }

/** Heading hierarchy owns its body until the next sibling/ancestor, including nested sections. */
function blocks(content: string): Block[] {
  const body = noteBody(content), offset = content.slice(0, content.length - body.length).split('\n').length - 1
  const result: Block[] = [], headings: Heading[] = []
  let paragraph: string[] = [], start = 0, fence = ''
  const flush = (end: number) => {
    const text = paragraph.join('\n').trim()
    if (text) result.push({ text, headings: [...headings], line: start, end,
      obsolete: headings.some(h => h.obsolete) || obsolete(text), current: headings.some(h => h.current) })
    paragraph = []
  }
  for (const [i, line] of body.split('\n').entries()) {
    const number = offset + i + 1, code = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (code) { if (!fence) fence = code[1]; else if (code[1][0] === fence[0] && code[1].length >= fence.length) fence = '' }
    const title = !fence && !code ? line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/) : null
    if (title) {
      flush(number - 1)
      while (headings.length && headings.at(-1)!.level >= title[1].length) headings.pop()
      headings.push({ text: title[2], level: title[1].length, line: number, obsolete: obsolete(title[2]), current: current(title[2]) })
    } else if (!fence && /^\s*<!--.*-->\s*$/.test(line)) { /* Internal note bookkeeping is not content. */ }
    else if (!line.trim() && !fence) flush(number - 1)
    else { if (!paragraph.length) start = number; paragraph.push(line) }
  }
  flush(offset + body.split('\n').length)
  return result
}
function render(chosen: Block[]) {
  const headings = new Set<number>(), parts: string[] = []
  for (const block of chosen) {
    for (const heading of block.headings) if (!headings.has(heading.line)) {
      headings.add(heading.line); parts.push(`${'#'.repeat(heading.level)} ${heading.text}`)
    }
    parts.push(block.text)
  }
  return parts.join('\n\n')
}
function excerpt(all: Block[], budget: number, query: string, includeHistory: boolean) {
  const search = terms(query), eligible = all.filter(b => includeHistory || !b.obsolete)
  const ranked = eligible.map(block => {
    const body = fold(block.text), heading = fold(block.headings.map(h => h.text).join(' '))
    return { block, score: search.reduce((sum, word) => sum + (body.includes(word) ? 1 : 0) + (heading.includes(word) ? 3 : 0), 0) }
  })
    .sort((a, b) => Number(b.block.current) - Number(a.block.current) || b.score - a.score || a.block.line - b.block.line)
  let chosen: Block[] = [], truncated = false
  const order = (items: Block[]) => items.sort((a, b) => Number(b.current) - Number(a.current) || a.line - b.line)
  for (const { block } of ranked) {
    const attempt = order([...chosen, block])
    if (bytes(render(attempt)) <= budget) { chosen = attempt; continue }
    // A title alone is never a useful excerpt. Keep a meaningful UTF-8 prefix of
    // the highest-priority body instead of wasting its allocation on a heading.
    if (!chosen.length) {
      const overhead = bytes(render([{ ...block, text: '' }])) + 2
      const prefix = clip(block.text, budget - overhead)
      if (bytes(prefix) >= 64) { chosen = [{ ...block, text: prefix }]; truncated = true }
    }
  }
  return { text: render(chosen), omitted: truncated || chosen.length < all.length,
    ranges: chosen.map(b => ({ startLine: b.line, endLine: b.end, ...(truncated ? { partial: true } : {}) })) }
}

export function selectKnowledgeContext(documents: NoteDocument[], threadId: string, task: ContextTask, index?: NoteDocument, budget = CONTEXT_NOTE_BUDGET): ContextTrace {
  budget = Math.max(0, Math.min(CONTEXT_NOTE_BUDGET, budget))
  const query = task.text ?? '', includeHistory = historical(query), search = terms(`${query} ${task.title ?? ''}`)
  const cwds = [task.cwd, task.repository].filter((s): s is string => Boolean(s)).map(repoKey), group = identity(task.group ?? '')
  const paths = new Map(documents.map(note => [note.path, note])), parsed = new Map<string, Block[]>()
  const content = (note: NoteDocument) => { let b = parsed.get(note.path); if (!b) { b = blocks(note.content); parsed.set(note.path, b) } return b }
  const visible = (note: NoteDocument) => render(content(note).filter(b => includeHistory || !b.obsolete))
  const handoffPath = `Conversations/${threadId}/Context.md`
  type Candidate = { note: NoteDocument; score: number; reason: string[]; cap: number; priority: number }
  const chosen = new Map<string, Candidate>(), omitted: ContextTrace['omitted'] = []
  const add = (note: NoteDocument | undefined, score: number, reason: string, cap: number, priority: number) => {
    if (!note) return
    if (['superseded', 'archived'].includes(note.status) && !includeHistory) { omitted.push({ path: note.path, reason: 'Superseded/archived; excluded from current guidance' }); return }
    const existing = chosen.get(note.path)
    if (existing) { if (!existing.reason.includes(reason)) existing.reason.push(reason); existing.score = Math.max(score, existing.score); return }
    chosen.set(note.path, { note, score, reason: [reason], cap, priority })
  }
  add(paths.get('Shared/Context.md'), 100, 'Essential shared rules', 2400, 100)
  add(paths.get(handoffPath), 100, 'Current conversation handoff', 3500, 98)
  add(paths.get('Profile/Context.md'), 100, 'Profile orientation', 800, 97)
  if (task.groupPath) add(paths.get(task.groupPath), 100, 'Current group context', 1000, 96)
  for (const note of documents) if (note.path.startsWith('Profile/') && note.scope === 'global' && note.status === 'confirmed') add(note, 90, 'Confirmed global preference', 1000, 95)
  const scored: Candidate[] = []
  for (const note of documents.filter(note => topic(note.path))) {
    if (chosen.has(note.path)) continue
    if (['superseded', 'archived'].includes(note.status) && !includeHistory) { omitted.push({ path: note.path, reason: 'Superseded/archived; excluded from current guidance' }); continue }
    const nameTerms = terms([note.path, note.title, ...note.aliases].join(' ')), body = fold(visible(note))
    const matched = search.filter(word => nameTerms.includes(word)), bodyMatched = search.filter(word => body.includes(word)), reasons: string[] = []
    let score = matched.length * 6 + Math.min(bodyMatched.length, 8)
    if (matched.length) reasons.push(`Task matches title/alias: ${matched.join(', ')}`)
    else if (bodyMatched.length) reasons.push(`Task matches note: ${bodyMatched.join(', ')}`)
    const repoMatch = cwds.some(cwd => cwd && cwd !== '/root' && (note.repositories.some(repo => repoKey(repo) === cwd || cwd.startsWith(repoKey(repo) + '/')) || body.includes(fold(cwd))))
    if (repoMatch) { score += 25; reasons.push('Matches task repository/worktree') }
    const scope = identity(note.scope)
    if (group && scope.includes(group)) { score += 12; reasons.push('Matches conversation group scope') }
    if (/^(Projects|Decisions)\//.test(note.path) && scope && scope !== 'global' && group && !scope.includes(group) && !repoMatch && !matched.length) {
      omitted.push({ path: note.path, reason: 'Different project scope, without an explicit task match' }); continue
    }
    if (score >= 6) scored.push({ note, score, reason: reasons, cap: 2200, priority: 70 })
  }
  // One capped link bonus per target, independent of repetitions, aliases or anchors.
  const boosted = new Set<string>()
  for (const source of chosen.values()) for (const target of new Set(wikiTargets(visible(source.note) + '\n' + source.note.related.join('\n')).map(t => t.split('#')[0]))) {
    const path = target + '.md', linked = paths.get(path)
    if (!linked || !topic(path) || chosen.has(path) || boosted.has(path)) continue
    const ranked = scored.find(candidate => candidate.note.path === path)
    if (ranked) { ranked.score += 8; ranked.reason.push(`Linked from ${source.note.path}`); boosted.add(path) }
    else if (['Shared/Context.md', handoffPath, task.groupPath].includes(source.note.path)) {
      scored.push({ note: linked, score: 10, reason: [`Linked from ${source.note.path}`], cap: 1600, priority: 70 }); boosted.add(path)
    }
  }
  scored.sort((a, b) => b.score - a.score || a.note.path.localeCompare(b.note.path))
  for (const candidate of scored.slice(0, 8)) for (const reason of candidate.reason) add(candidate.note, candidate.score, reason, candidate.cap, candidate.priority)
  for (const candidate of scored.slice(8)) if (!chosen.has(candidate.note.path)) omitted.push({ path: candidate.note.path, reason: 'Lower relevance than the selected notes' })
  if (index) add(index, 0, 'Knowledge map for further lookup', 600, 10)
  const ordered = [...chosen.values()].sort((a, b) => b.priority - a.priority || b.score - a.score || a.note.path.localeCompare(b.note.path))
  const snippets: ContextSnippet[] = []
  let remaining = budget
  const emit = (candidate: Candidate, allocation: number) => {
    const note = candidate.note, heading = `Context source: ${JSON.stringify(note.path)}\nStatus: ${note.status.slice(0, 60)}; scope: ${(note.scope || 'unspecified').slice(0, 200)}\n`
    const clipped = excerpt(content(note), Math.max(0, allocation - bytes(heading) - 85), `${query} ${task.title ?? ''}`, includeHistory)
    const rendered = heading + clipped.text + (clipped.omitted ? '\n[Excerpt capped; read the source file for the remaining context.]' : '')
    if (!clipped.text || bytes(rendered) > allocation) { omitted.push({ path: note.path, reason: 'No useful body fits the excerpt budget; read source directly' }); return 0 }
    snippets.push({ path: note.path, title: note.title, revision: note.revision, status: note.status, scope: note.scope, reason: candidate.reason, bytes: bytes(rendered), excerpt: rendered, omitted: clipped.omitted, ranges: clipped.ranges })
    const cost = bytes(rendered) + (snippets.length > 1 ? 2 : 0); remaining -= cost; return cost
  }
  // Actual rendered bytes are charged. Globals share a bounded pool rather than
  // exhausting space before the directly relevant task and map are considered.
  const relevant = ordered.filter(c => c.priority === 70), map = ordered.find(c => c.priority === 10)
  const reserve = Math.min(Math.floor(budget / 3), relevant.length * 700 + (map ? 500 : 0))
  for (const c of ordered.filter(c => c.priority > 95)) emit(c, Math.min(c.cap, Math.max(0, remaining - reserve - 2)))
  const globals = ordered.filter(c => c.priority === 95)
  let globalRoom = Math.min(3000, Math.max(0, remaining - reserve - 2))
  globals.forEach((c, i) => { globalRoom -= emit(c, Math.min(c.cap, Math.floor(globalRoom / (globals.length - i)), Math.max(0, remaining - reserve - 2))) })
  relevant.forEach((c, i) => emit(c, Math.min(c.cap, Math.max(0, remaining - (map ? 500 : 0) - (relevant.length - i - 1) * 350 - 2))))
  if (map) emit(map, Math.min(map.cap, Math.max(0, remaining - 2)))
  return { id: randomUUID(), threadId, at: new Date().toISOString(), task: query.slice(0, 500), cwd: task.cwd ?? '', group: task.group ?? '', budgetBytes: budget, usedBytes: budget - remaining, snippets, omitted, injection: 'prepared', execution: 'not-observed' }
}

export function indexDocument(content: string): NoteDocument {
  return { path: 'Index.md', title: 'Knowledge map', content, revision: revisionOf(content), bytes: bytes(content), modifiedAt: '', issues: [], type: 'map', status: 'reference', scope: 'global', updated: '', sources: [], related: [], aliases: [], repositories: [], decisionKey: '', supersedes: [] }
}
