import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { api, type PreviewShare, type PreviewSharesSnapshot } from './api'
import {
  PREVIEW_SHARE_LIFETIMES,
  PREVIEW_SHARE_PATH_MAX_BYTES,
  clockNow,
  previewShareIsActive,
  previewShareStatusLabel,
  previewShareTimeLeft,
  serverClock,
  utf8ByteLength,
  type ServerClock,
} from './previewShares'

const formatDateTime = (value: string) => new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh',
}).format(new Date(value))

const message = (error: unknown) => error instanceof Error ? error.message : 'Không tải được link chia sẻ'

export function PreviewSharesDialog({ csrf, online, trigger, onClose }: {
  csrf: string
  online: boolean
  trigger: HTMLElement | null
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const serviceSelect = useRef<HTMLSelectElement>(null)
  const lifetime = useRef<AbortController | null>(null)
  const loadRequest = useRef<AbortController | null>(null)
  const createLocked = useRef(false)
  const revokeLocked = useRef(new Set<string>())
  const mutationCount = useRef(0)
  const mutationRevision = useRef(0)
  const [snapshot, setSnapshot] = useState<PreviewSharesSnapshot | null>(null)
  const [clock, setClock] = useState<ServerClock>(() => serverClock(new Date().toISOString()))
  const [now, setNow] = useState(Date.now())
  const [servicePort, setServicePort] = useState('')
  const [label, setLabel] = useState('')
  const [path, setPath] = useState('')
  const [ttlSeconds, setTtlSeconds] = useState(60 * 60)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    const activeLifetime = lifetime.current
    if (!activeLifetime || activeLifetime.signal.aborted || mutationCount.current > 0) return
    loadRequest.current?.abort()
    const controller = new AbortController()
    loadRequest.current = controller
    const revision = mutationRevision.current
    const signal = AbortSignal.any([activeLifetime.signal, controller.signal])
    const current = () => !signal.aborted && lifetime.current === activeLifetime && mutationCount.current === 0 && mutationRevision.current === revision
    setLoading(true)
    setError('')
    try {
      const value = await api.previewShares(signal)
      if (!current()) return
      const nextClock = serverClock(value.serverNow)
      setSnapshot(value)
      setClock(nextClock)
      setNow(clockNow(nextClock))
      setServicePort(current => current && value.services.some(service => String(service.port) === current)
        ? current
        : String(value.services.find(service => service.running !== false)?.port ?? value.services[0]?.port ?? ''))
      requestAnimationFrame(() => serviceSelect.current?.focus())
    } catch (reason) {
      if (current()) setError(message(reason))
    } finally {
      if (loadRequest.current === controller) loadRequest.current = null
      if (!activeLifetime.signal.aborted && lifetime.current === activeLifetime) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const activeLifetime = new AbortController()
    lifetime.current = activeLifetime
    const element = dialog.current
    element?.showModal()
    void load()
    return () => {
      loadRequest.current?.abort()
      activeLifetime.abort()
      if (lifetime.current === activeLifetime) lifetime.current = null
      element?.close()
      requestAnimationFrame(() => { if (!lifetime.current && trigger?.isConnected) trigger.focus({ preventScroll: true }) })
    }
  }, [load, trigger])

  useEffect(() => {
    const tick = () => setNow(clockNow(clock))
    tick()
    const interval = window.setInterval(tick, 30_000)
    return () => window.clearInterval(interval)
  }, [clock])

  const selectedService = snapshot?.services.find(service => String(service.port) === servicePort)
  useEffect(() => { if (selectedService) setPath(selectedService.path || '/') }, [selectedService])
  const submittedPath = path || selectedService?.path || '/'
  const pathBytes = utf8ByteLength(submittedPath)
  const pathTooLong = pathBytes > PREVIEW_SHARE_PATH_MAX_BYTES

  const activeLinks = useMemo(() => snapshot?.links.filter(link => previewShareIsActive(link, now)) ?? [], [snapshot, now])
  const closedLinks = useMemo(() => snapshot?.links.filter(link => !previewShareIsActive(link, now)) ?? [], [snapshot, now])

  async function create(event: FormEvent) {
    event.preventDefault()
    const activeLifetime = lifetime.current
    if (createLocked.current || !activeLifetime || activeLifetime.signal.aborted || !online || !csrf || !selectedService || pathTooLong) return
    createLocked.current = true
    mutationCount.current++
    mutationRevision.current++
    setCreating(true)
    setError('')
    setNotice('')
    try {
      const result = await api.createPreviewShare({
        port: selectedService.port,
        path: submittedPath,
        label: label.trim() || undefined,
        ttlSeconds,
      }, csrf, activeLifetime.signal)
      if (activeLifetime.signal.aborted || lifetime.current !== activeLifetime) return
      setSnapshot(current => current ? { ...current, links: [result.link, ...current.links.filter(link => link.id !== result.link.id)] } : current)
      setLabel('')
      setNotice('Đã tạo link chia sẻ.')
    } catch (reason) {
      if (!activeLifetime.signal.aborted && lifetime.current === activeLifetime) setError(message(reason))
    } finally {
      createLocked.current = false
      mutationCount.current = Math.max(0, mutationCount.current - 1)
      mutationRevision.current++
      if (!activeLifetime.signal.aborted && lifetime.current === activeLifetime) setCreating(false)
    }
  }

  async function revoke(link: PreviewShare) {
    const activeLifetime = lifetime.current
    if (revokeLocked.current.has(link.id) || !activeLifetime || activeLifetime.signal.aborted || !online || !csrf) return
    revokeLocked.current.add(link.id)
    mutationCount.current++
    mutationRevision.current++
    setRevoking(current => new Set(current).add(link.id))
    setError('')
    setNotice('')
    try {
      await api.revokePreviewShare(link.id, csrf, activeLifetime.signal)
      if (activeLifetime.signal.aborted || lifetime.current !== activeLifetime) return
      const revokedAt = new Date(clockNow(clock)).toISOString()
      setSnapshot(current => current ? { ...current, links: current.links.map(item => item.id === link.id ? { ...item, status: 'revoked', revokedAt, url: undefined } : item) } : current)
      setNotice(`Đã ngắt chia sẻ ${link.label || link.serviceName}.`)
    } catch (reason) {
      if (!activeLifetime.signal.aborted && lifetime.current === activeLifetime) setError(message(reason))
    } finally {
      revokeLocked.current.delete(link.id)
      mutationCount.current = Math.max(0, mutationCount.current - 1)
      mutationRevision.current++
      if (!activeLifetime.signal.aborted && lifetime.current === activeLifetime) setRevoking(current => { const next = new Set(current); next.delete(link.id); return next })
    }
  }

  async function copy(link: PreviewShare) {
    const activeLifetime = lifetime.current
    if (!link.url || !activeLifetime || activeLifetime.signal.aborted) return
    setError('')
    try {
      await navigator.clipboard.writeText(link.url)
      if (activeLifetime.signal.aborted || lifetime.current !== activeLifetime) return
      setNotice(`Đã sao chép link ${link.label || link.serviceName}.`)
    } catch (reason) {
      if (!activeLifetime.signal.aborted && lifetime.current === activeLifetime) setError(message(reason) || 'Trình duyệt không cho phép sao chép link')
    }
  }

  const close = () => { if (dialog.current?.open) onClose() }

  return <dialog ref={dialog} className="preview-shares-dialog" aria-labelledby="preview-shares-title" onCancel={event => { event.preventDefault(); close() }}>
    <header className="preview-shares-heading">
      <div><p className="eyebrow">PUBLIC PREVIEW</p><h2 id="preview-shares-title">Link chia sẻ</h2></div>
      <button className="icon-button" type="button" aria-label="Đóng quản lý link chia sẻ" onClick={close}>×</button>
    </header>
    <p className="preview-shares-intro">Người có link có thể dùng dịch vụ cho đến khi link hết hạn hoặc bị ngắt. Đăng nhập riêng của dịch vụ vẫn áp dụng.</p>

    {error && <div className="error-banner preview-shares-error" role="alert"><span>{error}</span>{!snapshot && <button type="button" onClick={() => void load()} disabled={loading || creating || revoking.size > 0}>Thử lại</button>}</div>}
    {notice && <p className="preview-shares-notice" role="status">{notice}</p>}

    <section className="preview-shares-create" aria-labelledby="preview-shares-create-title">
      <div className="preview-shares-section-heading"><h3 id="preview-shares-create-title">Tạo link mới</h3><button className="quiet-button" type="button" onClick={() => void load()} disabled={loading || creating || revoking.size > 0}>{loading ? 'Đang tải…' : 'Làm mới'}</button></div>
      {!snapshot && loading ? <p role="status" className="muted">Đang tải dịch vụ và link hiện có…</p> : <form onSubmit={event => void create(event)}>
        <label>Dịch vụ
          <select aria-label="Dịch vụ" ref={serviceSelect} value={servicePort} disabled={creating || !online || !snapshot?.services.length} onChange={event => setServicePort(event.target.value)} required>
            {!snapshot?.services.length && <option value="">Không có dịch vụ có thể chia sẻ</option>}
            {snapshot?.services.map(service => <option key={service.port} value={service.port} disabled={service.running === false}>{service.name}{service.running === false ? ' · đang tắt' : service.running === null ? ' · chưa rõ trạng thái' : ''}</option>)}
          </select>
        </label>
        <label>Thời hạn
          <select aria-label="Thời hạn" value={ttlSeconds} disabled={creating} onChange={event => setTtlSeconds(Number(event.target.value))}>
            {PREVIEW_SHARE_LIFETIMES.map(option => <option key={option.seconds} value={option.seconds}>{option.label}</option>)}
          </select>
        </label>
        <label className="preview-shares-label">Tên gợi nhớ <span>(không bắt buộc)</span>
          <input aria-label="Tên gợi nhớ" value={label} maxLength={120} disabled={creating} placeholder={selectedService?.name || 'Bản demo cho khách'} onChange={event => setLabel(event.target.value)} />
        </label>
        <details className="preview-shares-options">
          <summary>Đường dẫn mở</summary>
          <label>Đường dẫn ban đầu
            <input aria-label="Đường dẫn ban đầu" aria-invalid={pathTooLong || undefined} aria-describedby="preview-share-path-help" value={path} disabled={creating} inputMode="url" placeholder="/" onChange={event => setPath(event.target.value)} />
          </label>
          <p id="preview-share-path-help" className={pathTooLong ? 'preview-share-path-help is-error' : 'preview-share-path-help'}>{pathBytes.toLocaleString('vi-VN')} / {PREVIEW_SHARE_PATH_MAX_BYTES.toLocaleString('vi-VN')} byte UTF-8. Đường dẫn chỉ chọn màn hình mở đầu, không giới hạn các trang khác trong cùng dịch vụ.</p>
        </details>
        <button className="primary-button preview-shares-submit" disabled={creating || !online || !csrf || !selectedService || selectedService.running === false || pathTooLong}>{creating ? 'Đang tạo…' : 'Tạo link chia sẻ'}</button>
      </form>}
      {!online && <p className="muted">Đang offline — kết nối lại để tạo hoặc ngắt link.</p>}
    </section>

    <section className="preview-shares-active" aria-labelledby="preview-shares-active-title">
      <div className="preview-shares-section-heading"><h3 id="preview-shares-active-title">Đang chia sẻ</h3>{snapshot && <span>{activeLinks.length}</span>}</div>
      {snapshot && activeLinks.length === 0 && <p className="preview-shares-empty">Chưa có link nào đang hoạt động.</p>}
      <ul className="preview-share-list">
        {activeLinks.map(link => <li key={link.id}>
          <div className="preview-share-copy"><strong>{link.label || link.serviceName}</strong><span>{link.serviceName} · :{link.port}{link.path}</span></div>
          <div className="preview-share-expiry"><strong>{previewShareTimeLeft(link.expiresAt, now)}</strong><span>Hết hạn {formatDateTime(link.expiresAt)}</span></div>
          <div className="preview-share-actions">
            <button className="quiet-button" type="button" disabled={!link.url} onClick={() => void copy(link)}>Sao chép</button>
            {link.url && <a className="quiet-button" href={link.url} target="_blank" rel="noreferrer" referrerPolicy="no-referrer">Mở</a>}
            <button className="danger-button" type="button" disabled={revoking.has(link.id) || !online} onClick={() => void revoke(link)}>{revoking.has(link.id) ? 'Đang ngắt…' : 'Ngắt chia sẻ'}</button>
          </div>
        </li>)}
      </ul>
    </section>

    {snapshot && closedLinks.length > 0 && <details className="preview-shares-history">
      <summary>Lịch sử đã đóng ({closedLinks.length})</summary>
      <ul className="preview-share-list is-history">
        {closedLinks.map(link => <li key={link.id}>
          <div className="preview-share-copy"><strong>{link.label || link.serviceName}</strong><span>{link.serviceName} · :{link.port}{link.path}</span></div>
          <div className="preview-share-expiry"><strong>{previewShareStatusLabel(link, now)}</strong><span>Hết hạn {formatDateTime(link.expiresAt)}</span></div>
        </li>)}
      </ul>
    </details>}
  </dialog>
}
