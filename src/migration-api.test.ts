import { afterEach, expect, it, vi } from 'vitest'
const { ready } = vi.hoisted(() => ({ ready: vi.fn() }))
vi.mock('./legacyPreviewWorkers', () => ({ ensurePreviewMigrationReady: ready }))
vi.mock('./secureApi', () => ({ secureFetch: (...args: Parameters<typeof fetch>) => fetch(...args) }))
import { api } from './api'
afterEach(() => { vi.unstubAllGlobals(); ready.mockReset() })

it('never restores or sends a login password until migration readiness resolves', async () => {
  let release!: () => void
  ready.mockImplementation(() => new Promise<void>(resolve => { release = resolve }))
  const fetch = vi.fn().mockImplementation(async () => Response.json({ csrf: 'fake' }))
  vi.stubGlobal('fetch', fetch)
  const restore = api.session(); await Promise.resolve(); expect(fetch).not.toHaveBeenCalled()
  release(); await restore; expect(fetch).toHaveBeenCalledTimes(1)
  fetch.mockClear()
  const login = api.login('fake password'); await Promise.resolve(); expect(fetch).not.toHaveBeenCalled()
  expect(ready).toHaveBeenLastCalledWith(true)
  release(); await login; expect(fetch).toHaveBeenCalledTimes(1)
})

it('a cleanup failure rejects login and restoration without any network request', async () => {
  ready.mockRejectedValue(Error('Close old preview tabs'))
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  await expect(api.session()).rejects.toThrow('Close old preview tabs')
  await expect(api.login('fake password')).rejects.toThrow('Close old preview tabs')
  expect(fetch).not.toHaveBeenCalled()
})
