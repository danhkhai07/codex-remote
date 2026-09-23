import { fileViewerUrl, regularLinkClick } from './fileViewerLink'
import { SecureHtml, SecureMedia, downloadSecureFile } from './SecureFiles'
import { secureRequired } from './secureApi'
import { attachWorkTimerStorage, WORK_TIMER_PATH } from './workTimerStorage'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, ApiError, serverFileUrl } from './api'
import { parseLocalFileReference, type LocalFileReference, type WebLinkReference } from './MarkdownMessage'
import type { ServerFileInfo } from './types'
import { SvgPreview } from './SvgPreview'
import { DocxPreview } from './DocxPreview'
import { usePinnedFiles } from './pinnedFiles'
import { readScreenState, useRestoredScroll, useScreenState } from './screenState'

const MAX_SHARE_FILE_BYTES = 20 * 1024 * 1024
const PptxPreview = lazy(() => import('./PptxPreview'))

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to open this file'
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

export function formatFileType(file: Pick<ServerFileInfo, 'contentType' | 'extension' | 'kind'>): string {
  const mime = file.contentType.split(';', 1)[0]
  const known: Record<string, string> = {
    'application/pdf': 'PDF document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'Microsoft PowerPoint presentation',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Microsoft Word document',
    'image/gif': 'GIF image',
    'image/jpeg': 'JPEG image',
    'image/png': 'PNG image',
    'image/webp': 'WebP image',
  }
  if (known[mime]) return known[mime]
  if (file.kind === 'text') {
    const textFormats: Record<string, string> = {
      '.svg': 'SVG image',
      '.html': 'HTML document',
      '.htm': 'HTML document',
      '.csv': 'CSV document',
      '.json': 'JSON document',
      '.md': 'Markdown document',
      '.markdown': 'Markdown document',
      '.txt': 'Text document',
    }
    return textFormats[file.extension] ?? (file.extension ? `${file.extension.slice(1).toUpperCase()} source file` : 'Text document')
  }
  return file.extension ? `${file.extension.slice(1).toUpperCase()} file` : 'File'
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(date)
}

export function supportsNativeFileShare(file: Pick<ServerFileInfo, 'name' | 'size' | 'contentType'>): boolean {
  if (file.size > MAX_SHARE_FILE_BYTES || typeof navigator === 'undefined' || !navigator.share || !navigator.canShare) return false
  try {
    return navigator.canShare({ files: [new File([], file.name, { type: file.contentType })] })
  } catch {
    return false
  }
}

function TextPreview({ text, targetLine, autoScroll = true }: { text: string; targetLine?: number; autoScroll?: boolean }) {
  const excerpt = useMemo(() => {
    if (!targetLine) return null
    const lines = text.split('\n')
    const target = Math.min(Math.max(1, targetLine), Math.max(1, lines.length))
    const start = Math.max(1, target - 100)
    const end = Math.min(lines.length, target + 100)
    return { lines: lines.slice(start - 1, end), start, target, total: lines.length }
  }, [targetLine, text])
  const highlighted = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (autoScroll) highlighted.current?.scrollIntoView({ block: 'center' })
  }, [excerpt, autoScroll])

  if (!excerpt) return <pre className="file-text-raw">{text}</pre>
  return <div className="file-text-lines">
    {(excerpt.start > 1 || excerpt.lines.length < excerpt.total) && (
      <p>Showing lines {excerpt.start}–{excerpt.start + excerpt.lines.length - 1} of {excerpt.total}</p>
    )}
    <ol start={excerpt.start}>
      {excerpt.lines.map((line, index) => {
        const number = excerpt.start + index
        return <li className={number === excerpt.target ? 'is-target' : ''} ref={number === excerpt.target ? highlighted : undefined} key={number}>
          <code>{line || ' '}</code>
        </li>
      })}
    </ol>
  </div>
}

export function resolveMarkdownFileReference(href: string | undefined, currentPath: string): LocalFileReference | null {
  const direct = parseLocalFileReference(href)
  if (direct) return direct
  if (!href || href.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(href)) return null
  try {
    const directory = currentPath.slice(0, currentPath.lastIndexOf('/') + 1)
    const url = new URL(href, `https://workspace.invalid${encodeURI(directory)}`)
    return parseLocalFileReference(`${decodeURIComponent(url.pathname)}${decodeURIComponent(url.hash)}`)
  } catch {
    return null
  }
}

function MarkdownPreview({ text, currentPath, onOpenFile, onOpenLink }: {
  text: string
  currentPath: string
  onOpenFile?: (reference: LocalFileReference) => void
  onOpenLink?: (reference: WebLinkReference) => void
}) {
  return <article className="file-markdown-preview">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={{
        a: ({ children, href, title }) => {
          const localFile = resolveMarkdownFileReference(href, currentPath)
          const external = Boolean(href?.startsWith('https://') || href?.startsWith('http://'))
          return <a
            href={localFile ? fileViewerUrl(localFile) : href}
            title={title}
            target={external ? '_blank' : undefined}
            rel={external ? 'noreferrer' : undefined}
            onClick={localFile && onOpenFile
              ? event => {
                if (!regularLinkClick(event)) return
                event.preventDefault()
                onOpenFile(localFile)
              }
              : external && href && onOpenLink
                ? event => {
                  event.preventDefault()
                  onOpenLink({ url: href })
                }
                : undefined}
          >{children}</a>
        },
        img: ({ src, alt, title }) => {
          const localFile = resolveMarkdownFileReference(src, currentPath)
          return localFile ? <SecureMedia path={localFile.path} title={alt ?? ''} image /> : <img src={src} alt={alt ?? ''} title={title} />
        },
      }}
    >{text}</ReactMarkdown>
  </article>
}

export function FileViewer({ reference, onClose, onOpenFile, onOpenLink }: {
  reference: LocalFileReference
  onClose: () => void
  onOpenFile?: (reference: LocalFileReference) => void
  onOpenLink?: (reference: WebLinkReference) => void
}) {
  const { pins, storageError, togglePin } = usePinnedFiles()
  const [info, setInfo] = useState<ServerFileInfo | null>(null)
  const pinned = pins.some(pin => pin.path === (info?.path ?? reference.path))
  const [text, setText] = useState<string | null>(null)
  const [docxBlob, setDocxBlob] = useState<Blob | null>(null)
  const [error, setError] = useState('')
  const [retryable, setRetryable] = useState(false)
  const [metadataOpen, setMetadataOpen] = useScreenState(`file:${reference.path}:metadata`, false)
  const [shareFile, setShareFile] = useState<File | null>(null)
  const [sharePreparing, setSharePreparing] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [textMode, setTextMode] = useScreenState<'preview' | 'raw'>(`file:${reference.path}:mode`, reference.line ? 'raw' : 'preview')
  const [attempt, setAttempt] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)
  const htmlFrameRef = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    if (reference.path !== WORK_TIMER_PATH) return
    return attachWorkTimerStorage(() => htmlFrameRef.current?.contentWindow ?? null)
  }, [reference.path])
  useRestoredScroll(bodyRef, `file:${reference.path}:scroll:${textMode}`, Boolean(info && (info.kind !== 'text' || text !== null)))
  const closeButton = useRef<HTMLButtonElement>(null)
  const identityButton = useRef<HTMLButtonElement>(null)
  const metadataPanel = useRef<HTMLDivElement>(null)
  const metadataCloseButton = useRef<HTMLButtonElement>(null)

  const closeMetadata = () => {
    setMetadataOpen(false)
    identityButton.current?.focus()
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (metadataOpen) {
        event.preventDefault()
        setMetadataOpen(false)
        identityButton.current?.focus()
      } else onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [metadataOpen, onClose])

  useEffect(() => {
    closeButton.current?.focus()
  }, [onClose])

  useEffect(() => {
    if (metadataOpen) metadataCloseButton.current?.focus()
  }, [metadataOpen])

  useEffect(() => {
    let cancelled = false
    setInfo(null)
    setText(null)
    setDocxBlob(null)
    setError('')
    setShareFile(null)
    setSharePreparing(false)
    setSaveError('')
    void api.fileInfo(reference.path).then(async file => {
      if (cancelled) return
      setInfo(file)
      const nativeShare = supportsNativeFileShare(file)
      const wordPreview = file.kind === 'docx' && file.previewable
      if (nativeShare || wordPreview) {
        setSharePreparing(nativeShare)
        void api.fileBlob(reference.path).then(blob => {
          if (cancelled) return
          if (nativeShare) setShareFile(new File([blob], file.name, { type: file.contentType }))
          if (wordPreview) setDocxBlob(blob)
        }).catch(requestError => {
          if (!cancelled && wordPreview) {
            setError(errorMessage(requestError))
            setRetryable(!(requestError instanceof ApiError) || requestError.status >= 500)
          }
        }).finally(() => {
          if (!cancelled) setSharePreparing(false)
        })
      }
      if (file.kind === 'text' && file.previewable) {
        const content = await api.fileText(reference.path)
        if (!cancelled) setText(content)
      }
    }).catch(requestError => {
      if (!cancelled) {
        setError(errorMessage(requestError))
        setRetryable(!(requestError instanceof ApiError) || requestError.status >= 500)
      }
    })
    return () => { cancelled = true }
  }, [reference.path, attempt])

  useEffect(() => {
    if (!error || !retryable) return
    const retry = () => setAttempt(value => value + 1)
    window.addEventListener('online', retry)
    const timer = window.setInterval(() => { if (navigator.onLine) retry() }, 5_000)
    return () => { window.removeEventListener('online', retry); clearInterval(timer) }
  }, [error, retryable])

  const title = info?.name ?? reference.path.split('/').at(-1) ?? 'File'
  const previewUrl = serverFileUrl(reference.path)
  const downloadUrl = serverFileUrl(reference.path, true)
  const nativeShare = info ? supportsNativeFileShare(info) : false
  const svg = info?.kind === 'text' && info.extension === '.svg'
  const html = info?.kind === 'text' && ['.html', '.htm'].includes(info.extension)
  const htmlPreviewUrl = `/api/files/html-preview?${new URLSearchParams({ path: reference.path })}`
  const markdown = info?.kind === 'text' && ['.md', '.markdown'].includes(info.extension)

  const saveFile = () => {
    setSaveError('')
    if (shareFile && navigator.share) {
      void navigator.share({ files: [shareFile], title: info?.name }).catch(shareError => {
        if ((shareError as DOMException).name !== 'AbortError') setSaveError('Couldn’t open Save / Share. Use “Open copy” below instead.')
      })
      return
    }
    if (secureRequired() && info) { void downloadSecureFile(reference.path, info.name, info.size).catch(error => { if (error?.name !== 'AbortError') setSaveError(error instanceof Error ? error.message : 'Download failed') }); return }
    const opened = window.open(downloadUrl, '_blank', 'noopener,noreferrer')
    if (!opened) setSaveError('Your browser blocked the new download window. Use “Open copy” below instead.')
  }

  return <div className="file-viewer-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose()
  }}>
    <section className="file-viewer" role="dialog" aria-modal="true" aria-labelledby="file-viewer-title"
      onPointerDown={event => {
        if (metadataOpen && !metadataPanel.current?.contains(event.target as Node) && !identityButton.current?.contains(event.target as Node)) closeMetadata()
      }}>
      {metadataOpen && info && <button className="file-viewer-details-dismiss" type="button" tabIndex={-1} aria-label="Dismiss file details" onClick={closeMetadata} />}
      <header className="file-viewer-header">
        <button
          ref={identityButton}
          className="file-viewer-identity"
          type="button"
          onClick={() => metadataOpen ? closeMetadata() : setMetadataOpen(true)}
          disabled={!info}
          aria-expanded={metadataOpen}
          aria-controls="file-viewer-details"
          title="View file details"
        >
          <span>
            <span className="file-viewer-title" id="file-viewer-title">{title}{reference.line ? ` · line ${reference.line}` : ''}</span>
            <span className="file-viewer-path">{reference.path}</span>
          </span>
          <span className="file-viewer-details-toggle" aria-hidden="true">⌄</span>
        </button>
        <div className="file-viewer-actions">
          {info && <button type="button" className="file-pin-button" aria-label={pinned ? 'Bỏ ghim file' : 'Ghim file'} aria-pressed={pinned} onClick={() => togglePin({ path: info.path, kind: 'file' })}>{pinned ? '★' : '☆'}</button>}
          {secureRequired() && info && <a className="quiet-button" href={fileViewerUrl(reference)} target="_blank" rel="noopener noreferrer">Open</a>}
          {!secureRequired() && info?.previewable && !svg && !['docx', 'pptx'].includes(info.kind) && <a className="quiet-button" href={html ? htmlPreviewUrl : previewUrl} target="_blank" rel="noreferrer">Open</a>}
          {info && <button className="primary-button" type="button" onClick={saveFile} disabled={nativeShare && sharePreparing}>
            {nativeShare ? (sharePreparing ? 'Preparing…' : 'Save / Share') : 'Download'}
          </button>}
          <button ref={closeButton} className="icon-button" type="button" onClick={onClose} aria-label="Close file viewer">×</button>
        </div>
      </header>
      <div className="file-viewer-information">
        {saveError && <p className="file-viewer-save-error" role="alert">{saveError}</p>}
        {storageError && <p role="status">Không lưu được danh sách ghim trên trình duyệt. Các thay đổi chỉ giữ trong phiên này.</p>}
        <div className="file-viewer-meta">
          {info ? <><span>{formatFileSize(info.size)}</span><span>{formatFileType(info)}</span></> : <span>Loading file…</span>}
          {(markdown || html || svg) && info.previewable && <div className="file-text-mode" role="group" aria-label={svg ? "SVG view mode" : html ? "HTML view mode" : "Markdown view mode"}>
            <button type="button" className={textMode === 'preview' ? 'is-active' : ''} onClick={() => setTextMode('preview')}>Preview</button>
            <button type="button" className={textMode === 'raw' ? 'is-active' : ''} onClick={() => setTextMode('raw')}>Raw</button>
          </div>}
        </div>
        {metadataOpen && info && <div ref={metadataPanel} className="file-viewer-details-bubble" id="file-viewer-details" role="region" aria-label="File details">
          <div className="file-viewer-details-heading">
            <strong>Thông tin tệp</strong>
            <button ref={metadataCloseButton} className="icon-button" type="button" onClick={closeMetadata} aria-label="Close file details">×</button>
          </div>
          <dl className="file-viewer-details">
            <div><dt>Name</dt><dd>{info.name}</dd></div>
            <div className="is-wide"><dt>Full path</dt><dd>{info.path}</dd></div>
            <div><dt>Format</dt><dd>{formatFileType(info)}</dd></div>
            <div><dt>MIME type</dt><dd>{info.contentType.split(';', 1)[0]}</dd></div>
            <div><dt>Size</dt><dd>{formatFileSize(info.size)} ({info.size.toLocaleString()} bytes)</dd></div>
            <div><dt>Preview</dt><dd>{info.previewable ? 'Available' : 'Download only'}</dd></div>
            <div><dt>Modified</dt><dd>{formatTimestamp(info.modifiedAt)}</dd></div>
            <div><dt>Created</dt><dd>{formatTimestamp(info.createdAt)}</dd></div>
          </dl>
        </div>}
      </div>
      <div ref={bodyRef} className={`file-viewer-body${svg && textMode === 'preview' ? ' is-svg' : html && textMode === 'preview' ? ' is-html' : info?.kind ? ` is-${info.kind}` : ''}`}>
        {error && <div className="file-viewer-empty" role="alert"><strong>Couldn’t open file</strong><p>{error}</p><button type="button" className="quiet-button" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>}
        {!error && !info && <span className="spinner" aria-label="Loading file" />}
        {!error && info?.kind === 'text' && info.previewable && text === null && <span className="spinner" aria-label="Loading text" />}
        {!error && info?.kind === 'text' && info.previewable && text !== null && markdown && textMode === 'preview' && (
          <MarkdownPreview text={text} currentPath={reference.path} onOpenFile={onOpenFile} onOpenLink={onOpenLink} />
        )}
        {!error && info?.kind === 'text' && info.previewable && text !== null && ((!markdown && !html && !svg) || textMode === 'raw') && (
          <TextPreview text={text} targetLine={reference.line} autoScroll={readScreenState(`file:${reference.path}:scroll:${textMode}`, null) === null} />
        )}
        {!error && svg && info.previewable && text !== null && textMode === 'preview' && <SvgPreview key={reference.path} text={text} name={info.name} />}
        {!error && html && info.previewable && text !== null && textMode === 'preview' && (
          <SecureHtml frameRef={htmlFrameRef} key={`${reference.path}:${attempt}`} path={reference.path} title={info.name} />
        )}
        {!error && info?.kind === 'image' && <SecureMedia path={reference.path} title={info.name} image />}
        {!error && info?.kind === 'pdf' && <Suspense fallback={<span className="spinner" aria-label="Đang tải trình xem PDF" />}><PptxPreview key={reference.path} path={reference.path} name={info.name} format="pdf" /></Suspense>}
        {!error && info?.kind === 'pptx' && info.previewable && <Suspense fallback={<span className="spinner" aria-label="Đang tải trình xem slide" />}><PptxPreview key={reference.path} path={reference.path} name={info.name} /></Suspense>}
        {!error && info?.kind === 'docx' && info.previewable && <DocxPreview key={reference.path} stateKey={reference.path} blob={docxBlob} name={info.name} onOpenLink={href => {
          const local = resolveMarkdownFileReference(href, reference.path)
          if (local) onOpenFile?.(local)
          else if (/^https?:\/\//i.test(href)) onOpenLink?.({ url: href })
        }} />}
        {!error && info && !info.previewable && <div className="file-viewer-empty">
          <strong>{info.kind === 'pptx' ? 'PPTX quá lớn để xem trước (tối đa 20 MB)' : info.kind === 'docx' ? 'Tệp Word quá lớn để xem trước (tối đa 20 MB)' : info.kind === 'text' ? 'This text file is too large to preview' : 'Preview isn’t available for this file type'}</strong>
          <p>{nativeShare ? 'Use Save / Share, then choose “Save to Files” on iPhone or iPad.' : 'Download it to this device and open it with a compatible app.'}</p>
          <div className="file-viewer-save-actions">
            <button className="primary-button" type="button" onClick={saveFile} disabled={nativeShare && sharePreparing}>
              {nativeShare ? (sharePreparing ? 'Preparing file…' : 'Save / Share') : `Download ${info.name}`}
            </button>
            <a className="quiet-button" href={secureRequired() ? fileViewerUrl(reference) : downloadUrl} target="_blank" rel="noreferrer">Open copy</a>
          </div>
        </div>}
      </div>
    </section>
  </div>
}
