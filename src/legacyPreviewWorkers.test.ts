import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'
import { closeLegacyPreviewFrames, createPreviewMigrationBarrier, removeLegacyPreviewCacheEntries, unregisterLegacyPreviewWorkers } from './legacyPreviewWorkers'

it('verifies registration removal, keeping the app worker and other origins', async () => {
  const scopes = ['https://admin.test/', 'https://admin.test/preview/3000/', 'https://admin.test/workboard/', 'https://other.test/preview/3000/']
  const removed = new Set<string>()
  const registrations = scopes.map(scope => ({ scope, unregister: vi.fn(async () => { removed.add(scope); return true }) }))
  await unregisterLegacyPreviewWorkers({ getRegistrations: async () => registrations.filter(r => !removed.has(r.scope)) as unknown as readonly ServiceWorkerRegistration[] }, 'https://admin.test')
  expect(registrations.map(r => r.unregister.mock.calls.length)).toEqual([0, 1, 1, 0])
})

it('rejects failed unregister and scopes that reappear instead of silently signing in', async () => {
  const registration = { scope: 'https://admin.test/workboard/', unregister: vi.fn().mockResolvedValue(false) }
  await expect(unregisterLegacyPreviewWorkers({ getRegistrations: async () => [registration] as unknown as readonly ServiceWorkerRegistration[] }, 'https://admin.test')).rejects.toThrow('Không gỡ được')
  await expect(unregisterLegacyPreviewWorkers({ getRegistrations: async () => { throw Error('denied') } }, 'https://admin.test')).rejects.toThrow('denied')
})

it('closes legacy frames owned by the document and preserves isolated previews', () => {
  const frames = ['/preview/5180/', '/workboard/', 'https://p5180.test/workboard/', '/working-hours'].map(path => ({ src: new URL(path, 'https://admin.test').href, remove: vi.fn() }))
  closeLegacyPreviewFrames({ querySelectorAll: () => frames } as unknown as Document, 'https://admin.test')
  expect(frames.map(f => f.remove.mock.calls.length)).toEqual([1, 1, 0, 0])
})

it('deletes only cached legacy requests, including entries in the root app cache', async () => {
  const paths = ['/preview/5180/', '/workboard/app.js', '/', '/assets/app.js', 'https://p5180.test/workboard/']
  const entries = new Set(paths.map(path => new URL(path, 'https://admin.test').href))
  const cache = { keys: async () => [...entries].map(path => new Request(path)), delete: vi.fn(async (request: Request) => entries.delete(request.url)) }
  await removeLegacyPreviewCacheEntries({ keys: async () => ['app'], open: async () => cache } as unknown as CacheStorage, 'https://admin.test')
  expect(cache.delete.mock.calls.map(([request]) => new URL(request.url).pathname)).toEqual(['/preview/5180/', '/workboard/app.js'])
  expect(entries.size).toBe(3)
})

it('shares pending cleanup across callers and never marks a failure ready; retry and recheck run cleanup', async () => {
  let release!: () => void
  const cleanup = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
    .mockRejectedValueOnce(Error('old tab')).mockResolvedValue(undefined)
  const ready = createPreviewMigrationBarrier(cleanup)
  let credentialsSent = false
  const first = ready().then(() => { credentialsSent = true })
  const second = ready()
  await Promise.resolve()
  expect(cleanup).toHaveBeenCalledTimes(1)
  expect(credentialsSent).toBe(false)
  release(); await Promise.all([first, second]); expect(credentialsSent).toBe(true)
  await ready(); expect(cleanup).toHaveBeenCalledTimes(1)
  await expect(ready(true)).rejects.toThrow('old tab')
  await ready(); expect(cleanup).toHaveBeenCalledTimes(3)
})

it('inspector includes uncontrolled clients, reports only known paths and never claims them', async () => {
  const listeners = new Map<string, (event: unknown) => void>()
  const matchAll = vi.fn().mockResolvedValue(['/preview/1234/', '/workboard/', '/', '/knowledge', 'https://p1234.test/preview/1234/'].map(path => ({ url: new URL(path, 'https://admin.test').href })))
  const context = { self: { addEventListener: (type: string, callback: (event: unknown) => void) => listeners.set(type, callback), clients: { matchAll }, location: { origin: 'https://admin.test' } }, URL }
  runInNewContext(readFileSync(new URL('../public/migration-check-sw.js', import.meta.url), 'utf8'), context)
  const port = { postMessage: vi.fn() }; let finished!: Promise<void>
  listeners.get('message')!({ data: { type: 'CHECK_LEGACY_CLIENTS_V1' }, ports: [port], waitUntil: (promise: Promise<void>) => { finished = promise } })
  await finished
  expect(matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true })
  expect(port.postMessage).toHaveBeenCalledWith({ type: 'LEGACY_CLIENTS_V1', count: 2 })
  expect(listeners.has('fetch')).toBe(false)
})

it('does not pass when a cache entry remains after delete resolves', async () => {
  const cache = { keys: async () => [new Request('https://admin.test/workboard/')], delete: async () => false }
  await expect(removeLegacyPreviewCacheEntries({ keys: async () => ['app'], open: async () => cache } as unknown as CacheStorage, 'https://admin.test')).rejects.toThrow('Không xóa được')
})
