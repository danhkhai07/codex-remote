import { useEffect, useRef, useState } from 'react'
import { readScreenState, useScreenState, writeScreenState } from './screenState'

export function DocxPreview({ blob, name, onOpenLink, stateKey = name }: {
  blob: Blob | null
  name: string
  stateKey?: string
  onOpenLink: (href: string) => void
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [frameDocument, setFrameDocument] = useState<Document | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [zoom, setZoom] = useScreenState<number | 'fit'>(`docx:${stateKey}:zoom`, 'fit')
  const [scale, setScale] = useState(1)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!blob || !frameDocument) return
    let cancelled = false
    const host = frameDocument.getElementById('document')
    if (!host) {
      setStatus('error')
      setError('Phiên đăng nhập đã hết hạn. Hãy đóng khung xem và đăng nhập lại.')
      return
    }
    const content = frameDocument.createElement('div')
    const styles = frameDocument.createElement('div')
    host.replaceChildren(styles, content)
    setStatus('loading')
    setError('')
    void (async () => {
      const [{ renderAsync }, data] = await Promise.all([import('docx-preview'), blob.arrayBuffer()])
      if (cancelled) return
      await renderAsync(data, content, styles, {
        // Keep the document's table/page widths. Long sections grow vertically.
        ignoreHeight: true,
        useBase64URL: true,
        renderAltChunks: false,
        ignoreLastRenderedPageBreak: false,
        renderComments: false,
      })
      if (!cancelled) setStatus('ready')
    })().catch(() => {
      if (!cancelled) {
        setStatus('error')
        setError('Không đọc được tệp Word này. Bạn vẫn có thể tải bản gốc bằng nút phía trên.')
      }
    })
    return () => {
      cancelled = true
      content.remove()
      styles.remove()
    }
  }, [blob, frameDocument, attempt])

  useEffect(() => {
    if (!frameDocument) return
    const click = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.('a')
      if (!anchor) return
      const href = anchor.getAttribute('href') ?? ''
      event.preventDefault()
      if (href.startsWith('#')) {
        try { frameDocument.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView() } catch { /* Malformed bookmark. */ }
      } else if (href) onOpenLink(href)
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    }
    frameDocument.addEventListener('click', click)
    frameDocument.addEventListener('keydown', keydown)
    return () => {
      frameDocument.removeEventListener('click', click)
      frameDocument.removeEventListener('keydown', keydown)
    }
  }, [frameDocument, onOpenLink])

  useEffect(() => {
    if (status !== 'ready' || !frameDocument || !frame.current) return
    const host = frameDocument.getElementById('document')!
    // Scale the finished page, not its font/layout metrics. iOS WebKit can
    // leave explicit font sizes unscaled under CSS zoom (WebKit bug 272339).
    // Clip the unscaled overflow and give scrolling the actual scaled size.
    let surface = frameDocument.getElementById('docx-surface')
    if (!surface) {
      surface = frameDocument.createElement('div')
      surface.id = 'docx-surface'
      host.before(surface)
      surface.append(host)
    }
    surface.style.position = 'relative'
    surface.style.overflow = 'hidden'
    host.style.removeProperty('zoom')
    host.style.position = 'absolute'
    host.style.top = '0'
    host.style.minWidth = '0'
    host.style.transformOrigin = 'top left'
    const resize = () => {
      const pages = [...host.querySelectorAll<HTMLElement>('section.docx')]
      const width = Math.max(1, ...pages.map(page => page.offsetWidth)) + 24
      const next = zoom === 'fit' ? Math.min(1, frame.current!.clientWidth / width) : zoom
      host.style.width = `${width}px`
      host.style.transform = `scale(${next})`
      host.style.left = `${Math.max(0, (frame.current!.clientWidth - width * next) / 2)}px`
      surface.style.width = `${Math.max(frame.current!.clientWidth, width * next)}px`
      surface.style.height = `${Math.ceil(host.scrollHeight * next)}px`
      setScale(next)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(frame.current)
    // Images and embedded fonts can settle after renderAsync resolves.
    observer.observe(host)
    return () => observer.disconnect()
  }, [frameDocument, status, zoom])

  useEffect(() => {
    if (status !== 'ready' || !frameDocument) return
    const view = frameDocument.defaultView
    if (!view) return
    const key = `docx:${stateKey}:scroll`
    const saved = readScreenState(key, { top: 0, left: 0 })
    view.scrollTo(saved.left, saved.top)
    const save = () => writeScreenState(key, { top: view.scrollY, left: view.scrollX })
    view.addEventListener('scroll', save, { passive: true })
    return () => view.removeEventListener('scroll', save)
  }, [status, frameDocument, stateKey])

  return <div className="docx-preview">
    <div className="docx-preview-content" aria-busy={status === 'loading'}>
      <iframe ref={frame} src="/secure-docx-frame" title={`Xem trước ${name}`} sandbox="allow-same-origin" referrerPolicy="no-referrer"
        onLoad={() => setFrameDocument(frame.current?.contentDocument ?? null)}
        style={{ visibility: status === 'ready' ? 'visible' : 'hidden' }} />
      {status === 'loading' && <div className="docx-preview-overlay" role="status"><span className="spinner" />Đang mở tệp Word…</div>}
      {status === 'error' && <div className="docx-preview-overlay" role="alert"><p>{error}</p><button type="button" className="quiet-button" onClick={() => setAttempt(value => value + 1)}>Thử lại</button></div>}
    </div>
    <div className="docx-preview-toolbar" role="group" aria-label="Thu phóng tài liệu Word">
      <button type="button" className="quiet-button" onClick={() => setZoom('fit')} disabled={status !== 'ready'}>Vừa màn hình</button>
      <button type="button" className="quiet-button" aria-label="Thu nhỏ" disabled={status !== 'ready' || scale <= 0.2} onClick={() => setZoom(Math.max(0.2, scale - 0.2))}>−</button>
      <button type="button" className="quiet-button" onClick={() => setZoom(1)} disabled={status !== 'ready'} title="Kích thước gốc">{Math.round(scale * 100)}%</button>
      <button type="button" className="quiet-button" aria-label="Phóng to" disabled={status !== 'ready' || scale >= 2} onClick={() => setZoom(Math.min(2, scale + 0.2))}>+</button>
    </div>
  </div>
}
