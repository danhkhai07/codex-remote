import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

function harness() {
  const old = new Response('<html>Working cached shell</html>')
  const cache = { match: vi.fn(async (key: string) => key === '/' ? old.clone() : undefined), put: vi.fn(), addAll: vi.fn() }
  const fetch = vi.fn()
  const context = {
    self: { addEventListener: vi.fn(), location: { href: 'https://remote.test/sw.js?v=build-2', origin: 'https://remote.test' } },
    caches: { open: vi.fn(async () => cache) }, URL, Response, AbortSignal, fetch,
    api: {} as { cacheApplicationShell: () => Promise<void>; networkFirst: (request: string, fallback: string) => Promise<Response> },
  }
  runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8') + '\napi.cacheApplicationShell = cacheApplicationShell; api.networkFirst = networkFirst;', context)
  return { cache, fetch, api: context.api, listeners: context.self.addEventListener }
}

function shell() {
  const response = new Response('<html><script src="/assets/new.js"></script></html>')
  Object.defineProperty(response, 'type', { value: 'basic' })
  return response
}

describe('recoverable application shell', () => {
  it('does not publish new HTML if installation fails to fetch bundles', async () => {
    const { cache, fetch, api } = harness()
    fetch.mockResolvedValue(shell())
    cache.addAll.mockRejectedValue(new Error('Asset unavailable'))
    await expect(api.cacheApplicationShell()).rejects.toThrow('Asset unavailable')
    expect(cache.put).not.toHaveBeenCalled()
  })
  it('uses the cached app on gateway 503 rather than replacing it with an error page', async () => {
    const { fetch, api } = harness()
    fetch.mockResolvedValue(new Response('Gateway unavailable', { status: 503 }))
    expect(await (await api.networkFirst('https://remote.test/', '/')).text()).toContain('Working cached shell')
  })
  it('keeps the previous shell when a newer entry bundle is missing', async () => {
    const { cache, fetch, api } = harness()
    fetch.mockResolvedValueOnce(shell()).mockResolvedValueOnce(new Response('Missing', { status: 404 }))
    expect(await (await api.networkFirst('https://remote.test/', '/')).text()).toContain('Working cached shell')
    expect(cache.put).not.toHaveBeenCalled()
  })
})

it('leaves authenticated preview requests out of the app shell and offline cache', () => {
  const { listeners, fetch } = harness()
  const onFetch = listeners.mock.calls.find(([name]) => name === 'fetch')![1]
  for (const path of ['/preview/3000/', '/preview/3000/assets/app.js', '/preview/5174/api/data', '/workboard', '/workboard/', '/workboard/app.js']) {
    const respondWith = vi.fn()
    onFetch({ request: { method: 'GET', url: 'https://remote.test' + path, mode: 'navigate' }, respondWith })
    expect(respondWith).not.toHaveBeenCalled()
  }
  expect(fetch).not.toHaveBeenCalled()
})
