const CACHE_NAME = `codex-remote-shell-v5-${new URL(self.location.href || `${self.location.origin}/sw.js`).searchParams.get('v') || 'dev'}`
const CORE_ASSETS = [
  '/manifest.webmanifest',
  '/codex-remote.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
  '/recovery.css',
]

async function cacheApplicationShell() {
  const cache = await caches.open(CACHE_NAME)
  const response = await fetch('/', { cache: 'reload' })
  if (!response.ok) throw new Error('Unable to cache application shell')

  const html = await response.clone().text()
  const bundlePaths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)]
    .map((match) => match[1])

  await cache.addAll([...CORE_ASSETS, ...new Set(bundlePaths)])
  // Commit the HTML last: failed asset downloads must not replace a usable shell.
  await cache.put('/', response)
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheApplicationShell())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith('codex-remote-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key)),
    )).then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
  if (event.data?.type === 'PUSH_CAPABILITY') event.ports[0]?.postMessage({ push: true })
})

self.addEventListener('push', (event) => {
  let tag = 'complete'
  let title = 'Cuộc hội thoại'
  let body = 'Lượt trả lời đã kết thúc.'
  let threadId = null
  try {
    const data = event.data?.json()
    if (typeof data?.tag === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(data.tag)) tag = data.tag
    const context = data?.notification
    threadId = validThreadId(context?.threadId)
    if (threadId) {
      title = notificationLabel(context.threadName, 80) || 'Cuộc hội thoại'
      body = notificationAnswer(data.body) || (context.outcome === 'failed' ? 'Lượt chat bị lỗi.'
        : context.outcome === 'interrupted' ? 'Lượt chat đã dừng.' : 'Lượt trả lời đã kết thúc.')
    }
  } catch { /* Still display a generic alert for malformed payloads. */ }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (windows.some(client => sameOrigin(client.url) && (client.visibilityState === 'visible' || client.focused === true))) return
    await self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: `codex-turn-${tag}`,
      data: { threadId },
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const threadId = validThreadId(event.notification.data?.threadId)
  const target = threadId ? `/#thread=${encodeURIComponent(threadId)}` : '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      // Never reload an existing draft, Files page or Hours editor. A current
      // app acknowledges in-place routing even while its owner gate is locked.
      for (const existing of clients.filter(client => client.frameType !== 'nested' && sameOrigin(client.url) && new URL(client.url).pathname === '/')) {
        if (!threadId || await requestConversation(existing, threadId)) {
          try { return await existing.focus() } catch { /* Try opening the app. */ }
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})

function validThreadId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null
}
function notificationLabel(value, limit) {
  return typeof value === 'string' ? [...value.replace(/[\p{Cc}\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, ' ').replace(/\s+/g, ' ').trim()].slice(0, limit).join('') : ''
}
function notificationAnswer(value) {
  if (typeof value !== 'string') return ''
  const text = value.slice(0, 64000).replace(/[\p{Cc}\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, ' ').replace(/\s+/g, ' ').trim()
  const chars = [...text]
  return chars.slice(0, 2201).join('') + (chars.length > 2201 || value.length > 64000 ? '…' : '')
}
function sameOrigin(value) {
  try { return new URL(value).origin === self.location.origin } catch { return false }
}
function requestConversation(client, threadId) {
  return new Promise(resolve => {
    const channel = new MessageChannel()
    const finish = accepted => { clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(accepted) }
    const timer = setTimeout(() => finish(false), 1000)
    channel.port1.onmessage = event => finish(event.data?.accepted === true)
    try { client.postMessage({ type: 'CODEX_OPEN_THREAD', threadId }, [channel.port2]) }
    catch { finish(false) }
  })
}

async function networkFirst(request, fallbackPath) {
  const cache = await caches.open(CACHE_NAME)
  try {
    const response = await fetch(request, { signal: AbortSignal.timeout(8_000) })
    if (!response.ok) throw new Error('Gateway unavailable')
    if (response.type === 'basic') {
      const html = await response.clone().text()
      const paths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(match => match[1])
      await Promise.all([...new Set(paths)].map(async path => {
        if (await cache.match(path)) return
        const asset = await fetch(path, { signal: AbortSignal.timeout(8_000) })
        if (!asset.ok) throw new Error('Application bundle unavailable')
        await cache.put(path, asset)
      }))
      await cache.put(request, response.clone())
    }
    return response
  } catch {
    return (await cache.match(request)) ?? (await cache.match(fallbackPath)) ?? Response.error()
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(CACHE_NAME)
    await cache.put(request, response.clone())
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/preview/') || url.pathname === '/workboard' || url.pathname.startsWith('/workboard/')) return

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request, '/'))
    return
  }

  event.respondWith(cacheFirst(event.request))
})
