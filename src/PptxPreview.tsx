import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { api } from './api'
import { useScreenState } from './screenState'

export default function PptxPreview({ path, name, format = 'pptx' }: { path: string; name: string; format?: 'pptx' | 'pdf' }) {
  const pdfSource = format === 'pdf'
  const unit = pdfSource ? 'trang' : 'slide'
  const label = pdfSource ? 'PDF' : 'PPTX'
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [page, setPage] = useScreenState(`${format}:${path}:page`, 1)
  const [zoom, setZoom] = useScreenState(`${format}:${path}:zoom`, 1)
  const [width, setWidth] = useState(320)
  const [rendering, setRendering] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const currentPage = Math.min(Math.max(1, Number.isFinite(page) ? Math.trunc(page) : 1), pdf?.numPages ?? 1)
  const currentZoom = Math.min(3, Math.max(0.5, Number.isFinite(zoom) ? zoom : 1))

  useEffect(() => {
    let disposed = false
    const controller = new AbortController()
    let task: ReturnType<typeof import('pdfjs-dist')['getDocument']> | undefined
    setPdf(null)
    setError('')
    void (async () => {
      const [library, blob] = await Promise.all([
        import('pdfjs-dist/legacy/build/pdf.mjs'),
        (pdfSource ? api.pdfPreview : api.pptxPreview)(path, AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)])),
      ])
      if (disposed) return
      library.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).href
      task = library.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true })
      if (disposed) { void task.destroy(); return }
      const document = await task.promise
      if (!disposed) setPdf(document)
    })().catch(reason => { if (!disposed) setError(reason instanceof Error ? reason.message : `Không mở được bản xem trước ${label}.`) })
    return () => { disposed = true; controller.abort(); void task?.destroy() }
  }, [path, attempt, pdfSource, label])

  useEffect(() => {
    if (!host.current) return
    const observer = new ResizeObserver(entries => setWidth(Math.max(100, entries[0].contentRect.width - 24)))
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!pdf || !canvas.current) return
    const target = canvas.current
    let disposed = false
    let render: RenderTask | undefined
    setRendering(true)
    void pdf.getPage(currentPage).then(async slide => {
      if (disposed) return
      const base = slide.getViewport({ scale: 1 })
      const scale = width / base.width * currentZoom
      const viewport = slide.getViewport({ scale })
      // Render only the visible slide, with a bounded backing canvas on phones.
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(6_000_000 / (viewport.width * viewport.height)))
      target.width = Math.max(1, Math.floor(viewport.width * ratio))
      target.height = Math.max(1, Math.floor(viewport.height * ratio))
      target.style.width = `${viewport.width}px`
      target.style.height = `${viewport.height}px`
      render = slide.render({ canvas: target, viewport, transform: [ratio, 0, 0, ratio, 0, 0] })
      await render.promise
    }).catch(reason => {
      if (!disposed) setError(reason instanceof Error ? reason.message : `Không hiển thị được ${unit}.`)
    }).finally(() => { if (!disposed) setRendering(false) })
    return () => { disposed = true; render?.cancel() }
  }, [pdf, currentPage, currentZoom, width, unit])

  return <div className="pptx-preview">
    <div className="pptx-slides" ref={host} aria-busy={!pdf || rendering}>
      {error ? <div className="file-viewer-empty" role="alert"><strong>Không xem được {label}</strong><p>{error}</p><button type="button" className="quiet-button" onClick={() => setAttempt(value => value + 1)}>Thử lại</button></div>
        : !pdf ? <div className="file-viewer-empty" role="status"><span className="spinner" /><p>Đang mở bản xem trước {label}…</p>{!pdfSource && <small>Lần đầu có thể mất tới 45 giây.</small>}</div>
          : <canvas ref={canvas} role="img" aria-label={`${name} — ${unit} ${currentPage} / ${pdf.numPages}`} />}
    </div>
    <div className="pptx-toolbar" aria-label={`Điều khiển ${unit}`}>
      <button type="button" className="quiet-button" disabled={!pdf || currentPage <= 1} onClick={() => setPage(currentPage - 1)} aria-label={pdfSource ? 'Trang trước' : 'Slide trước'}>←</button>
      <span aria-live="polite">{pdf ? `${currentPage} / ${pdf.numPages}` : '— / —'}</span>
      <button type="button" className="quiet-button" disabled={!pdf || currentPage >= pdf.numPages} onClick={() => setPage(currentPage + 1)} aria-label={pdfSource ? 'Trang sau' : 'Slide sau'}>→</button>
      <button type="button" className="quiet-button" disabled={!pdf || currentZoom <= 0.5} onClick={() => setZoom(currentZoom - 0.25)} aria-label={`Thu nhỏ ${unit}`}>−</button>
      <button type="button" className="quiet-button" disabled={!pdf} onClick={() => setZoom(1)} title="Vừa chiều rộng">{Math.round(currentZoom * 100)}%</button>
      <button type="button" className="quiet-button" disabled={!pdf || currentZoom >= 3} onClick={() => setZoom(currentZoom + 0.25)} aria-label={`Phóng to ${unit}`}>+</button>
    </div>
    <p className="pptx-note">{pdfSource ? 'Bản xem tĩnh · Tải bản gốc để dùng biểu mẫu và các chức năng PDF khác.' : 'Bản xem tĩnh · Không chạy hiệu ứng, âm thanh hoặc video.'}</p>
  </div>
}
