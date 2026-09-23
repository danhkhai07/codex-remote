import { expect, it, vi } from 'vitest'
import { SecureTransport } from './secure-client.js'
import { importOwner, randomId } from './secure-wire.js'

it.each(['app', 'generation', 'binding'] as const)('rejects another %s before transmitting a remembered owner proof', async field => {
  const identity = { app: randomId(), generation: randomId(), binding: randomId(32) }
  const challenge = { ...identity, [field]: randomId(32), v: 1, id: randomId(), channel: randomId(), salt: randomId(32), expiresAt: Date.now() + 30000 }
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(challenge))
  const client = new SecureTransport(fetcher)
  await expect(client.unlock(await importOwner(randomId(32)), identity)).rejects.toThrow('another session or key')
  expect(fetcher).toHaveBeenCalledOnce()
  expect(fetcher.mock.calls[0][0]).toBe('/api/secure/challenge')
  expect(client.unlocked).toBe(false)
})
it('rejects an unrelated persisted capability without any network request', async () => {
  const fetcher = vi.fn<typeof fetch>(), client = new SecureTransport(fetcher)
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  await expect(client.unlock(key)).rejects.toThrow('Invalid owner capability')
  expect(fetcher).not.toHaveBeenCalled()
})
