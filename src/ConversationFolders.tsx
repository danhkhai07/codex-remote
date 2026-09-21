import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { groupConversations, type ConversationGroup, type GroupSnapshot } from './conversationGroups'
import { threadTitle } from './model'
import type { Thread } from './types'

type FolderDialogState =
  | { kind: 'create' }
  | { kind: 'rename' | 'delete'; group: ConversationGroup }
  | { kind: 'move'; thread: Thread }

type FolderOperations = {
  create: (name: string) => Promise<void>
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>
  move: (threadId: string, groupId: string | null) => Promise<void>
}

function FolderActions({ group, disabled, createDisabled, onCreate, onContext, onEdit }: {
  group: ConversationGroup
  disabled: boolean
  createDisabled: boolean
  onCreate: () => void
  onContext: () => void
  onEdit: (kind: 'rename' | 'delete') => void
}) {
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  useEffect(() => {
    if (!open) return
    const close = () => panel.current?.hidePopover()
    window.addEventListener('resize', close)
    document.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('resize', close)
      document.removeEventListener('scroll', close, true)
    }
  }, [open])
  const choose = (action: () => void) => { panel.current?.hidePopover(); action() }
  return <>
    <button type="button" className="thread-actions-button" popoverTarget={id}
      aria-label={`Folder actions for ${group.name}`} title="Folder actions" onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect()
        setPosition({ left: Math.max(8, Math.min(rect.right - 208, window.innerWidth - 216)),
          top: rect.bottom + 194 <= window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - 194) })
      }}>⋯</button>
    <div id={id} ref={panel} popover="auto" role="group" aria-label={`Folder actions for ${group.name}`}
      className="thread-actions-popover folder-actions-popover" style={position} onToggle={event => setOpen(event.newState === 'open')}>
      <button type="button" disabled={disabled || createDisabled} onClick={() => choose(onCreate)}>New conversation here</button>
      <button type="button" title={group.contextPath} onClick={() => choose(onContext)}>Open folder context</button>
      <button type="button" disabled={disabled} onClick={() => choose(() => onEdit('rename'))}>Rename folder</button>
      <button type="button" disabled={disabled} onClick={() => choose(() => onEdit('delete'))}>Delete folder</button>
    </div>
  </>
}

function FolderDialog({ state, snapshot, operations, disabled, onClose }: {
  state: FolderDialogState
  snapshot: GroupSnapshot
  operations: FolderOperations
  disabled: boolean
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState(state.kind === 'rename' ? state.group.name : '')
  const [groupId, setGroupId] = useState(state.kind === 'move' ? snapshot.assignments[state.thread.id] ?? '' : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const mounted = useRef(true)
  const titleId = useId()
  useEffect(() => {
    mounted.current = true
    dialog.current?.showModal()
    dialog.current?.querySelector('input')?.select()
    return () => { mounted.current = false; dialog.current?.close() }
  }, [])
  const title = state.kind === 'create' ? 'New conversation folder' : state.kind === 'rename' ? 'Rename folder'
    : state.kind === 'delete' ? 'Delete folder?' : 'Move conversation'
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (lock.current || disabled) return
    if ((state.kind === 'create' || state.kind === 'rename') && !name.trim()) return
    lock.current = true
    setSaving(true)
    setError('')
    try {
      if (state.kind === 'create') await operations.create(name.trim())
      else if (state.kind === 'rename') await operations.rename(state.group.id, name.trim())
      else if (state.kind === 'delete') await operations.remove(state.group.id)
      else if (state.kind === 'move') await operations.move(state.thread.id, groupId || null)
      if (mounted.current) onClose()
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not save folder')
    } finally {
      lock.current = false
      if (mounted.current) setSaving(false)
    }
  }
  return <dialog ref={dialog} className="rename-dialog folder-dialog" aria-labelledby={titleId} aria-busy={saving}
    onCancel={event => { event.preventDefault(); if (!lock.current) onClose() }}
    onClick={event => {
      if (event.target !== event.currentTarget || lock.current) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
    }}>
    <h2 id={titleId}>{title}</h2>
    <form onSubmit={event => void submit(event)}>
      {(state.kind === 'create' || state.kind === 'rename') && <>
        <label htmlFor={`${titleId}-name`}>Folder name</label>
        <input id={`${titleId}-name`} value={name} onChange={event => setName(event.target.value)} maxLength={120}
          required disabled={saving} autoFocus autoComplete="off" enterKeyHint="done" />
        <p className="muted">Conversations in this folder share its context and the common vault context.</p>
      </>}
      {state.kind === 'delete' && <p>Conversations in “{state.group.name}” will move to Ungrouped. Its context files stay in the vault.</p>}
      {state.kind === 'move' && <>
        <p className="folder-dialog-thread">{threadTitle(state.thread)}</p>
        <label htmlFor={`${titleId}-folder`}>Folder</label>
        <select id={`${titleId}-folder`} value={groupId} onChange={event => setGroupId(event.target.value)} disabled={saving} autoFocus>
          <option value="">Ungrouped</option>
          {snapshot.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
        <p className="muted">The chosen folder context applies from the next message.</p>
      </>}
      {disabled && <p className="muted">Reconnect to save changes.</p>}
      {error && <p className="error-banner" role="alert">{error}</p>}
      <div className="rename-actions">
        <button type="button" className="quiet-button" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" className="primary-button" disabled={saving || disabled || ((state.kind === 'create' || state.kind === 'rename') && !name.trim())}>
          {saving ? 'Saving…' : state.kind === 'delete' ? 'Delete folder' : state.kind === 'create' ? 'Create folder' : 'Save'}
        </button>
      </div>
    </form>
  </dialog>
}

export function ConversationFolders({ snapshot, error, threads, selectedId, searching, disabled, createDisabled, operations,
  onRefresh, onCreate, onContext, onVault, renderThread }: {
  snapshot: GroupSnapshot | null
  error: string
  threads: Thread[]
  selectedId: string | null
  searching: boolean
  disabled: boolean
  createDisabled: boolean
  operations: FolderOperations
  onRefresh: () => void
  onCreate: (groupId: string) => void
  onContext: (path: string) => void
  onVault: (path: string) => void
  renderThread: (thread: Thread, onMove?: () => void) => ReactNode
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [dialog, setDialog] = useState<FolderDialogState | null>(null)
  const folders = useMemo(() => snapshot ? groupConversations(threads, snapshot) : [], [threads, snapshot])
  const selectedGroup = selectedId ? snapshot?.assignments[selectedId] ?? 'ungrouped' : null
  const selectedIsLeader = snapshot?.groups.some(group => group.leaderThreadId === selectedId) ?? false
  useEffect(() => {
    if (selectedGroup && !selectedIsLeader) setCollapsed(current => current[selectedGroup] ? { ...current, [selectedGroup]: false } : current)
  }, [selectedId, selectedGroup, selectedIsLeader])
  return <>
    {snapshot && <div className="conversation-folders-toolbar">
      <span>Folders</span>
      <button type="button" className="folder-context-button" title={`Shared by all conversations: ${snapshot.sharedContextPath}`}
        onClick={() => onContext(snapshot.sharedContextPath)}>Shared context</button>
      <button type="button" className="folder-icon-button" title={snapshot.vaultPath} aria-label="Open context vault" onClick={() => onVault(snapshot.vaultPath)}>↗</button>
      <button type="button" className="folder-icon-button" aria-label="New conversation folder" title="New folder" disabled={disabled} onClick={() => setDialog({ kind: 'create' })}>+</button>
    </div>}
    {error && <div className="folder-load-error" role="status"><span>Folders could not sync.</span><button type="button" title={error} onClick={onRefresh}>Retry</button></div>}
    {!snapshot && !error && <p className="folder-loading muted">Loading folders…</p>}
    {!snapshot ? threads.map(thread => renderThread(thread)) : folders.map(({ group, threads: grouped }) => {
      if (searching && !grouped.length) return null
      const id = group?.id ?? 'ungrouped'
      const expanded = searching || !collapsed[id]
      const visible = expanded ? grouped : grouped.filter(thread => thread.id === group?.leaderThreadId)
      return <section className="conversation-folder" key={id} aria-label={group?.name ?? 'Ungrouped'}>
        <div className="conversation-folder-heading">
          <button type="button" className="conversation-folder-toggle" aria-expanded={expanded}
            onClick={() => setCollapsed(current => ({ ...current, [id]: !current[id] }))}>
            <span className="folder-chevron" aria-hidden="true">{expanded ? '⌄' : '›'}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" /></svg>
            <span className="folder-name">{group?.name ?? 'Ungrouped'}</span>
            <span className="folder-count">{grouped.length}</span>
          </button>
          {group && <FolderActions group={group} disabled={disabled} createDisabled={createDisabled} onCreate={() => { setCollapsed(current => ({ ...current, [id]: false })); onCreate(group.id) }}
            onContext={() => onContext(group.contextPath)} onEdit={kind => setDialog({ kind, group })} />}
        </div>
        {(expanded || visible.length > 0) && <div className="conversation-folder-threads">
          {visible.map(thread => renderThread(thread, () => setDialog({ kind: 'move', thread })))}
          {!grouped.length && <p className="folder-empty">No conversations</p>}
        </div>}
      </section>
    })}
    {dialog && snapshot && <FolderDialog state={dialog} snapshot={snapshot} operations={operations} disabled={disabled} onClose={() => setDialog(null)} />}
  </>
}
