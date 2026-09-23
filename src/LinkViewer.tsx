import { useEffect, useMemo, useRef, useState } from 'react'
import type { WebLinkReference } from './MarkdownMessage'

export function safeWebUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

export function LinkViewer({ reference, onClose }: {
  reference: WebLinkReference
  onClose: () => void
}) {
  const url = useMemo(() => safeWebUrl(reference.url), [reference.url])
  const [loaded, setLoaded] = useState(false)
  const [copyState, setCopyState] = useState('Copy link')
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    closeButton.current?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    setLoaded(false)
    setCopyState('Copy link')
  }, [reference.url])

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(reference.url)
      setCopyState('Copied')
    } catch {
      setCopyState('Copy failed')
    }
  }

  const title = reference.label?.trim() || url?.hostname || 'External link'

  return <div className="file-viewer-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose()
  }}>
    <section className="file-viewer link-viewer" role="dialog" aria-modal="true" aria-labelledby="link-viewer-title">
      <header className="file-viewer-header">
        <div className="link-viewer-identity">
          <span className="file-viewer-title" id="link-viewer-title">{title}</span>
          <span className="file-viewer-path" title={reference.url}>{reference.url}</span>
        </div>
        <div className="file-viewer-actions">
          {url && <a className="primary-button" href={url.href} target="_blank" rel="noreferrer">Open browser</a>}
          <button className="quiet-button link-copy-button" type="button" onClick={() => void copyLink()}>{copyState}</button>
          <button ref={closeButton} className="icon-button" type="button" onClick={onClose} aria-label="Close link viewer">×</button>
        </div>
      </header>
      <div className="file-viewer-information">
        <div className="file-viewer-meta">
          <span>{url?.hostname ?? 'Invalid link'}</span><span>External preview</span>
        </div>
      </div>
      <div className="file-viewer-body link-viewer-body">
        {!url && <div className="file-viewer-empty" role="alert"><strong>Couldn’t open this link</strong><p>The URL is invalid or uses an unsupported protocol.</p></div>}
        {url && <>
          {!loaded && <span className="spinner link-viewer-spinner" aria-label="Loading link" />}
          <iframe
            src={url.href}
            title={title}
            sandbox="allow-downloads allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
          />
        </>}
      </div>
    </section>
  </div>
}
