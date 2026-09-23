import { useEffect, useState } from 'react'
import { api } from './api'
import { FileViewer } from './FileViewer'
import { fileViewerReference, fileViewerUrl } from './fileViewerLink'
import type { LocalFileReference } from './MarkdownMessage'

/** Mounted inside SecureGate: each new tab performs its own owner unlock. */
export function FilePage() {
  const [reference, setReference] = useState(() => fileViewerReference(window.location.pathname + window.location.search))
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    void api.session().then(() => { if (!cancelled) setReady(true) }).catch(() => { if (!cancelled) setError('Không mở được phiên. Đăng nhập lại để xem tệp.') })
    const back = () => setReference(fileViewerReference(window.location.pathname + window.location.search))
    window.addEventListener('popstate', back)
    return () => { cancelled = true; window.removeEventListener('popstate', back) }
  }, [])
  const open = (next: LocalFileReference) => { history.pushState(null, '', fileViewerUrl(next)); setReference(next) }
  return <main className="login-shell">
    <a className="quiet-button" href="/">Về cuộc trò chuyện</a>
    {error ? <p role="alert">{error}</p> : !reference ? <p role="alert">Đường dẫn tệp không hợp lệ.</p> : !ready ? <p role="status">Đang mở tệp…</p> :
      <FileViewer key={reference.path} reference={reference} onClose={() => window.location.assign('/')} onOpenFile={open} />}
  </main>
}
