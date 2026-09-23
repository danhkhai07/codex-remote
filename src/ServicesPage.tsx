import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import { secureIntent } from './secureApi'
import { api, ApiError } from './api'
import { navigateReservedBrowserTab, reserveBrowserTab } from './browserExternalTab'
import { Login } from './App'
import { LocalhostPreview } from './LocalhostPreview'
import type { ServiceInput, ServicesSnapshot } from '../server/services'
import type { Session } from './types'
import './services.css'

export function isServicesPath(path: string) { return path === '/services' || path === '/services/' }
const blank: ServiceInput = { port: 3000, name: '', summary: '', prLabel: '', prUrl: '', branch: '', directory: '', path: '/', kind: 'app' }
const message = (error: unknown) => error instanceof Error ? error.message : 'Không kết nối được máy chủ'
const keyOf = (service: ServiceInput) => service.port === null ? `path:${service.path}` : `port:${service.port}`
type ServiceView = ServicesSnapshot['services'][number]

function ServiceEditor({ initial, existing, csrf, onClose, onSaved }: {
  initial: ServiceInput; existing: boolean; csrf: string; onClose: () => void; onSaved: () => void
}) {
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  const field = (name: keyof ServiceInput, text: string) => setValue(current => ({ ...current, [name]: text }))
  const submit = async (event: FormEvent) => {
    event.preventDefault(); const intent = secureIntent(); intent.assert(); setBusy(true); setError('')
    try { await api.saveService(value, csrf); intent.assert(); onSaved(); onClose() }
    catch (reason) { setError(message(reason)) }
    finally { setBusy(false) }
  }
  return <dialog ref={dialog} className="service-editor" onCancel={event => { event.preventDefault(); if (!busy) onClose() }} aria-labelledby="service-editor-title">
    <form onSubmit={event => void submit(event)}>
      <header><h2 id="service-editor-title">{existing ? 'Sửa dịch vụ' : 'Thêm dịch vụ / trang'}</h2><button type="button" className="icon-button" disabled={busy} onClick={onClose} aria-label="Đóng biểu mẫu">×</button></header>
      <fieldset disabled={busy}>
        <label>Loại địa chỉ<select value={value.port === null ? 'path' : 'port'} disabled={existing} onChange={event => setValue(current => ({ ...current, port: event.target.value === 'path' ? null : 3000 }))}><option value="port">App localhost theo port</option><option value="path">Trang trên Codex Remote</option></select></label>
        <label>Tên dịch vụ<input autoFocus required maxLength={120} value={value.name} onChange={event => field('name', event.target.value)} placeholder="Kiotclone · Mẫu in" /></label>
        <div className="service-form-row">
          {value.port !== null && <label>Port<input required type="number" min={1024} max={65535} disabled={existing} value={value.port} onChange={event => setValue(current => ({ ...current, port: Number(event.target.value) }))} /></label>}
          <label>Đường dẫn<input required maxLength={2000} disabled={existing && value.port === null} value={value.path} onChange={event => field('path', event.target.value)} placeholder="/working-hours" /></label>
          <label>Loại dịch vụ<select value={value.kind} onChange={event => field('kind', event.target.value)}><option value="app">Ứng dụng</option><option value="prototype">Bản mẫu</option><option value="api">API</option></select></label>
        </div>
        <label>Nội dung công việc<textarea required maxLength={2000} rows={3} value={value.summary} onChange={event => field('summary', event.target.value)} placeholder="Bản này đang làm gì, cần kiểm tra phần nào?" /></label>
        <label>PR / công việc<input required maxLength={200} value={value.prLabel} onChange={event => field('prLabel', event.target.value)} placeholder="PR #125 · PRINT-01, hoặc Không có PR" /></label>
        <label>Link PR<input type="url" maxLength={1000} value={value.prUrl} onChange={event => field('prUrl', event.target.value)} placeholder="https://github.com/…/pull/125" /></label>
        <label>Branch<input maxLength={300} value={value.branch} onChange={event => field('branch', event.target.value)} /></label>
        <label>Thư mục dự án<input maxLength={1000} value={value.directory} onChange={event => field('directory', event.target.value)} /></label>
      </fieldset>
      {error && <p role="alert" className="services-error">{error}</p>}
      <footer><button className="quiet-button" type="button" disabled={busy} onClick={onClose}>Hủy</button><button className="primary-button" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu dịch vụ'}</button></footer>
    </form>
  </dialog>
}

export function ServicesPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [snapshot, setSnapshot] = useState<ServicesSnapshot | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [editing, setEditing] = useState<{ value: ServiceInput; existing: boolean } | null>(null)
  const [browser, setBrowser] = useState<string | null>(null)
  const [removing, setRemoving] = useState('')
  const inFlight = useRef(false)
  const externalRequest = useRef<AbortController | null>(null)
  const externalTab = useRef<Window | null>(null)
  useEffect(() => {
    document.title = 'Services · Codex Remote'
    let active = true
    api.session().then(value => { if (active) setSession(value) }).catch(reason => {
      if (active && !(reason instanceof ApiError && reason.status === 401)) setError(message(reason))
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; externalRequest.current?.abort(); externalTab.current?.close() }
  }, [])
  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true; setRefreshing(true)
    try { setSnapshot(await api.services()); setError('') }
    catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) { setSession(null); setSnapshot(null) }
      setError(message(reason))
    } finally { inFlight.current = false; setRefreshing(false) }
  }, [])
  useEffect(() => {
    if (!session) return
    void refresh()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 30_000)
    return () => clearInterval(timer)
  }, [session, refresh])
  if (loading) return <main className="login-shell"><p role="status">Đang mở Services…</p></main>
  if (!session) return <><Login installPrompt={null} offline={!navigator.onLine} onInstall={() => undefined} onLogin={setSession} />{error && <p className="services-error" role="alert">{error}</p>}</>
  const services = snapshot?.services ?? []
  const visible = services.filter(service => {
    const query = search.trim().toLocaleLowerCase('vi')
    return (!query || [service.name, service.summary, service.prLabel, service.branch, service.path, service.port].join(' ').toLocaleLowerCase('vi').includes(query)) &&
      (filter === 'all' || (filter === 'pages' ? service.port === null : filter === 'running' ? service.running === true : service.running === false))
  })
  const remove = async (service: ServiceInput) => {
    if (!window.confirm(`Xóa “${service.name}” khỏi danh sách? Dịch vụ vẫn tiếp tục chạy.`)) return
    const intent = secureIntent(); intent.assert()
    setRemoving(keyOf(service))
    try { await api.removeService(keyOf(service), session.csrf); intent.assert(); await refresh() }
    catch (reason) { setError(message(reason)) }
    finally { setRemoving('') }
  }
  const serviceAddress = (service: ServiceInput) => service.port === null ? service.path : `http://localhost:${service.port}${service.path}`
  const openServiceInTab = async (event: MouseEvent<HTMLButtonElement>, service: ServiceView) => {
    if (event.button !== 1 || service.running === false) return
    event.preventDefault()
    if (externalRequest.current) return
    let reserved
    try { reserved = reserveBrowserTab(serviceAddress(service)) }
    catch (reason) { setError(message(reason)); return }
    const controller = new AbortController()
    externalRequest.current = controller
    externalTab.current = reserved.tab
    setError('')
    try { await navigateReservedBrowserTab(reserved, session.csrf, controller.signal) }
    catch (reason) { if (!controller.signal.aborted) setError(message(reason)) }
    finally {
      if (externalRequest.current === controller) {
        externalRequest.current = null
        externalTab.current = null
      }
    }
  }
  return <main className="services-page">
    <div className="services-container">
      <nav className="services-nav"><a href="/">← Codex Remote</a><button className="quiet-button" onClick={() => setBrowser('')}>Browser ↗</button></nav>
      <header className="services-heading"><div><p className="services-eyebrow">WORKSPACE</p><h1>Services</h1><p>App đang host, bản review theo PR và các trang của Codex Remote.</p></div><button className="primary-button" onClick={() => setEditing({ value: { ...blank }, existing: false })}>+ Thêm dịch vụ</button></header>
      <div className="services-summary"><span><strong>{services.filter(service => service.running).length}</strong> đang chạy</span><span><strong>{services.filter(service => service.port === null).length}</strong> trang nội bộ</span><span><strong>{services.filter(service => service.running === false).length}</strong> đã dừng</span></div>
      <div className="services-filters"><input aria-label="Tìm dịch vụ" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm tên, port, PR hoặc nội dung…" /><select aria-label="Lọc dịch vụ" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Tất cả</option><option value="running">Đang chạy</option><option value="stopped">Đã dừng</option><option value="pages">Trang nội bộ</option></select><button className="quiet-button" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? 'Đang kiểm tra…' : '↻ Làm mới'}</button></div>
      {error && <p className="services-error" role="alert">{error}</p>}
      <div className="services-grid">
        {visible.map(service => <article key={keyOf(service)} className="service-card">
          <div className="service-card-top"><span className={`service-status ${service.running ? 'is-running' : service.running === false ? 'is-stopped' : ''}`}>{service.running === null ? 'Trang nội bộ' : service.running ? '● Đang chạy' : '○ Đã dừng'}</span><code>{service.port === null ? service.path : `:${service.port}`}</code></div>
          <h2>{service.name}</h2><p className="service-summary">{service.summary}</p>
          <p className="service-pr">{service.prUrl ? <a href={service.prUrl} onClick={event => { event.preventDefault(); setBrowser(service.prUrl) }}>{service.prLabel} ↗</a> : service.prLabel}</p>
          {(service.branch || service.directory) && <details><summary>Chi tiết triển khai</summary>{service.branch && <p>Branch: <code>{service.branch}</code></p>}{service.directory && <p>Thư mục: <code>{service.directory}</code></p>}<p>Cập nhật: {new Date(service.updatedAt).toLocaleString('vi-VN')}</p></details>}
          <div className="service-card-actions"><button className="primary-button" disabled={service.running === false} onClick={() => setBrowser(serviceAddress(service))} onAuxClick={event => void openServiceInTab(event, service)}>Mở trong Browser</button><button className="quiet-button" onClick={() => setEditing({ value: service, existing: true })}>Sửa</button><button className="quiet-button service-remove" disabled={Boolean(removing)} onClick={() => void remove(service)}>Xóa</button></div>
        </article>)}
      </div>
      {!visible.length && <p className="services-empty">{snapshot ? services.length ? 'Không có dịch vụ phù hợp.' : 'Chưa có dịch vụ. Thêm app hoặc đường dẫn đầu tiên.' : 'Đang tải danh sách…'}</p>}
      {snapshot && <p className="services-updated">Kiểm tra lúc {new Date(snapshot.checkedAt).toLocaleTimeString('vi-VN')} · Tự cập nhật mỗi 30 giây</p>}
    </div>
    {editing && <ServiceEditor initial={editing.value} existing={editing.existing} csrf={session.csrf} onClose={() => setEditing(null)} onSaved={() => void refresh()} />}
    {browser !== null && <LocalhostPreview scope="services" initialUrl={browser || undefined} csrf={session.csrf} onNavigate={setBrowser} onClose={() => setBrowser(null)} />}
  </main>
}
