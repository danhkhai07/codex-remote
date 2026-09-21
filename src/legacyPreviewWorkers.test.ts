import { expect, it, vi } from 'vitest'
import { unregisterLegacyPreviewWorkers } from './legacyPreviewWorkers'
it('removes only legacy preview registrations without clearing the app worker or drafts', async () => {
  const scopes = ['https://admin.test/', 'https://admin.test/preview/3000/', 'https://admin.test/workboard/', 'https://other.test/preview/3000/']
  const registrations = scopes.map(scope => ({ scope, unregister: vi.fn().mockResolvedValue(true) }))
  await unregisterLegacyPreviewWorkers({ getRegistrations: async () => registrations as unknown as readonly ServiceWorkerRegistration[] }, 'https://admin.test')
  expect(registrations.map(r => r.unregister.mock.calls.length)).toEqual([0, 1, 1, 0])
})
