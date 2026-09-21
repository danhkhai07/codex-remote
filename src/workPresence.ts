import { secureFetch } from './secureApi'
/** Foreground time only; the heartbeat does not require mouse/keyboard activity. */
export function startWorkPresence(csrf: string, processing: boolean) {
  const clientId = crypto.randomUUID()
  const report = (visible = document.visibilityState === 'visible') => {
    void secureFetch('/api/work-presence', {
      method: 'POST', credentials: 'same-origin', keepalive: true,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ clientId, visible, processing }),
    }).then(response => response.arrayBuffer()).catch(() => undefined)
  }
  const change = () => report()
  const hide = () => report(false)
  report()
  const timer = window.setInterval(() => report(), 15_000)
  document.addEventListener('visibilitychange', change)
  window.addEventListener('pagehide', hide)
  window.addEventListener('pageshow', change)
  return () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', change)
    window.removeEventListener('pagehide', hide)
    window.removeEventListener('pageshow', change)
    report(false)
  }
}
