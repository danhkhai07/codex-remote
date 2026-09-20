import { useEffect, useId, useRef, useState } from 'react'

export function ConversationActions({ title, archiveDisabled, onRename, onArchive, onMove, onLeader, isLeader, leaderDisabled }: {
  title: string
  archiveDisabled: boolean
  onRename: () => void
  onArchive: () => void
  onMove?: () => void
  onLeader?: () => void
  isLeader?: boolean
  leaderDisabled?: boolean
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
  function choose(action: () => void) {
    panel.current?.hidePopover()
    action()
  }
  return <>
    <button type="button" className="thread-actions-button" popoverTarget={id}
      aria-label={`Actions for ${title}`} title="Conversation actions" onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect()
        const height = 116 + (onMove ? 44 : 0) + (onLeader ? 44 : 0)
        setPosition({ left: Math.max(8, Math.min(rect.right - 208, window.innerWidth - 216)),
          top: rect.bottom + height <= window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - height) })
      }}>⋯</button>
    <div id={id} ref={panel} popover="auto" role="group" aria-label={`Actions for ${title}`}
      className="thread-actions-popover" style={position} onToggle={event => setOpen(event.newState === 'open')}>
      <button type="button" onClick={() => choose(onRename)}>Rename</button>
      {onMove && <button type="button" onClick={() => choose(onMove)}>Move to folder</button>}
      {onLeader && <button type="button" disabled={leaderDisabled} onClick={() => choose(onLeader)}>{isLeader ? '☆ Bỏ vai trò leader' : '★ Đặt làm leader'}</button>}
      <button type="button" disabled={archiveDisabled} onClick={() => choose(onArchive)}>Archive</button>
    </div>
  </>
}
