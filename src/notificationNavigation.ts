// Only the target ID is kept in the URL fragment. The owner gate and normal
// authenticated/encrypted thread API still decide whether it can be opened.
export type NotificationTarget = { threadId: string; sequence: number }
let pending: NotificationTarget | null = null
let sequence = 0
const listeners = new Set<(target: NotificationTarget | null) => void>()
export function validNotificationThread(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
}
export function threadFromNotificationHash(hash: string): string | null {
  const match = /^#thread=([A-Za-z0-9_-]{1,128})$/.exec(hash)
  return match?.[1] ?? null
}
function publish(threadId: string | null) {
  pending = threadId ? { threadId, sequence: ++sequence } : null
  for (const listener of listeners) listener(pending)
}
export function pendingNotificationTarget() { return pending }
export function subscribeNotificationTarget(listener: (target: NotificationTarget | null) => void) {
  listeners.add(listener)
  listener(pending)
  return () => { listeners.delete(listener) }
}
export function consumeNotificationTarget(target: NotificationTarget) {
  if (pending?.sequence !== target.sequence) return
  if (threadFromNotificationHash(window.location.hash) === target.threadId) {
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  }
  publish(null)
}
export function installNotificationNavigation() {
  const onHash = () => publish(threadFromNotificationHash(window.location.hash))
  const onMessage = (event: MessageEvent) => {
    const source = event.source as ServiceWorker | null
    let trusted = false
    try {
      const url = new URL(source?.scriptURL ?? '')
      trusted = url.origin === window.location.origin && url.pathname === '/sw.js'
    } catch { /* Non-worker/untrusted messages do not route the app. */ }
    if (!trusted || window.self !== window.top || window.location.pathname !== '/' || event.data?.type !== 'CODEX_OPEN_THREAD' || !validNotificationThread(event.data.threadId)) return
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#thread=${event.data.threadId}`)
    publish(event.data.threadId)
    event.ports[0]?.postMessage({ accepted: true })
  }
  onHash()
  window.addEventListener('hashchange', onHash)
  navigator.serviceWorker?.addEventListener('message', onMessage)
  return () => {
    window.removeEventListener('hashchange', onHash)
    navigator.serviceWorker?.removeEventListener('message', onMessage)
  }
}
