import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { usePinnedFiles } from './pinnedFiles'
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
  const { pins, storageError, togglePin } = usePinnedFiles()
  const isPinned = (path: string) => pins.some(pin => pin.path === path)
  const [editingPath, setEditingPath] = useState(false)
  const menu = useRef<HTMLDetailsElement>(null)
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
  const [roots, setRoots] = useState<string[]>([])
  useEffect(() => {
    const abort = new AbortController()
    void api.fileRoots(abort.signal).then(result => { if (!abort.signal.aborted) setRoots(result.roots) }).catch(() => {})
    return () => abort.abort()
  }, [])
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
    setEditingPath(false)
    if (menu.current) menu.current.open = false
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
        <h2 id="file-browser-title">Files</h2>
        <div className="file-browser-header-actions">

          <button ref={close} type="button" className="icon-button" aria-label="Close file browser" onClick={onClose}>×</button>
        </div>
      </header>
      <div className="file-browser-controls">
        <div className="file-browser-location">
          <button type="button" className="icon-button" disabled={loading || !listing?.parentPath} onClick={() => listing?.parentPath && navigate(listing.parentPath)} aria-label="Parent directory">↑</button>
          <button type="button" className="file-browser-current" title={listing?.path ?? path} aria-label="Edit directory path" aria-expanded={editingPath} onClick={() => setEditingPath(value => !value)}>
            <strong>{(listing?.path ?? path).split('/').filter(Boolean).at(-1) ?? '/'}</strong>
            <small>{listing?.path ?? path}</small>
          </button>
          <details className="file-browser-menu" ref={menu}>
            <summary className="icon-button" aria-label="File browser options">⋯</summary>
            <div className="file-browser-menu-panel">
              <button type="button" onClick={() => navigate(initialPath)}>Working directory</button>
              {roots.map(root => <button key={root} type="button" onClick={() => navigate(root)}>{root}</button>)}
              <button type="button" onClick={() => { setRevision(value => value + 1); if (menu.current) menu.current.open = false }}>Refresh</button>
              <label><input type="checkbox" checked={hidden} onChange={event => { setHidden(event.target.checked); setOffset(0) }} />Hidden files</label>
            </div>
          </details>
        </div>
        {editingPath && <form className="file-browser-address" onSubmit={event => { event.preventDefault(); if (address.trim()) navigate(address.trim()) }}>
          <input autoFocus aria-label="Directory path" value={address} onChange={event => setAddress(event.target.value)} spellCheck={false} autoCapitalize="none" autoCorrect="off" />
          <button type="submit" className="quiet-button">Go</button>
        </form>}
        <div className="file-browser-filter">
          <input type="search" aria-label="Search current folder" placeholder="Search files…" value={search} onChange={event => setSearch(event.target.value)} />
        </div>
      </div>
      <div className="file-browser-list" ref={list} aria-busy={loading}>
        {storageError && <p className="file-browser-storage-note" role="status">Không lưu được danh sách ghim trên trình duyệt. Các thay đổi chỉ giữ trong phiên này.</p>}
        {pins.length > 0 && <details className="file-browser-pins" aria-label="Đã ghim">
          <summary>★ Đã ghim <span>{pins.length}</span></summary>
          {pins.map(pin => <div className="file-browser-row" key={pin.path}>
            <button type="button" className="file-browser-entry" title={pin.path} onClick={event => {
              if (pin.kind === 'directory') navigate(pin.path)
              else { lastFile.current = event.currentTarget; onOpenFile({ path: pin.path }) }
            }}><span aria-hidden="true">{pin.kind === 'directory' ? '▣' : '▤'}</span><span className="file-browser-name">{pin.path.split('/').filter(Boolean).at(-1) ?? '/'}<small className="file-browser-pin-path">{pin.path}</small></span><span className="file-browser-size">{pin.kind === 'directory' ? 'Folder' : 'File'}</span></button>
            <button type="button" className="file-pin-button" aria-label={`Bỏ ghim ${pin.path}`} aria-pressed="true" onClick={() => togglePin(pin)}>★</button>
          </div>)}
        </details>}
        {loading && !listing ? <div className="file-browser-empty" role="status"><span className="spinner" />Loading files…</div>
          : error && !listing ? <div className="file-browser-empty" role="alert"><p>{error}</p>{roots.map(root => <button key={root} className="quiet-button" onClick={() => navigate(root)}>{root}</button>)}<button className="quiet-button" onClick={() => setRevision(value => value + 1)}>Retry</button></div>
          : listing?.entries.length === 0 ? <p className="file-browser-empty">{query ? 'No matching files in this folder.' : 'This folder is empty.'}</p>
          : listing?.entries.map(entry => <div className="file-browser-row" key={entry.path}><button type="button" className="file-browser-entry" disabled={entry.kind === 'unavailable'} title={entry.kind === 'unavailable' ? 'Unavailable or outside allowed workspaces' : entry.path}
            onClick={event => {
              if (entry.kind === 'directory') navigate(entry.path)
              else { lastFile.current = event.currentTarget; onOpenFile({ path: entry.path }) }
            }}>
            <svg className="file-browser-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d={entry.kind === 'directory' ? 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v11H3Z' : 'M6 3h8l4 4v14H6ZM14 3v5h4M9 12h6M9 16h6'} />
            </svg>
            <span className="file-browser-name">{entry.name}{entry.symlink && <small> · Link</small>}</span>
            <span className="file-browser-size">{entry.kind === 'directory' ? 'Folder' : entry.size !== null ? formatFileSize(entry.size) : 'Unavailable'}</span>
          </button><button type="button" className="file-pin-button" disabled={entry.kind === 'unavailable'}
            aria-label={`${isPinned(entry.path) ? 'Bỏ ghim' : 'Ghim'} ${entry.name}`} aria-pressed={isPinned(entry.path)}
            onClick={() => { if (entry.kind !== 'unavailable') togglePin({ path: entry.path, kind: entry.kind === 'directory' ? 'directory' : 'file' }) }}>{isPinned(entry.path) ? '★' : '☆'}</button></div>)}
      </div>
      <footer className="file-browser-footer">
        <span>{!loading && !error && listing ? `${listing.total ? listing.offset + 1 : 0}–${Math.min(listing.offset + listing.entries.length, listing.total)} of ${listing.total}` : 'Read-only browser'}</span>
        {listing && (offset > 0 || listing.total > listing.limit) && <div><button type="button" className="quiet-button" disabled={loading || Boolean(error) || offset === 0} onClick={() => setOffset(Math.max(0, offset - (listing?.limit ?? 100)))}>Previous</button>
          <button type="button" className="quiet-button" disabled={loading || Boolean(error) || !listing || offset + listing.limit >= listing.total} onClick={() => setOffset(offset + (listing?.limit ?? 100))}>Next</button></div>}
      </footer>
    </section>
  </div>
}
