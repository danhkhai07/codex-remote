import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Thread } from './types'
import { threadTitle } from './model'

export function RenameConversation({ thread, online, onSave, onClose }: {
  thread: Thread
  online: boolean
  onSave: (id: string, name: string) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(threadTitle(thread))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLElement>(null)
  const lock = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    const previous = document.activeElement as HTMLElement | null
    input.current?.focus()
    input.current?.select()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (!lock.current) onClose()
      }
      if (event.key !== 'Tab') return
      const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])]
      if (!focusable.length) { event.preventDefault(); dialog.current?.focus(); return }
      const first = focusable[0], last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', key, true)
    return () => {
      mounted.current = false
      document.removeEventListener('keydown', key, true)
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [onClose])

  async function save(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (lock.current || !online || !trimmed || trimmed.length > 200) return
    lock.current = true
    setSaving(true)
    setError('')
    try {
      await onSave(thread.id, trimmed)
      if (mounted.current) onClose()
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not rename conversation')
    } finally {
      lock.current = false
      if (mounted.current) setSaving(false)
    }
  }

  return <div className="rename-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget && !lock.current) onClose()
  }}>
    <section ref={dialog} tabIndex={-1} className="rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-title" aria-busy={saving}>
      <h2 id="rename-title">Rename conversation</h2>
      <form onSubmit={event => void save(event)}>
        <label htmlFor="conversation-name">Conversation name</label>
        <input ref={input} id="conversation-name" value={name} onChange={event => setName(event.target.value)} maxLength={200} required disabled={saving} autoComplete="off" enterKeyHint="done" />
        <p className="muted">{online ? `${name.length} / 200` : 'Offline — reconnect to save. Your name stays here.'}</p>
        {error && <p className="error-banner" role="alert">{error}</p>}
        <div className="rename-actions">
          <button type="button" className="quiet-button" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="primary-button" disabled={saving || !online || !name.trim()}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </section>
  </div>
}
