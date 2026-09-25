import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { secureIntent } from './secureApi'

type DetailOperation = { offset: number; backwards: boolean; from: number; hadPage: boolean }

export function HistoryDetail({ threadId, cursor, expanded }: { threadId: string; cursor: string; expanded: boolean }) {
  const [page, setPage] = useState<{ text: string; offset: number; next: number | null } | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const pending = useRef<AbortController | null>(null)
  const requestOffset = useRef(0)
  const retryOperation = useRef<DetailOperation>({ offset: 0, backwards: false, from: 0, hadPage: false })
  const [trail, setTrail] = useState<number[]>([])
  useEffect(() => () => pending.current?.abort(), [threadId, cursor])
  async function perform(operation: DetailOperation) {
    const intent = secureIntent(); intent.assert()
    retryOperation.current = operation
    pending.current?.abort(); const request = new AbortController(); pending.current = request
    setBusy(true); setError('')
    try { const result = await api.historyDetail(threadId, cursor, operation.offset, request.signal); intent.assert(); if (!request.signal.aborted && pending.current === request && requestOffset.current === operation.from) {
      if (operation.backwards) setTrail(value => value.slice(0, -1))
      else if (operation.hadPage) setTrail(value => [...value, operation.from].slice(-128))
      requestOffset.current = operation.offset; setPage(result)
    } }
    catch (reason) { if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : 'Không tải được chi tiết') }
    finally { if (pending.current === request) setBusy(false) }
  }
  function load(offset: number, backwards = false) {
    return perform({ offset, backwards, from: requestOffset.current, hadPage: page !== null })
  }
  useEffect(() => {
    if (!expanded) {
      pending.current?.abort()
      setBusy(false)
      return
    }
    if (!page && !busy && !error) void load(0)
  // Opening the native disclosure is the only automatic request trigger. Page,
  // busy and error changes must not start a second request or retry a failure.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded])
  if (!expanded) return null
  return <div className="history-detail">
    {page && <><p>Bản ghi gốc (JSON), từng phần tối đa 32 KB.</p><pre>{page.text}</pre><div>
      <button type="button" disabled={busy || !trail.length} onClick={() => void load(trail.at(-1)!, true)}>Phần trước</button>
      <button type="button" disabled={busy || page.next === null} onClick={() => void load(page.next!)}>Phần tiếp</button>
    </div></>}
    {!page && !error && <span role="status">{busy ? 'Đang tải…' : 'Đang chuẩn bị…'}</span>}
    {page && busy && <span role="status">Đang tải…</span>}
    {error && <div><p role="alert">{error}</p><button type="button" disabled={busy} onClick={() => void perform(retryOperation.current)}>Thử lại</button></div>}
  </div>
}
