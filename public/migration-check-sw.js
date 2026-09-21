// Narrow migration inspector. No fetch handler/cache writes and no clients.claim().
// It reports known legacy URLs in this storage partition, not browser integrity.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()))
self.addEventListener('message', event => {
  if (event.data?.type !== 'CHECK_LEGACY_CLIENTS_V1' || !event.ports[0]) return
  event.waitUntil((async () => {
    try {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const count = clients.filter(client => {
        const url = new URL(client.url)
        return url.origin === self.location.origin && (url.pathname === '/preview' || url.pathname.startsWith('/preview/') || url.pathname === '/workboard' || url.pathname.startsWith('/workboard/'))
      }).length
      event.ports[0].postMessage({ type: 'LEGACY_CLIENTS_V1', count })
    } catch { event.ports[0].postMessage({ type: 'LEGACY_CLIENTS_ERROR' }) }
  })())
})
