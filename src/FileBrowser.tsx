import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { useRestoredScroll, useScreenState } from './screenState'
import { formatFileSize } from './FileViewer'
import type { DirectoryListing } from './types'
import type { LocalFileReference } from './MarkdownMessage'

export function FileBrowser({ initialPath, covered, onClose, onOpenFile }: {
  initialPath: string
  covered: boolean
  onClose: () => void
  onOpenFile: (reference: LocalFileReference) => void
}) {
  const key = `browser:${initialPath}`
  const [path, setPath] = useScreenState(`${key}:path`, initialPath)
  const [address, setAddress] = useScreenState(`${key}:address`, path)
  const [search, setSearch] = useScreenState(`${key}:search`, '')
  const [query, setQuery] = useState(search)
  const [hidden, setHidden] = useScreenState(`${key}:hidden`, false)
  const [offset, setOffset] = useScreenState(`${key}:offset`, 0)
  const [revision, setRevision] = useState(0)
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const close = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const lastFile = useRef<HTMLButtonElement | null>(null)
  useRestoredScroll(list, `${key}:scroll:${path}:${query}:${offset}`, !loading && Boolean(listing))

  useEffect(() => {
    if (covered) return
    const target = lastFile.current?.isConnected ? lastFile.current : close.current
    target?.focus({ preventScroll: true })
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [covered, onClose])

  useEffect(() => {
    if (search === query) return
    const timer = setTimeout(() => { setQuery(search); setOffset(0) }, 200)
    return () => clearTimeout(timer)
  }, [search, query])

  useEffect(() => {
    const retry = () => setRevision(value => value + 1)
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    void api.directory(path, { search: query, hidden, offset }, controller.signal).then(result => {
      if (controller.signal.aborted) return
      setListing(result)
      setAddress(current => current === path ? result.path : current)
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to list directory')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [path, query, hidden, offset, revision])

  const navigate = (next: string) => {
    setListing(null)
    setPath(next)
    setAddress(next)
    setSearch('')
    setQuery('')
    setOffset(0)
    setRevision(value => value + 1)
    lastFile.current = null
  }

  return <div className="file-browser-backdrop" aria-hidden={covered || undefined} inert={covered} onMouseDown={event => {
    if (event.target === event.currentTarget) onClose()
  }}>
    <section className="file-browser" role="dialog" aria-modal={!covered} aria-labelledby="file-browser-title">
      <header className="file-browser-header">
        <div><h2 id="file-browser-title">Files</h2><p>Browse and preview server files</p></div>
        <button ref={close} type="button" className="icon-button" aria-label="Close file browser" onClick={onClose}>×</button>
      </header>
      <div className="file-browser-controls">
        <div className="file-browser-navigation">
          <button type="button" className="quiet-button" disabled={loading || !listing?.parentPath} onClick={() => listing?.parentPath && navigate(listing.parentPath)} aria-label="Parent directory">↑ Up</button>
          <button type="button" className="quiet-button" onClick={() => navigate(initialPath)} title={initialPath}>Working directory</button>
          <button type="button" className="quiet-button" onClick={() => setRevision(value => value + 1)} aria-label="Refresh directory">↻</button>
        </div>
        <form className="file-browser-address" onSubmit={event => { event.preventDefault(); if (address.trim()) navigate(address.trim()) }}>
          <input aria-label="Directory path" value={address} onChange={event => setAddress(event.target.value)} spellCheck={false} autoCapitalize="none" autoCorrect="off" />
          <button type="submit" className="quiet-button">Go</button>
        </form>
        <div className="file-browser-filter">
          <input type="search" aria-label="Search current folder" placeholder="Search this folder…" value={search} onChange={event => setSearch(event.target.value)} />
          <label><input type="checkbox" checked={hidden} onChange={event => { setHidden(event.target.checked); setOffset(0) }} />Hidden files</label>
        </div>
      </div>
      <div className="file-browser-list" ref={list} aria-busy={loading}>
        {loading && !listing ? <div className="file-browser-empty" role="status"><span className="spinner" />Loading files…</div>
          : error && !listing ? <div className="file-browser-empty" role="alert"><p>{error}</p><button className="quiet-button" onClick={() => setRevision(value => value + 1)}>Retry</button></div>
          : listing?.entries.length === 0 ? <p className="file-browser-empty">{query ? 'No matching files in this folder.' : 'This folder is empty.'}</p>
          : listing?.entries.map(entry => <button key={entry.path} type="button" className="file-browser-entry" disabled={entry.kind === 'unavailable'} title={entry.kind === 'unavailable' ? 'Unavailable or outside allowed workspaces' : entry.path}
            onClick={event => {
              if (entry.kind === 'directory') navigate(entry.path)
              else { lastFile.current = event.currentTarget; onOpenFile({ path: entry.path }) }
            }}>
            <svg className="file-browser-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d={entry.kind === 'directory' ? 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v11H3Z' : 'M6 3h8l4 4v14H6ZM14 3v5h4M9 12h6M9 16h6'} />
            </svg>
            <span className="file-browser-name">{entry.name}{entry.symlink && <small> · Link</small>}</span>
            <span className="file-browser-size">{entry.kind === 'directory' ? 'Folder' : entry.size !== null ? formatFileSize(entry.size) : 'Unavailable'}</span>
          </button>)}
      </div>
      <footer className="file-browser-footer">
        <span>{!loading && !error && listing ? `${listing.total ? listing.offset + 1 : 0}–${Math.min(listing.offset + listing.entries.length, listing.total)} of ${listing.total}` : 'Read-only browser'}</span>
        <div><button type="button" className="quiet-button" disabled={loading || Boolean(error) || offset === 0} onClick={() => setOffset(Math.max(0, offset - (listing?.limit ?? 100)))}>Previous</button>
          <button type="button" className="quiet-button" disabled={loading || Boolean(error) || !listing || offset + listing.limit >= listing.total} onClick={() => setOffset(offset + (listing?.limit ?? 100))}>Next</button></div>
      </footer>
    </section>
  </div>
}
