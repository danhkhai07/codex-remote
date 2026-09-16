import { useEffect, useState } from 'react'

/** SVG is rendered as an image, never inserted into the app DOM or an active document. */
export function SvgPreview({ text, name }: { text: string; name: string }) {
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const next = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }))
    setUrl(next)
    setFailed(false)
    return () => URL.revokeObjectURL(next)
  }, [text])
  return <div className="svg-preview">
    {failed ? <p role="alert">Không thể hiển thị SVG này. Chọn Raw để xem mã nguồn.</p>
      : url ? <img src={url} alt={name} onError={() => setFailed(true)} />
        : <span className="spinner" aria-label="Loading SVG" />}
  </div>
}
