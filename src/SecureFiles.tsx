import { useEffect, useRef, useState, type RefObject } from 'react'
import { boundedBlob } from './boundedBlob'
import { api, serverFileUrl } from './api'
import { secureFetch, secureObjectUrl, secureRequired, revokeSecureUrl } from './secureApi'
export function SecureHtml({ path, title, frameRef }: { path: string; title: string; frameRef?: RefObject<HTMLIFrameElement | null> }) {
  const local = useRef<HTMLIFrameElement>(null), frame = frameRef ?? local
  const [html, setHtml] = useState<string | null>(null), [loaded, setLoaded] = useState(false), [error, setError] = useState('')
  useEffect(() => { let active = true; if (secureRequired()) void api.htmlText(path).then(text => { if (active) setHtml(text) }).catch(() => { if (active) setError('Không mở được tài liệu. Thử mở lại.') }); return () => { active = false } }, [path])
  useEffect(() => { if (loaded && html !== null) frame.current?.contentWindow?.postMessage({ type: 'codex-secure-html', html }, '*') }, [loaded, html, frame])
  if (error) return <p role="alert">{error}</p>
  return <iframe ref={frame} title={title} src={secureRequired() ? '/secure-viewer' : `/api/files/html-preview?${new URLSearchParams({ path })}`} onLoad={() => setLoaded(true)} sandbox="allow-scripts" referrerPolicy="no-referrer" />
}
export function SecureMedia({ path, title, image = false }: { path: string; title: string; image?: boolean }) {
  const [url, setUrl] = useState(''), [error, setError] = useState('')
  useEffect(() => {
    if (!secureRequired()) { setUrl(serverFileUrl(path)); return }
    let active = true, objectUrl = ''
    const abort = new AbortController()
    void secureFetch(serverFileUrl(path), { signal: abort.signal }).then(async response => {
      if (!response.ok) { await response.body?.cancel(); throw Error('Không đọc được tệp') }
      const size = Number(response.headers.get('content-length'))
      if (size > 64 * 1024 * 1024) { await response.body?.cancel(); throw Error('Tệp lớn hơn 64 MiB: dùng Download để lưu trực tiếp.') }
      const blob = await boundedBlob(response, 64 * 1024 * 1024)
      if (active) { objectUrl = secureObjectUrl(blob); setUrl(objectUrl) }
    }).catch(error => { if (active) setError(error instanceof Error ? error.message : 'Không mở được tệp') })
    return () => { active = false; abort.abort(); if (objectUrl) revokeSecureUrl(objectUrl) }
  }, [path])
  if (error) return <p role="alert">{error}</p>
  if (!url) return <p role="status">Đang mở tệp…</p>
  return image ? <img src={url} alt={title} /> : <iframe src={url} title={title} sandbox="allow-same-origin" />
}
export async function downloadSecureFile(path: string, name: string, size: number) {
  const picker = (window as unknown as { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{ createWritable(): Promise<WritableStream<Uint8Array>> }> }).showSaveFilePicker
  // Ask for the destination during the click gesture, before the network await.
  const destination = picker ? await picker({ suggestedName: name }) : undefined
  if (!destination && size > 64 * 1024 * 1024) throw Error('Tệp lớn hơn 64 MiB cần trình duyệt hỗ trợ lưu trực tiếp (Chrome/Edge desktop).')
  const response = await secureFetch(serverFileUrl(path, true))
  if (!response.ok || !response.body) { await response.body?.cancel(); throw Error('Không tải được tệp') }
  if (destination) { await response.body.pipeTo(await destination.createWritable()); return }
  const url = secureObjectUrl(await boundedBlob(response, 64 * 1024 * 1024))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  setTimeout(() => revokeSecureUrl(url), 60_000)
}
