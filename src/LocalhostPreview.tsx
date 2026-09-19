import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from './api'
import { parseLocalhostAddress } from './localhostAddress'
import { useScreenState } from './screenState'

type Preview = { url: string; viewUrl: string; address: string; port: number; loadId: number }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Không thể mở preview. Hãy thử lại.'
}

export function LocalhostPreview({ csrf, onClose, initialUrl }: {
  csrf: string
  onClose: () => void
  initialUrl?: string
}) {
  const [savedAddress, setSavedAddress] = useScreenState('browser:localhost-preview', '3000')
  const [address, setAddress] = useState(initialUrl ?? savedAddress)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [statusError, setStatusError] = useState('')
  const [statusAttempt, setStatusAttempt] = useState(0)
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

  useEffect(() => {
    let current = true
    setEnabled(null)
    setStatusError('')
    void api.localhostPreviewStatus().then(result => {
      if (current) setEnabled(result.enabled)
    }).catch(reason => {
      if (current) setStatusError(errorMessage(reason))
    })
    return () => { current = false }
  }, [statusAttempt])

  const launch = useCallback(async (value: string, inBrowser = false) => {
    if (request.current) return
    const parsed = parseLocalhostAddress(value)
    if (!parsed) {
      setError('Nhập port từ 1024–65535 hoặc địa chỉ HTTP localhost, ví dụ http://localhost:3000.')
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
      const result = await api.launchLocalhostPreview(parsed.port, parsed.path, csrf, controller.signal)
      if (controller.signal.aborted) return
      const url = new URL(result.url)
      const viewUrl = new URL(result.viewUrl)
      const allowedProtocol = url.protocol === 'https:' || (window.location.protocol === 'http:' && url.protocol === 'http:')
      const localPath = url.origin === window.location.origin && url.pathname.startsWith(`/preview/${parsed.port}/`)
      if (!allowedProtocol || (!localPath && url.origin === window.location.origin) || viewUrl.origin !== url.origin) {
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
  }, [csrf])

  useEffect(() => {
    if (!initialUrl || !enabled || autoOpened.current === initialUrl) return
    // Deferral lets StrictMode discard its first mount without issuing a ticket.
    const timer = setTimeout(() => {
      autoOpened.current = initialUrl
      setAddress(initialUrl)
      void launch(initialUrl)
    }, 0)
    return () => clearTimeout(timer)
  }, [initialUrl, enabled, launch])

  useEffect(() => {
    if (!preview || loaded) return
    const timer = setTimeout(() => setSlow(true), 10_000)
    return () => clearTimeout(timer)
  }, [preview, loaded])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (enabled && !busy) void launch(address)
  }

  return <div ref={backdrop} className="file-viewer-backdrop localhost-preview-backdrop" onMouseDown={event => {
    if (event.currentTarget === event.target) onClose()
  }}>
    <section ref={dialog} className="file-viewer localhost-preview" role="dialog" aria-modal="true" aria-labelledby="localhost-preview-title">
      <header className="file-viewer-header">
        <div className="link-viewer-identity">
          <span className="file-viewer-title" id="localhost-preview-title">Localhost preview</span>
        </div>
        {preview && <div className="localhost-preview-actions">
          <button className="quiet-button localhost-preview-address-toggle" type="button" aria-expanded={controlsOpen} aria-controls="localhost-preview-controls" onClick={() => setControlsOpen(value => !value)} title="Đổi port hoặc địa chỉ">:{preview.port} <span aria-hidden="true">⌄</span></button>
          <button className="quiet-button" type="button" disabled={busy || !enabled || !csrf} onClick={() => void launch(preview.address)} aria-label="Reload preview" title="Reload">↻</button>
          <button className="quiet-button" type="button" disabled={busy || !enabled || !csrf} onClick={() => void launch(preview.address, true)} aria-label="Open preview in browser" title="Open browser">↗</button>
        </div>}
        <button ref={closeButton} className="icon-button" type="button" onClick={onClose} aria-label="Close localhost preview">×</button>
      </header>
      <div ref={controls} id="localhost-preview-controls" className="localhost-preview-controls" hidden={!controlsOpen && !error && !statusError}>
        <form onSubmit={submit} hidden={!controlsOpen}>
          <label htmlFor="localhost-preview-address">Port hoặc địa chỉ localhost</label>
          <div className="localhost-preview-address-row">
            <input id="localhost-preview-address" value={address} onChange={event => setAddress(event.target.value)} placeholder="3000 hoặc http://localhost:5174" autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={busy} aria-describedby="localhost-preview-help" />
            <button className="primary-button" type="submit" disabled={!enabled || busy || !csrf}>{busy ? 'Đang mở…' : 'Open preview'}</button>
          </div>
        </form>
        {controlsOpen && <div className="localhost-preview-toolbar">
          <p id="localhost-preview-help">Giữ app trên VPS chạy trong lúc xem.</p>
          <div className="localhost-preview-actions">
            <button className="quiet-button" type="button" disabled={busy || !enabled || !csrf} onClick={() => void launch(address, true)}>Open browser ↗</button>
          </div>
        </div>}
        {enabled === null && !statusError && <p className="localhost-preview-status" role="status">Đang kiểm tra preview…</p>}
        {enabled === false && <p className="localhost-preview-status" role="status">Preview chưa được cấu hình domain trên server.</p>}
        {statusError && <div className="localhost-preview-error" role="alert"><span>{statusError}</span><button className="quiet-button" type="button" onClick={() => setStatusAttempt(value => value + 1)}>Thử lại</button></div>}
        {error && <p className="localhost-preview-error" role="alert">{error}</p>}
      </div>
      <div className="localhost-preview-content">
        {!preview && <div className="file-viewer-empty"><strong>Xem localhost ngay tại đây</strong><p>Nhập port của app, ví dụ 3000 hoặc 5174, rồi mở preview.</p></div>}
        {preview && <>
          {!loaded && <div className="localhost-preview-loading" role="status"><span className="spinner" aria-hidden="true" />{slow ? 'Trang tải lâu. Có thể thử Open browser.' : 'Đang tải ứng dụng…'}</div>}
          <iframe key={preview.loadId} src={preview.url} title={`Localhost port ${preview.port}`} sandbox="allow-same-origin allow-scripts allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" onLoad={() => setLoaded(true)} onError={() => {
            setLoaded(true)
            setError('Không thể tải ứng dụng trong khung xem. Thử Reload hoặc Open browser.')
          }} />
        </>}
      </div>
    </section>
  </div>
}
