import { randomUUID } from 'node:crypto'
import { KNOWLEDGE_SECTIONS } from './knowledge-vault.js'
import { fold, metadata, noteBody, revisionOf, titleOf, wikiTargets } from './knowledge-metadata.js'
import { KnowledgeError, VaultFiles } from './vault-files.js'
import type { ContextTrace, KnowledgeNote, KnowledgeSnapshot, NoteDocument, NoteVersion } from './knowledge-types.js'

export const MAX_NOTE_BYTES = 256_000
const controlFiles = new Set(['00_Home.md', 'README.md', 'Knowledge-Workflow.md', 'AGENTS.md'])
const topicFolders = Object.keys(KNOWLEDGE_SECTIONS)
type History = { path: string; head: string | null; versions: NoteVersion[] }

export class KnowledgeStore {
  readonly files: VaultFiles
  constructor(root: string) { this.files = new VaultFiles(root) }

  notePath(path: string) {
    if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) || part === '.' || part === '..') || !path.endsWith('.md')) throw new KnowledgeError(400, 'Invalid knowledge note path')
    const parts = path.split('/')
    const allowed = controlFiles.has(path) || (topicFolders.includes(parts[0]) && parts.length >= 2 && parts.at(-1) !== 'Index.md') ||
      path === 'Shared/Context.md' || (['Groups', 'Conversations'].includes(parts[0]) && parts.length === 3 && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(parts[1]) && parts[2] === 'Context.md')
    if (!allowed) throw new KnowledgeError(400, 'Generated files and transcripts cannot be edited here')
    this.files.inspect(path)
    return path
  }

  private statePath(path: string) { return `.state/Knowledge/Notes/${revisionOf(path)}/History.json` }
  private versionPath(path: string, revision: string) { return `.state/Knowledge/Notes/${revisionOf(path)}/${revision}.md` }
  private history(path: string): History {
    const saved = this.files.read(this.statePath(path))
    return saved ? JSON.parse(saved) as History : { path, head: null, versions: [] }
  }
  private observe(path: string, content: string | undefined, origin: NoteVersion['origin'] = 'external', actor = 'filesystem') {
    const history = this.history(path)
    const revision = content === undefined ? null : revisionOf(content)
    if (history.head === revision) return history
    if (content !== undefined && Buffer.byteLength(content) > MAX_NOTE_BYTES) return history
    const version: NoteVersion = { id: randomUUID(), revision: revision ?? '', at: new Date().toISOString(), origin: history.versions.length ? origin : 'baseline', actor, bytes: Buffer.byteLength(content ?? ''), ...(content === undefined ? { deleted: true } : {}) }
    // Content is saved before publishing the history entry. Equal contents share one blob.
    if (content !== undefined && this.files.read(this.versionPath(path, revision!)) === undefined) this.files.write(this.versionPath(path, revision!), content)
    const next = { path, head: revision, versions: [...history.versions, version] }
    this.files.write(this.statePath(path), JSON.stringify(next))
    return next
  }

  paths(): string[] {
    const result: string[] = []
    const walk = (directory: string) => {
      for (const name of this.files.list(directory)) {
        const path = `${directory}/${name}`
        try {
          const stat = this.files.inspect(path)
          if (stat?.isDirectory()) walk(path)
          else if (stat?.isFile() && name.endsWith('.md') && name !== 'Index.md') result.push(path)
        } catch (error) { if (!(error instanceof KnowledgeError)) throw error }
      }
    }
    for (const folder of topicFolders) walk(folder)
    for (const path of [...controlFiles, 'Shared/Context.md']) if (this.files.inspect(path)?.isFile()) result.push(path)
    for (const folder of ['Groups', 'Conversations']) {
      for (const id of this.files.list(folder)) {
        const path = `${folder}/${id}/Context.md`
        try { if (this.files.inspect(path)?.isFile()) result.push(path) } catch (error) { if (!(error instanceof KnowledgeError)) throw error }
      }
    }
    return result.sort()
  }

  read(path: string): NoteDocument {
    this.notePath(path)
    const stat = this.files.inspect(path)
    if (!stat) throw new KnowledgeError(404, 'Knowledge note not found')
    if (stat.size > MAX_NOTE_BYTES) throw new KnowledgeError(413, 'Note exceeds the 256 KB limit; split it by subject')
    const content = this.files.read(path)!
    this.observe(path, content)
    const meta = metadata(content), issues: string[] = []
    if (topicFolders.includes(path.split('/')[0])) {
      if (!meta.scope) issues.push('Thiếu phạm vi áp dụng')
      if (meta.status === 'unclassified') issues.push('Chưa phân loại mức độ xác nhận')
      if (meta.status === 'confirmed' && !meta.sources.length) issues.push('Đã xác nhận nhưng chưa ghi nguồn')
      if (meta.updated && /^\d{4}-\d{2}-\d{2}$/.test(meta.updated) && meta.updated < stat.mtime.toISOString().slice(0, 10)) issues.push('Ngày updated cũ hơn lần sửa file; cần kiểm tra')
    }
    for (const target of new Set(wikiTargets(content))) {
      const local = target.split('#')[0]
      if (!local) continue
      try { if (!this.files.inspect(`${local}.md`)) issues.push(`Liên kết chưa có đích: ${local}`) } catch { issues.push(`Liên kết không hợp lệ: ${local}`) }
    }
    return { ...meta, path, title: titleOf(path, content), revision: revisionOf(content), bytes: stat.size, modifiedAt: stat.mtime.toISOString(), issues, content }
  }

  documents(): NoteDocument[] {
    const notes: NoteDocument[] = []
    for (const path of this.paths()) {
      try { notes.push(this.read(path)) } catch (error) { if (!(error instanceof KnowledgeError && error.status === 413)) throw error }
    }
    return notes
  }
  snapshot(): KnowledgeSnapshot {
    const docs = this.documents()
    const issues = docs.flatMap(note => note.issues.map(message => ({ path: note.path, message })))
    const keys = new Map<string, NoteDocument[]>(), contents = new Map<string, NoteDocument[]>()
    for (const note of docs) {
      for (const target of note.supersedes) {
        const path = (wikiTargets(target)[0] ?? target).split('#')[0].replace(/\.md$/, '') + '.md'
        const previous = docs.find(other => other.path === path)
        if (previous && previous.status !== 'superseded') issues.push({ path: previous.path, message: `${note.path} chỉ định thay thế note này; cần đối chiếu nguồn và cập nhật trạng thái` })
      }
      if (note.status === 'confirmed' && note.decisionKey) {
        const key = `${fold(note.scope)}:${note.decisionKey}`
        keys.set(key, [...(keys.get(key) ?? []), note])
      }
      const body = noteBody(note.content).trim()
      if (body.length > 100 && topicFolders.includes(note.path.split('/')[0])) contents.set(revisionOf(body), [...(contents.get(revisionOf(body)) ?? []), note])
    }
    for (const notes of keys.values()) if (notes.length > 1) for (const note of notes) issues.push({ path: note.path, message: `Cùng khóa quyết định và phạm vi với ${notes.filter(other => other !== note).map(other => other.path).join(', ')}; cần xem có mâu thuẫn không` })
    for (const notes of contents.values()) if (notes.length > 1) for (const note of notes) issues.push({ path: note.path, message: 'Nội dung trùng với một note khác' })
    for (const path of this.paths()) if ((this.files.inspect(path)?.size ?? 0) > MAX_NOTE_BYTES) issues.push({ path, message: 'Note vượt 256 KB; cần tách chủ đề để có thể nạp' })
    return { notes: docs.map(({ content: _content, ...note }) => note), issues, observedAt: new Date().toISOString() }
  }

  save(path: string, content: unknown, expectedRevision: unknown, actor = 'user'): NoteDocument {
    this.notePath(path)
    if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_NOTE_BYTES) throw new KnowledgeError(400, 'Content must be text up to 256 KB')
    if (typeof expectedRevision !== 'string') throw new KnowledgeError(400, 'Provide the revision from the last read (empty string for a new note)')
    // These operations are synchronous in the single gateway writer. External writers are
    // checked at the last possible moment; direct filesystem writes cannot be made transactional.
    const current = this.files.read(path)
    this.observe(path, current)
    if ((current === undefined ? '' : revisionOf(current)) !== expectedRevision) throw new KnowledgeError(409, 'Note changed since you read it. Reload the latest note and merge your changes before saving.')
    this.files.write(path, content)
    this.observe(path, content, 'edit', actor.slice(0, 200))
    return this.read(path)
  }
  versions(path: string): NoteVersion[] {
    this.notePath(path)
    this.observe(path, this.files.read(path))
    return [...this.history(path).versions].reverse()
  }
  version(path: string, id: string): { version: NoteVersion; content: string } {
    this.notePath(path)
    const version = this.versions(path).find(entry => entry.id === id)
    if (!version) throw new KnowledgeError(404, 'Note version not found')
    return { version, content: version.deleted ? '' : this.files.read(this.versionPath(path, version.revision)) ?? '' }
  }
  restore(path: string, id: string, expectedRevision: unknown, actor = 'user'): NoteDocument {
    const saved = this.version(path, id)
    if (saved.version.deleted) throw new KnowledgeError(400, 'Select a version with note content')
    const before = this.history(path).head
    const note = this.save(path, saved.content, expectedRevision, actor)
    const history = this.history(path), last = history.versions.at(-1)!
    if (before !== note.revision && last.origin === 'edit') {
      last.origin = 'restore'
      this.files.write(this.statePath(path), JSON.stringify(history))
    }
    return note
  }

  source(path: string): { path: string; content: string } {
    const generated = /^(?:Index|Sources)\.md$/.test(path) || /^(?:Profile|Patterns|Projects|Ideas|Decisions|References|Inbox)\/Index\.md$/.test(path) || /^(?:Conversations|Groups)\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}\/Index\.md$/.test(path) || /^Conversations\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}\/Turns\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}\.md$/.test(path)
    if (!generated) this.notePath(path)
    const stat = this.files.inspect(path)
    if (!stat) throw new KnowledgeError(404, 'Knowledge source not found')
    if (stat.size > 2_000_000) throw new KnowledgeError(413, 'Source is too large for this viewer; open the file from Files')
    return { path, content: this.files.read(path)! }
  }

  /** Polling also records deletions; intermediate direct writes between observations can be missed. */
  captureExternal() {
    this.documents()
    for (const directory of this.files.list('.state/Knowledge/Notes')) {
      const saved = this.files.read(`.state/Knowledge/Notes/${directory}/History.json`)
      if (!saved) continue
      const history = JSON.parse(saved) as History
      this.notePath(history.path)
      this.observe(history.path, this.files.read(history.path))
    }
  }
  recordTrace(trace: ContextTrace) {
    const path = '.state/Knowledge/Context-Traces.json'
    const previous = JSON.parse(this.files.read(path) ?? '[]') as ContextTrace[]
    this.files.write(path, JSON.stringify([trace, ...previous].slice(0, 100)))
  }
  traces(threadId?: string): ContextTrace[] {
    const traces = JSON.parse(this.files.read('.state/Knowledge/Context-Traces.json') ?? '[]') as ContextTrace[]
    return threadId ? traces.filter(trace => trace.threadId === threadId) : traces
  }
}

/** A bounded changed range suitable for review, with line numbers and unchanged context. */
export function noteDiff(before: string, after: string) {
  const left = before.split('\n'), right = after.split('\n')
  let start = 0, end = 0
  while (start < left.length && start < right.length && left[start] === right[start]) start++
  while (end < left.length - start && end < right.length - start && left[left.length - 1 - end] === right[right.length - 1 - end]) end++
  return { changed: before !== after, startLine: start + 1, before: left.slice(start, left.length - end).join('\n'), after: right.slice(start, right.length - end).join('\n') }
}

export function noteSummary(note: KnowledgeNote) { return `${note.title} (${note.status}; ${note.scope || 'unspecified scope'})` }
