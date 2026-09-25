import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { secureIntent } from './secureApi'

export function HistoryDetail({ threadId, cursor }: { threadId: string; cursor: string }) {
  const [page, setPage] = useState<{ text: string; offset: number; next: number | null } | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const pending = useRef<AbortController | null>(null)
  const requestOffset = useRef(0)
  const [trail, setTrail] = useState<number[]>([])
  useEffect(() => () => pending.current?.abort(), [threadId, cursor])
  async function load(offset: number, backwards = false) {
    const intent = secureIntent(); intent.assert()
    pending.current?.abort(); const request = new AbortController(); pending.current = request
    setBusy(true); setError('')
    try { const result = await api.historyDetail(threadId, cursor, offset, request.signal); intent.assert(); if (!request.signal.aborted) {
      if (backwards) setTrail(value => value.slice(0, -1))
      else if (page) setTrail(value => [...value, requestOffset.current].slice(-128))
      requestOffset.current = offset; setPage(result)
    } }
    catch (reason) { if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : 'Không tải được chi tiết') }
    finally { if (pending.current === request) setBusy(false) }
  }
  return <div className="history-detail">
    {!page && <button type="button" className="quiet-button" disabled={busy} onClick={() => void load(0)}>Xem nội dung đầy đủ theo từng phần</button>}
    {page && <><p>Bản ghi gốc (JSON), từng phần tối đa 32 KB.</p><pre>{page.text}</pre><div>
      <button type="button" disabled={busy || !trail.length} onClick={() => void load(trail.at(-1)!, true)}>Phần trước</button>
      <button type="button" disabled={busy || page.next === null} onClick={() => void load(page.next!)}>Phần tiếp</button>
      <button type="button" onClick={() => { pending.current?.abort(); setPage(null); setTrail([]); requestOffset.current = 0 }}>Đóng chi tiết</button>
    </div></>}
    {busy && <span role="status">Đang tải…</span>}{error && <p role="alert">{error}</p>}
  </div>
}
