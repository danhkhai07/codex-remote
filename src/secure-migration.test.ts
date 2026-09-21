import { afterEach, expect, it, vi } from 'vitest'
const { ready } = vi.hoisted(() => ({ ready: vi.fn() }))
vi.mock('./legacyPreviewWorkers', () => ({ ensurePreviewMigrationReady: ready }))
import { lockSecure, secureSetup, secureLogin, unlockSecure, secureTransport } from './secureApi'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); ready.mockReset(); secureTransport.lock() })
it('blocks setup, login and key derivation until a fresh migration check succeeds', async () => {
  let release!: () => void
  ready.mockImplementation(() => new Promise<void>(resolve => { release = resolve }))
  const setup = vi.spyOn(secureTransport, 'setup').mockResolvedValue({ required: true, version: 1, app: 'fake', generation: 'fake' })
  const unlock = vi.spyOn(secureTransport, 'unlock').mockRejectedValue(Error('fixture stops before cache'))
  const fetch = vi.fn().mockResolvedValue(Response.json({})); vi.stubGlobal('fetch', fetch)
  const first = secureSetup(); expect(setup).not.toHaveBeenCalled(); expect(ready).toHaveBeenLastCalledWith(true)
  release(); await first; setup.mockClear()
  const login = secureLogin('fake password'); expect(fetch).not.toHaveBeenCalled(); expect(ready).toHaveBeenLastCalledWith(true)
  release(); await login
  const key = unlockSecure('fake key'); expect(unlock).not.toHaveBeenCalled(); expect(setup).not.toHaveBeenCalled(); expect(ready).toHaveBeenLastCalledWith(true)
  release(); await expect(key).rejects.toThrow('fixture stops before cache'); expect(unlock).toHaveBeenCalledOnce()
})
it('fails closed on migration errors without network or derivation', async () => {
  ready.mockRejectedValue(Error('Close old tabs'))
  const setup = vi.spyOn(secureTransport, 'setup'), unlock = vi.spyOn(secureTransport, 'unlock')
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  await expect(secureSetup()).rejects.toThrow('Close old tabs')
  await expect(secureLogin('fake')).rejects.toThrow('Close old tabs')
  await expect(unlockSecure('fake')).rejects.toThrow('Close old tabs')
  expect(setup).not.toHaveBeenCalled(); expect(unlock).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
})

it('does not restore a session after Lock during its migration check', async () => {
  const { api } = await import('./api')
  let release!: () => void
  ready.mockImplementation(() => new Promise<void>(resolve => { release = resolve }))
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  const pending = api.session(); lockSecure(false, false); release()
  await expect(pending).rejects.toThrow(/cancel/i)
  expect(fetch).not.toHaveBeenCalled()
})
