import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { readScreenState, writeScreenState } from './screenState'

export type ReadingPosition = { top: number; following: boolean }

/** Owns only the transcript's scroll; never scrolls the document or composer. */
export function TranscriptViewport({ children, positions, viewKey, ready, onOlder, hasOlder, olderLoading, onLatest, frozen = false }: {
  children: ReactNode
  positions: Map<string, ReadingPosition>
  viewKey: string
  ready: boolean
  onOlder?: () => Promise<void>
  hasOlder?: boolean
  olderLoading?: boolean
  onLatest?: () => void
  frozen?: boolean
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const savedPosition = positions.get(viewKey) ?? readScreenState<ReadingPosition | null>(`reading:${viewKey}`, null)
  const following = useRef(!frozen && (savedPosition?.following ?? true))
  const frozenRef = useRef(frozen)
  frozenRef.current = frozen
  const resumeRequested = useRef(false)
  const [reading, setReading] = useState(!following.current)
  const [unread, setUnread] = useState(false)
  const lastTop = useRef(0)
  const touchY = useRef<number | null>(null)
  const anchor = useRef<{ id: string; top: number } | null>(null)
  const firstItem = useRef<string | undefined>(undefined)
  const loadingOlder = useRef(false)
  function rememberAnchor() {
    const element = viewport.current
    if (!element) return
    const top = element.getBoundingClientRect().top
    const row = [...element.querySelectorAll<HTMLElement>('[data-history-anchor]')].find(node => node.getBoundingClientRect().bottom > top)
    anchor.current = row ? { id: row.dataset.historyAnchor!, top: row.getBoundingClientRect().top - top } : null
  }
  async function older() {
    if (!hasOlder || olderLoading || loadingOlder.current || !onOlder) return
    rememberAnchor(); pause(); loadingOlder.current = true
    try { await onOlder() } finally { loadingOlder.current = false }
  }
  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const first = element.querySelector<HTMLElement>('[data-history-anchor]')?.dataset.historyAnchor
    if (first !== firstItem.current && !following.current && anchor.current) {
      const row = [...element.querySelectorAll<HTMLElement>('[data-history-anchor]')].find(node => node.dataset.historyAnchor === anchor.current!.id)
      if (row) element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - anchor.current.top
      lastTop.current = element.scrollTop
    }
    firstItem.current = first
    rememberAnchor()
  }, [children])

  function pause() {
    resumeRequested.current = false
    following.current = false
    setReading(true)
    const position = { top: viewport.current?.scrollTop ?? 0, following: false }
    positions.set(viewKey, position)
    writeScreenState(`reading:${viewKey}`, position)
  }

  function followLatest() {
    const element = viewport.current
    if (!element) return
    following.current = true
    element.scrollTop = element.scrollHeight
    lastTop.current = element.scrollTop
    setReading(false)
    setUnread(false)
    const position = { top: element.scrollTop, following: true }
    positions.set(viewKey, position)
    writeScreenState(`reading:${viewKey}`, position)
  }

  function latest() {
    if (frozen) {
      // The displayed bottom may have evicted newer messages. Wait for App to
      // restore latest; do not declare this partial window live-following.
      resumeRequested.current = true
      onLatest?.()
    } else { onLatest?.(); followLatest() }
  }

  useLayoutEffect(() => {
    if (frozen) { pause(); rememberAnchor() }
    else if (resumeRequested.current) {
      resumeRequested.current = false
      followLatest()
    }
  }, [frozen])

  useLayoutEffect(() => {
    if (!ready) return
    const element = viewport.current!
    const body = content.current!
    const saved = positions.get(viewKey) ?? readScreenState<ReadingPosition | null>(`reading:${viewKey}`, null)
    element.scrollTop = saved && !saved.following ? saved.top : element.scrollHeight
    lastTop.current = element.scrollTop
    let height = body.scrollHeight
    const observer = new ResizeObserver(() => {
      if (following.current && !frozenRef.current) {
        element.scrollTop = element.scrollHeight
        rememberAnchor()
        lastTop.current = element.scrollTop
        const position = { top: element.scrollTop, following: following.current }
        positions.set(viewKey, position)
        writeScreenState(`reading:${viewKey}`, position)
      } else if (body.scrollHeight > height) {
        setUnread(true)
      }
      height = body.scrollHeight
    })
    observer.observe(element)
    observer.observe(body)
    return () => {
      positions.set(viewKey, { top: element.scrollTop, following: following.current })
      observer.disconnect()
    }
  }, [positions, viewKey, ready])

  return <div className="transcript-region">
    <div className="workspace-content" ref={viewport} tabIndex={0} aria-label="Conversation transcript"
      onWheel={(event) => { if (event.deltaY < 0) { pause(); rememberAnchor(); if (event.currentTarget.scrollTop < 160) void older() } }}
      onTouchStart={(event) => { touchY.current = event.touches[0]?.clientY ?? null }}
      onTouchMove={(event) => {
        const y = event.touches[0]?.clientY
        if (y !== undefined && touchY.current !== null && y > touchY.current + 3) { pause(); rememberAnchor(); if (event.currentTarget.scrollTop < 160) void older() }
        touchY.current = y ?? null
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) { pause(); rememberAnchor(); if (event.currentTarget.scrollTop < 160) void older() }
        if (event.key === 'End') { event.preventDefault(); latest() }
      }}
      onScroll={(event) => {
        const element = event.currentTarget
        const atBottom = element.scrollHeight - element.clientHeight - element.scrollTop <= 24
        if (frozen) {
          // Scrolling/anchor restoration cannot unfreeze application history.
          if (!resumeRequested.current) pause()
        } else if (atBottom) {
          following.current = true
          setReading(false)
          setUnread(false)
        } else if (element.scrollTop < lastTop.current - 1) pause()
        rememberAnchor()
        lastTop.current = element.scrollTop
        const position = { top: element.scrollTop, following: following.current }
        positions.set(viewKey, position)
        writeScreenState(`reading:${viewKey}`, position)
      }}
      onClickCapture={(event) => {
        if ((event.target as HTMLElement).closest('summary, [data-load-older]')) { pause(); rememberAnchor() }
      }}
    >
      <div className="transcript-content" ref={content}>{children}</div>
    </div>
    {(frozen || reading) && <button className="jump-latest" onClick={latest} type="button">
      <span aria-hidden="true">↓</span> {unread ? 'New output · Jump to latest' : 'Jump to latest'}
    </button>}
  </div>
}
