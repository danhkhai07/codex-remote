import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from './api'
import { parseBrowserAddress } from './browserAddress'
import { useScreenState } from './screenState'

type Preview = { url: string; viewUrl: string; address: string; port?: number; loadId: number }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Không thể mở preview. Hãy thử lại.'
}

export function LocalhostPreview({ csrf, onClose, initialUrl, scope = 'services', onNavigate }: {
  csrf: string
  onClose: () => void
  initialUrl?: string
  scope?: string
  onNavigate?: (address: string) => void
}) {
  const [savedAddress, setSavedAddress] = useScreenState(`browser:${scope}:address`, '')
  const [lastUrl, setLastUrl] = useScreenState(`browser:${scope}:last-url`, '')
  const [address, setAddress] = useState(initialUrl ?? savedAddress)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [controlsOpen, setControlsOpen] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [slow, setSlow] = useState(false)
  const closeButton = useRef<HTMLButtonElement>(null)
  const backdrop = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLElement>(null)
  const controls = useRef<HTMLDivElement>(null)
  const request = useRef<AbortController | null>(null)
  const popup = useRef<Window | null>(null)
  const autoOpened = useRef<string | null>(null)
  const navigate = useRef(onNavigate)
  navigate.current = onNavigate
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => { setSavedAddress(address) }, [address, setSavedAddress])

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const resize = () => {
      if (!backdrop.current) return
      backdrop.current.style.setProperty('--localhost-preview-height', `${viewport.height}px`)
      backdrop.current.style.top = `${viewport.offsetTop}px`
    }
    resize()
    viewport.addEventListener('resize', resize)
    viewport.addEventListener('scroll', resize)
    return () => {
      viewport.removeEventListener('resize', resize)
      viewport.removeEventListener('scroll', resize)
    }
  }, [])

  useEffect(() => {
    const previousFocus = document.activeElement
    closeButton.current?.focus()
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close.current()
      }
      if (event.key !== 'Tab') return
      const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), iframe, [tabindex="0"]') ?? [])
      const first = items[0]
      const last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', keyDown)
    return () => {
      document.removeEventListener('keydown', keyDown)
      request.current?.abort()
      popup.current?.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])

  const launch = useCallback(async (value: string, inBrowser = false) => {
    if (request.current) return
    const parsed = parseBrowserAddress(value, window.location.origin)
    if (!parsed) {
      setError('Nhập URL http://, https://, đường dẫn như /working-hours hoặc port localhost.')
      return
    }
    // Open synchronously during the click so mobile browsers allow the new tab.
    const opened = inBrowser ? window.open('about:blank', '_blank') : null
    if (inBrowser && !opened) {
      setError('Trình duyệt đã chặn tab mới. Cho phép popup rồi thử lại.')
      return
    }
    if (opened) {
      opened.opener = null
      popup.current = opened
    }
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      const result = parsed.kind === 'localhost'
        ? await api.launchLocalhostPreview(parsed.local.port, parsed.local.path, csrf, controller.signal)
        : { url: parsed.url, viewUrl: parsed.url }
      if (controller.signal.aborted) return
      const url = new URL(result.url)
      const viewUrl = new URL(result.viewUrl)
      const allowedProtocol = url.protocol === 'https:' || (window.location.protocol === 'http:' && url.protocol === 'http:')
      const localPath = url.origin === window.location.origin && url.pathname.startsWith(`/preview/${parsed.kind === 'localhost' ? parsed.local.port : ''}/`)
      if (parsed.kind === 'localhost' && (!allowedProtocol || (!localPath && url.origin === window.location.origin) || viewUrl.origin !== url.origin)) {
        throw new Error('Địa chỉ preview không hợp lệ.')
      }
      if (opened) {
        if (opened.closed) throw new Error('Tab preview đã đóng. Hãy mở lại.')
        opened.location.replace(result.url)
        popup.current = null
      } else {
        setLoaded(false)
        setSlow(false)
        setPreview(current => ({ ...result, address: value, loadId: (current?.loadId ?? 0) + 1 }))
        // Move focus before hiding the address form, also dismissing mobile keyboards.
        if (controls.current?.contains(document.activeElement)) closeButton.current?.focus()
        setControlsOpen(false)
        setLastUrl(value)
        autoOpened.current = value
        navigate.current?.(value)
      }
    } catch (reason) {
      opened?.close()
      if (!controller.signal.aborted) setError(errorMessage(reason))
    } finally {
      if (request.current === controller) {
        request.current = null
        popup.current = null
        if (!controller.signal.aborted) setBusy(false)
      }
    }
  }, [csrf, setLastUrl])

  useEffect(() => {
    const target = initialUrl || lastUrl
    if (!target || autoOpened.current === target) return
    // Deferral lets StrictMode discard its first mount without issuing a ticket.
    const timer = setTimeout(() => {
      autoOpened.current = target
      setAddress(target)
      void launch(target)
    }, 0)
    return () => clearTimeout(timer)
  }, [initialUrl, lastUrl, launch])

  useEffect(() => {
    if (!preview || loaded) return
    const timer = setTimeout(() => setSlow(true), 10_000)
    return () => clearTimeout(timer)
  }, [preview, loaded])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!busy) void launch(address)
  }

  return <div ref={backdrop} className="file-viewer-backdrop localhost-preview-backdrop" onMouseDown={event => {
    if (event.currentTarget === event.target) onClose()
  }}>
    <section ref={dialog} className="file-viewer localhost-preview" role="dialog" aria-modal="true" aria-labelledby="localhost-preview-title">
      <header className="file-viewer-header">
        <div className="link-viewer-identity">
          <span className="file-viewer-title" id="localhost-preview-title">Browser</span>
        </div>
        {preview && <div className="localhost-preview-actions">
          <button className="quiet-button localhost-preview-address-toggle" type="button" aria-expanded={controlsOpen} aria-controls="localhost-preview-controls" onClick={() => setControlsOpen(value => !value)} title="Đổi địa chỉ">{preview.port ? `:${preview.port}` : new URL(preview.viewUrl).hostname} <span aria-hidden="true">⌄</span></button>
          <button className="quiet-button" type="button" disabled={busy || !csrf} onClick={() => void launch(preview.address)} aria-label="Tải lại trang" title="Reload">↻</button>
          <button className="quiet-button" type="button" disabled={busy || !csrf} onClick={() => void launch(preview.address, true)} aria-label="Mở tab ngoài" title="Mở tab ngoài">↗</button>
        </div>}
        <button ref={closeButton} className="icon-button" type="button" onClick={onClose} aria-label="Đóng Browser">×</button>
      </header>
      <div ref={controls} id="localhost-preview-controls" className="localhost-preview-controls" hidden={!controlsOpen && !error}>
        <form onSubmit={submit} hidden={!controlsOpen}>
          <label htmlFor="localhost-preview-address">Địa chỉ trang</label>
          <div className="localhost-preview-address-row">
            <input id="localhost-preview-address" value={address} onChange={event => setAddress(event.target.value)} placeholder="https://example.com, /working-hours hoặc 5183" autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={busy} aria-describedby="localhost-preview-help" />
            <button className="primary-button" type="submit" disabled={busy || !csrf}>{busy ? 'Đang mở…' : 'Mở trang'}</button>
          </div>
        </form>
        {controlsOpen && <div className="localhost-preview-toolbar">
          <p id="localhost-preview-help">Nhập link web, đường dẫn nội bộ hoặc port của app trên VPS.</p>
          <div className="localhost-preview-actions">
            <button className="quiet-button" type="button" disabled={busy || !csrf} onClick={() => void launch(address, true)}>Mở tab ngoài ↗</button>
          </div>
        </div>}
        {error && <p className="localhost-preview-error" role="alert">{error}</p>}
      </div>
      <div className="localhost-preview-content">
        {preview && new URL(preview.viewUrl).origin !== window.location.origin && <p className="browser-frame-help">Nếu trang không cho hiển thị ở đây, chọn <button type="button" onClick={() => void launch(preview.address, true)}>Mở tab ngoài ↗</button>.</p>}
        {!preview && <div className="file-viewer-empty"><strong>Mở một trang để bắt đầu</strong><p>Web, app localhost và các trang Codex Remote đều mở ở đây.</p></div>}
        {preview && <>
          {!loaded && <div className="localhost-preview-loading" role="status"><span className="spinner" aria-hidden="true" />{slow ? 'Trang tải lâu hoặc không cho nhúng. Thử Mở tab ngoài.' : 'Đang tải ứng dụng…'}</div>}
          <iframe key={preview.loadId} src={preview.url} title={preview.port ? `Localhost port ${preview.port}` : 'Browser page'} sandbox="allow-same-origin allow-scripts allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" onLoad={() => setLoaded(true)} onError={() => {
            setLoaded(true)
            setError('Không thể tải ứng dụng trong khung xem. Thử tải lại hoặc Mở tab ngoài.')
          }} />
        </>}
      </div>
    </section>
  </div>
}
