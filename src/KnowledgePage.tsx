import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Login } from './App'
import { api, ApiError, type ContextTraceSummary } from './api'
import type { Session, Thread } from './types'
import type { ContextTrace, KnowledgeSnapshot, NoteDocument, NoteVersion } from '../server/knowledge-types'
import './knowledge.css'

export const isKnowledgePath = (path: string) => path === '/knowledge' || path === '/knowledge/'
const message = (error: unknown) => error instanceof Error ? error.message : 'Không kết nối được máy chủ'
const statusLabel: Record<string, string> = { confirmed: 'Đã xác nhận', observed: 'Quan sát', proposed: 'Đề xuất', superseded: 'Đã thay thế', unclassified: 'Chưa phân loại', deployed: 'Đã triển khai', active: 'Đang làm' }
const originLabel: Record<string, string> = { baseline: 'Bản đầu được ghi nhận', external: 'Sửa trực tiếp từ file', edit: 'Chỉnh sửa', restore: 'Khôi phục' }
const date = (value: string) => new Date(value).toLocaleString('vi-VN')
const stripMeta = (text: string) => text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')

function KnowledgeMarkdown({ content, path, onSource }: { content: string; path: string; onSource: (path: string) => void }) {
  const markdown = stripMeta(content).replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, label?: string) => {
    const note = target.split('#')[0].replace(/\.md$/, '') + '.md'
    return `[${(label ?? target).replaceAll('[', '').replaceAll(']', '')}](/knowledge?note=${encodeURIComponent(note)})`
  })
  return <div className="knowledge-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => {
    if (href && !/^https?:\/\//.test(href) && !href.startsWith('#')) {
      let local = ''
      try {
        const url = new URL(href, `https://vault.local/${path}`)
        local = url.searchParams.get('note') ?? decodeURIComponent(url.pathname.slice(1))
      } catch { /* Invalid Markdown links remain inert. */ }
      return <a href={href} onClick={event => { event.preventDefault(); if (local) onSource(local) }}>{children}</a>
    }
    return <a href={href} target="_blank" rel="noreferrer">{children}</a>
  } }}>{markdown}</ReactMarkdown></div>
}

function SourceDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [source, setSource] = useState<{ path: string; content: string } | null>(null), [error, setError] = useState('')
  const sequence = useRef(0)
  useEffect(() => { dialog.current?.showModal() }, [])
  const load = useCallback((next: string) => {
    const version = ++sequence.current
    setSource(null); setError('')
    void api.knowledgeSource(next).then(value => { if (version === sequence.current) setSource(value) }).catch(reason => { if (version === sequence.current) setError(message(reason)) })
  }, [])
  useEffect(() => { load(path); return () => { sequence.current++ } }, [path, load])
  return <dialog ref={dialog} className="knowledge-dialog" onCancel={onClose} aria-label="Nguồn kiến thức">
    <header><strong>{source?.path ?? path}</strong><button className="icon-button" aria-label="Đóng nguồn" onClick={onClose}>×</button></header>
    {error ? <p role="alert">{error}</p> : source ? <KnowledgeMarkdown {...source} onSource={load} /> : <p role="status">Đang đọc nguồn…</p>}
  </dialog>
}

function Versions({ note, csrf, onRestored }: { note: NoteDocument; csrf: string; onRestored: (note: NoteDocument) => void }) {
  const [versions, setVersions] = useState<NoteVersion[]>([]), [selected, setSelected] = useState('')
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.knowledgeVersion>> | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    let active = true
    api.knowledgeVersions(note.path).then(value => { if (active) setVersions(value.versions) }).catch(reason => { if (active) setError(message(reason)) })
    return () => { active = false }
  }, [note.path, note.revision])
  useEffect(() => {
    setDetail(null)
    if (!selected) return
    let active = true
    api.knowledgeVersion(note.path, selected).then(value => { if (active) setDetail(value) }).catch(reason => { if (active) setError(message(reason)) })
    return () => { active = false }
  }, [selected, note.path, note.revision])
  const restore = async () => {
    if (!detail || !window.confirm(`Khôi phục “${note.title}” về bản ${date(detail.version.at)}? Bản hiện tại vẫn được giữ trong lịch sử.`)) return
    setBusy(true); setError('')
    try { onRestored(await api.restoreKnowledge(note.path, selected, note.revision, csrf)); setSelected('') }
    catch (reason) { setError(message(reason)) }
    finally { setBusy(false) }
  }
  return <section className="knowledge-versions"><h3>Lịch sử chỉnh sửa</h3>
    <p>Các lần sửa trực tiếp từ file được ghi nhận khi hệ thống quan sát; những lần sửa liên tiếp giữa hai lần quan sát có thể không có đủ phiên bản.</p>
    <select aria-label="Chọn phiên bản" value={selected} disabled={busy} onChange={event => { setSelected(event.target.value); setError('') }}><option value="">Chọn bản để so sánh…</option>{versions.map(version => <option key={version.id} value={version.id}>{date(version.at)} · {originLabel[version.origin]}{version.deleted ? ' · Đã xóa' : ''}</option>)}</select>
    {error && <p role="alert" className="knowledge-error">{error}</p>}
    {detail && <><p>{detail.version.actor} · {detail.version.bytes.toLocaleString()} byte</p>
      {detail.diff.changed ? <div className="knowledge-diff"><div><h4>Bản đã chọn · từ dòng {detail.diff.startLine}</h4><pre>{detail.diff.before || '(trống)'}</pre></div><div><h4>Bản hiện tại</h4><pre>{detail.diff.after || '(trống)'}</pre></div></div> : <p>Nội dung giống bản hiện tại.</p>}
      <button className="quiet-button" disabled={busy || !detail.diff.changed || detail.version.deleted} onClick={() => void restore()}>{busy ? 'Đang khôi phục…' : 'Khôi phục bản đã chọn'}</button>
    </>}
  </section>
}

function NotePanel({ path, csrf, isNew, onSaved, onSource, onDirty }: { path: string; csrf: string; isNew: boolean; onSaved: () => void; onSource: (path: string) => void; onDirty: (dirty: boolean) => void }) {
  const [note, setNote] = useState<NoteDocument | null>(null), [draft, setDraft] = useState(isNew ? '---\ntype: idea\nstatus: proposed\nscope: \nupdated: ' + new Date().toISOString().slice(0, 10) + '\nsources: []\nrelated: []\n---\n\n# Ghi chú mới\n' : '')
  const [editing, setEditing] = useState(isNew), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [conflict, setConflict] = useState<NoteDocument | null>(null)
  const dirty = editing && draft !== (note?.content ?? '')
  useEffect(() => { onDirty(dirty); return () => onDirty(false) }, [dirty, onDirty])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  useEffect(() => {
    if (isNew) return
    const controller = new AbortController()
    api.knowledgeNote(path, controller.signal).then(value => { setNote(value); setDraft(value.content) }).catch(reason => { if (!controller.signal.aborted) setError(message(reason)) })
    return () => controller.abort()
  }, [path, isNew])
  const accept = (value: NoteDocument) => { setNote(value); setDraft(value.content); setEditing(false); setConflict(null); setError(''); onSaved() }
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    try { accept(await api.saveKnowledge(path, draft, note?.revision ?? '', csrf)) }
    catch (reason) {
      setError(message(reason))
      if (reason instanceof ApiError && reason.status === 409) {
        try { setConflict(await api.knowledgeNote(path)) } catch (next) { setError(message(next)) }
      }
    } finally { setBusy(false) }
  }
  if (!note && !isNew) return <div className="knowledge-panel">{error ? <p role="alert" className="knowledge-error">{error}</p> : <p role="status">Đang đọc ghi chú…</p>}</div>
  return <article className="knowledge-panel">
    <header className="knowledge-note-header"><div><p className="knowledge-path">{path}</p><h2>{note?.title ?? 'Ghi chú mới'}</h2></div>{!editing && <button className="quiet-button" onClick={() => setEditing(true)}>Sửa ghi chú</button>}</header>
    {note && <div className="knowledge-badges"><span>{statusLabel[note.status] ?? note.status}</span><span>{note.scope || 'Chưa đặt phạm vi'}</span><span>Cập nhật {note.updated || date(note.modifiedAt)}</span></div>}
    {error && <p className="knowledge-error" role="alert">{error}</p>}
    {editing ? <form onSubmit={event => void save(event)}><label className="knowledge-editor-label">Nội dung Markdown<textarea className="knowledge-editor" aria-label="Nội dung ghi chú" value={draft} onChange={event => setDraft(event.target.value)} disabled={busy} spellCheck={false} /></label>
      {conflict && <aside className="knowledge-conflict"><h3>Có thay đổi từ nơi khác</h3><p>Bản nháp của bạn vẫn được giữ. Đối chiếu nội dung mới bên dưới và hợp nhất vào ô soạn trước khi lưu.</p><pre>{conflict.content}</pre><button className="quiet-button" type="button" onClick={() => { setNote(conflict); setConflict(null); setError('') }}>Đã hợp nhất vào bản nháp</button></aside>}
      <div className="knowledge-actions"><button className="primary-button" disabled={busy || Boolean(conflict)}>{busy ? 'Đang lưu…' : 'Lưu ghi chú'}</button>{note && <button className="quiet-button" type="button" disabled={busy} onClick={() => { setDraft(note.content); setEditing(false); setConflict(null); setError('') }}>Hủy chỉnh sửa</button>}</div>
    </form> : note && <><KnowledgeMarkdown path={path} content={note.content} onSource={onSource} />
      {note.sources.length > 0 && <section><h3>Nguồn xác nhận</h3><KnowledgeMarkdown path={path} content={note.sources.map(source => `- ${source}`).join('\n')} onSource={onSource} /></section>}
      {note.issues.length > 0 && <details><summary>Cần kiểm tra ({note.issues.length})</summary><ul>{note.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></details>}
      <Versions note={note} csrf={csrf} onRestored={accept} />
    </>}
  </article>
}

function TraceView({ trace, onSource }: { trace: ContextTrace; onSource: (path: string) => void }) {
  return <section className="knowledge-panel"><h2>Context đã chọn</h2><p>{trace.task || '(Lượt không có nội dung văn bản)'}</p><p>{date(trace.at)} · {trace.group || 'Chưa phân nhóm'} · {trace.usedBytes.toLocaleString()} / {trace.budgetBytes.toLocaleString()} byte</p>
    {trace.snippets.map(snippet => <details className="knowledge-snippet" key={snippet.path}><summary><strong>{snippet.title}</strong> <span>{statusLabel[snippet.status] ?? snippet.status} · {snippet.bytes.toLocaleString()} byte{snippet.omitted ? ' · Trích đoạn' : ''}</span></summary><p>{snippet.scope || 'Chưa đặt phạm vi'} · {snippet.reason.join(' · ')}</p><pre>{snippet.excerpt}</pre><button className="quiet-button" onClick={() => onSource(snippet.path)}>Đọc nguồn hiện tại</button></details>)}
    {trace.omitted.length > 0 && <details><summary>Note không được nạp ({trace.omitted.length})</summary><ul>{trace.omitted.map((note, index) => <li key={`${note.path}:${index}`}>{note.path}: {note.reason}</li>)}</ul></details>}
  </section>
}

function KnowledgeWorkspace({ session }: { session: Session }) {
  const [snapshot, setSnapshot] = useState<KnowledgeSnapshot | null>(null), [error, setError] = useState('')
  const [tab, setTab] = useState('notes'), [search, setSearch] = useState(''), [filter, setFilter] = useState('all')
  const [path, setPath] = useState(new URLSearchParams(location.search).get('note') ?? ''), [isNew, setIsNew] = useState(false)
  const [source, setSource] = useState(''), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false)
  const [traces, setTraces] = useState<ContextTraceSummary[]>([]), [trace, setTrace] = useState<ContextTrace | null>(null)
  const [threads, setThreads] = useState<Thread[]>([]), [threadId, setThreadId] = useState(''), [query, setQuery] = useState('')
  const [newPath, setNewPath] = useState(''), [creating, setCreating] = useState(false), [reloadKey, setReloadKey] = useState(0)
  const requestVersion = useRef(0)
  const refresh = useCallback(() => {
    setError('')
    void api.knowledge().then(setSnapshot).catch(reason => setError(message(reason)))
  }, [])
  useEffect(refresh, [refresh])
  useEffect(() => {
    let active = true
    Promise.all([api.knowledgeTraces(), api.threads()]).then(([history, list]) => { if (active) { setTraces(history.traces); setThreads(list.data); setThreadId(list.data[0]?.id ?? '') } }).catch(reason => { if (active) setError(message(reason)) })
    return () => { active = false }
  }, [])
  const leave = () => !dirty || window.confirm('Bản nháp chưa lưu. Rời ghi chú này?')
  const select = (next: string, fresh = false) => { if (!leave()) return; setPath(next); setIsNew(fresh); setDirty(false); history.replaceState(null, '', `/knowledge?note=${encodeURIComponent(next)}`) }
  const changeTab = (next: string) => { if (next === tab || !leave()) return; requestVersion.current++; setBusy(false); setTab(next); setDirty(false); setTrace(null) }
  const openTrace = async (id: string) => {
    const version = ++requestVersion.current; setBusy(true); setError('')
    try { const result = await api.knowledgeTrace(id); if (version === requestVersion.current) setTrace(result) }
    catch (reason) { if (version === requestVersion.current) setError(message(reason)) }
    finally { if (version === requestVersion.current) setBusy(false) }
  }
  const preview = async (event: FormEvent) => {
    event.preventDefault(); const version = ++requestVersion.current; setBusy(true); setError('')
    try { const result = await api.previewKnowledge(threadId, query, session.csrf); if (version === requestVersion.current) setTrace(result) }
    catch (reason) { if (version === requestVersion.current) setError(message(reason)) }
    finally { if (version === requestVersion.current) setBusy(false) }
  }
  const visible = snapshot?.notes.filter(note => (filter === 'all' || note.status === filter) && `${note.title} ${note.path} ${note.scope} ${note.aliases.join(' ')}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ?? []
  return <main className="knowledge-page"><div className="knowledge-container">
    <nav className="knowledge-nav"><a href="/">← Codex Remote</a><a href="/services">Services ↗</a></nav>
    <header className="knowledge-heading"><div><p className="knowledge-eyebrow">SECOND BRAIN</p><h1>Knowledge</h1><p>Kiến thức được ghi nhớ, nguồn xác nhận và những gì đã dùng trong mỗi cuộc hội thoại.</p></div><button className="quiet-button" onClick={() => { if (leave()) { setReloadKey(value => value + 1); refresh(); void api.knowledgeTraces().then(value => setTraces(value.traces)).catch(reason => setError(message(reason))) } }}>↻ Làm mới</button></header>
    <div className="knowledge-summary"><span><strong>{snapshot?.notes.length ?? '—'}</strong> ghi chú</span><span><strong>{snapshot?.notes.filter(note => note.status === 'confirmed').length ?? '—'}</strong> đã xác nhận</span><span><strong>{snapshot?.issues.length ?? '—'}</strong> mục cần kiểm tra</span></div>
    <nav className="knowledge-tabs" aria-label="Mục kiến thức">{[['notes', 'Ghi chú'], ['traces', 'Context đã dùng'], ['preview', 'Kiểm tra truy xuất'], ['issues', 'Cần kiểm tra']].map(([key, label]) => <button key={key} className={tab === key ? 'is-active' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => changeTab(key)}>{label}</button>)}</nav>
    {error && <p className="knowledge-error" role="alert">{error}</p>}
    {tab === 'notes' && <>
      <div className="knowledge-filters"><input type="search" aria-label="Tìm ghi chú" placeholder="Tìm tên, chủ đề hoặc phạm vi…" value={search} onChange={event => setSearch(event.target.value)} /><select aria-label="Lọc trạng thái" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Mọi trạng thái</option>{[...new Set(snapshot?.notes.map(note => note.status))].map(status => <option key={status} value={status}>{statusLabel[status] ?? status}</option>)}</select><button className="quiet-button" onClick={() => setCreating(value => !value)}>+ Ghi chú</button></div>
      {creating && <form className="knowledge-create" onSubmit={event => { event.preventDefault(); select(newPath, true); setCreating(false) }}><label>Đường dẫn ghi chú<input required pattern="(?:Profile|Patterns|Projects|Ideas|Decisions|References|Inbox)/[A-Za-z0-9_/-]+\.md" placeholder="Ideas/New-Idea.md" value={newPath} onChange={event => setNewPath(event.target.value)} /></label><button className="primary-button">Soạn ghi chú</button></form>}
      <div className="knowledge-layout"><aside className="knowledge-list" aria-label="Danh sách ghi chú">{visible.map(note => <button key={note.path} className={path === note.path ? 'is-selected' : ''} onClick={() => select(note.path)}><strong>{note.title}</strong><span>{statusLabel[note.status] ?? note.status} · {note.scope || note.path.split('/')[0]}</span><small>{note.path}</small></button>)}{!visible.length && <p>{snapshot ? 'Không có ghi chú phù hợp.' : 'Đang tải ghi chú…'}</p>}</aside>
        {path ? <NotePanel key={path + String(isNew) + reloadKey} path={path} isNew={isNew} csrf={session.csrf} onSaved={() => { setIsNew(false); refresh() }} onSource={setSource} onDirty={setDirty} /> : <div className="knowledge-empty">Chọn ghi chú để đọc nguồn, chỉnh sửa hoặc xem lịch sử.</div>}
      </div>
    </>}
    {tab === 'traces' && <><div className="knowledge-filters"><select aria-label="Chọn lượt context" disabled={busy} defaultValue="" onChange={event => { if (event.target.value) void openTrace(event.target.value) }}><option value="">Chọn lượt đã nạp context…</option>{traces.map(item => <option key={item.id} value={item.id}>{date(item.at)} · {threads.find(thread => thread.id === item.threadId)?.name ?? item.threadId} · {item.task.slice(0, 70)}</option>)}</select><button className="quiet-button" onClick={() => void api.knowledgeTraces().then(value => setTraces(value.traces)).catch(reason => setError(message(reason)))}>Cập nhật danh sách</button></div><p>Giữ 100 lượt nạp gần nhất. Trích đoạn bên dưới là bản đã nạp lúc đó; nguồn hiện tại có thể đã thay đổi.</p>{!traces.length && <p>Chưa có lượt được ghi nhận. Danh sách sẽ xuất hiện sau lượt chat đầu tiên dùng bản nâng cấp.</p>}</>}
    {tab === 'preview' && <form className="knowledge-preview" onSubmit={event => void preview(event)}><label>Cuộc hội thoại<select aria-label="Cuộc hội thoại kiểm tra" required value={threadId} onChange={event => setThreadId(event.target.value)}>{threads.map(thread => <option key={thread.id} value={thread.id}>{thread.name || thread.preview || thread.id}</option>)}</select></label><label>Câu hỏi cần kiểm tra<textarea required rows={3} maxLength={8000} value={query} onChange={event => setQuery(event.target.value)} placeholder="Ví dụ: sau khi PR merge thì cần dọn những gì?" /></label><button className="primary-button" disabled={busy || !threadId}>{busy ? 'Đang chọn kiến thức…' : 'Xem thử context'}</button><p>Xem những nguồn sẽ được chọn, không gửi câu hỏi vào convo. Việc chọn nguồn đúng chưa bảo đảm câu trả lời của model luôn đúng.</p></form>}
    {busy && <p role="status">Đang tải context…</p>}
    {(tab === 'traces' || tab === 'preview') && trace && <TraceView trace={trace} onSource={setSource} />}
    {tab === 'issues' && <section className="knowledge-panel"><h2>Những điểm cần đối chiếu</h2><p>Đây là dấu hiệu cần xem lại, chưa phải kết luận ghi chú sai. Hệ thống kiểm tra nguồn, liên kết, trạng thái, ngày sửa, nội dung trùng và khóa quyết định.</p>{snapshot?.issues.length ? <ul className="knowledge-issues">{snapshot.issues.map((issue, index) => <li key={index}><button onClick={() => { if (leave()) { setTab('notes'); select(issue.path) } }}>{issue.path}</button><p>{issue.message}</p></li>)}</ul> : <p>Chưa phát hiện điểm cần kiểm tra.</p>}</section>}
    {source && <SourceDialog key={source} path={source} onClose={() => setSource('')} />}
  </div></main>
}

export function KnowledgePage() {
  const [session, setSession] = useState<Session | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('')
  useEffect(() => {
    document.title = 'Knowledge · Codex Remote'
    let active = true
    api.session().then(value => { if (active) setSession(value) }).catch(reason => { if (active && !(reason instanceof ApiError && reason.status === 401)) setError(message(reason)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  if (loading) return <main className="login-shell"><p role="status">Đang mở Knowledge…</p></main>
  if (!session) return <><Login installPrompt={null} offline={!navigator.onLine} onInstall={() => undefined} onLogin={setSession} />{error && <p role="alert">{error}</p>}</>
  return <KnowledgeWorkspace session={session} />
}
