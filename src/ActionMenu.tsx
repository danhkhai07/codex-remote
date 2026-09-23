import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const dismissEvent = 'codex-remote:dismiss-action-menus'
export function dismissActionMenus() { document.dispatchEvent(new Event(dismissEvent)) }

// Mount only the open panel. Unsupported native popover attributes otherwise
// leave every conversation's actions visible on older iOS/WebKit versions.
export function ActionMenu({ label, title, className = '', children }: {
  label: string
  title: string
  className?: string
  children: (choose: (action: () => void) => void) => ReactNode
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  useLayoutEffect(() => {
    if (!open || !trigger.current || !panel.current) return
    const anchor = trigger.current.getBoundingClientRect(), menu = panel.current.getBoundingClientRect()
    const viewport = window.visualViewport
    const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
    const width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight
    setPosition({ left: Math.max(left + 8, Math.min(anchor.right - menu.width, left + width - menu.width - 8)),
      top: Math.max(top + 8, Math.min(anchor.bottom + 4 + menu.height <= top + height - 8 ? anchor.bottom + 4 : anchor.top - menu.height - 4, top + height - menu.height - 8)) })
    panel.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
  }, [open])
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const outside = (event: Event) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) close()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const buttons = panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
        const edge = event.shiftKey ? buttons?.[0] : buttons?.[buttons.length - 1]
        if (edge === document.activeElement) {
          close(); trigger.current?.focus({ preventScroll: true })
        }
        return
      }
      if (event.key !== 'Escape') return
      event.preventDefault(); close(); trigger.current?.focus({ preventScroll: true })
    }
    const scroll = (event: Event) => { if (!(event.target instanceof Node && panel.current?.contains(event.target))) close() }
    document.addEventListener(dismissEvent, close)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    document.addEventListener('keydown', escape)
    document.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', close)
    window.visualViewport?.addEventListener('resize', close)
    return () => {
      document.removeEventListener(dismissEvent, close)
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('keydown', escape)
      document.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', close)
      window.visualViewport?.removeEventListener('resize', close)
    }
  }, [open])
  return <>
    <button ref={trigger} type="button" className="thread-actions-button" aria-label={label} title={title}
      aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => {
        const next = !open; dismissActionMenus(); setOpen(next)
      }}>⋯</button>
    {open && createPortal(<div ref={panel} id={id} role="group" aria-label={label}
      className={`thread-actions-popover ${className}`} style={position}>
      {children(action => { setOpen(false); trigger.current?.focus({ preventScroll: true }); action() })}
    </div>, document.body)}
  </>
}
