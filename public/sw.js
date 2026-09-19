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
  let body = 'Your Codex turn is complete.'
  try {
    const data = event.data?.json()
    if (typeof data?.tag === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(data.tag)) tag = data.tag
    if (typeof data?.body === 'string' && data.body.trim()) body = data.body.trim().slice(0, 180)
  } catch { /* Still display a generic alert for malformed payloads. */ }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (windows.some(client => client.visibilityState === 'visible' || client.focused === true)) return
    await self.registration.showNotification('Codex finished', {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: `codex-turn-${tag}`,
      data: { url: '/' },
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => new URL(client.url).origin === self.location.origin)
      if (existing) {
        return existing.focus()
      }
      return self.clients.openWindow(target)
    }),
  )
})

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
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/preview/')) return

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request, '/'))
    return
  }

  event.respondWith(cacheFirst(event.request))
})
