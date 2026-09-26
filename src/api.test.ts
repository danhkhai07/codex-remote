import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { lockSecure } from './secureApi'
// These tests exercise JSON/status handling above the authenticated transport.
vi.mock('./secureApi', async importOriginal => ({ ...await importOriginal<typeof import('./secureApi')>(), secureFetch: (...args: Parameters<typeof fetch>) => fetch(...args) }))

afterEach(() => vi.unstubAllGlobals())

describe('conversation response failures', () => {
  it('preserves an abort while reading the response body', async () => {
    const error = new DOMException('The operation was aborted', 'AbortError')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.reject(error) }))
    await expect(api.thread('pos')).rejects.toBe(error)
  })

  it('reports truncated JSON instead of returning an empty success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"thread":')))
    await expect(api.thread('pos')).rejects.toThrow('incomplete or invalid data')
  })

  it.each([{}, null, { thread: { id: 'other' } }])('rejects unusable thread responses: %j', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)))
    await expect(api.thread('pos')).rejects.toThrow('incomplete or mismatched')
  })

  it('keeps the HTTP status when an error response is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unavailable', { status: 503 })))
    await expect(api.thread('pos')).rejects.toMatchObject({ status: 503, message: 'Request failed (503)' })
  })

  it('loads valid history after a failed attempt', async () => {
    const thread = { id: 'pos', cwd: '/tmp', turns: [{ id: 'turn', status: 'completed', items: [] }] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{')).mockResolvedValueOnce(Response.json({ thread })))
    await expect(api.thread('pos')).rejects.toThrow('incomplete or invalid data')
    await expect(api.thread('pos')).resolves.toEqual({ thread })
  })
})

describe('preview share owner API', () => {
  it('loads through GET and sends exact CSRF mutation contracts', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ links: [], services: [], serverNow: '2026-09-27T00:00:00.000Z' }))
      .mockResolvedValueOnce(Response.json({ link: { id: 'share' } }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await api.previewShares()
    await api.createPreviewShare({ port: 4173, path: '/demo', label: 'Khách', ttlSeconds: 3600 }, 'csrf-token')
    await api.revokePreviewShare('share / id', 'csrf-token')

    expect(fetchMock.mock.calls[0][0]).toBe('/api/preview-shares')
    expect(new Headers(fetchMock.mock.calls[0][1].headers).has('X-CSRF-Token')).toBe(false)
    const create = fetchMock.mock.calls[1]
    expect(create[0]).toBe('/api/preview-shares')
    expect(create[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ port: 4173, path: '/demo', label: 'Khách', ttlSeconds: 3600 }) })
    expect(new Headers(create[1].headers).get('X-CSRF-Token')).toBe('csrf-token')
    const revoke = fetchMock.mock.calls[2]
    expect(revoke[0]).toBe('/api/preview-shares/share%20%2F%20id')
    expect(revoke[1].method).toBe('DELETE')
    expect(new Headers(revoke[1].headers).get('X-CSRF-Token')).toBe('csrf-token')
  })
})

it('does not publish a parsed cached response after its intent was locked', async () => {
  let release!: (value: unknown) => void, entered!: () => void
  const waiting = new Promise<void>(resolve => { entered = resolve })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => { entered(); return new Promise(resolve => { release = resolve }) } }))
  const result = api.thread('pos'); await waiting
  lockSecure(false, false)
  release({ thread: { id: 'pos', cwd: '/tmp', turns: [] } })
  await expect(result).rejects.toThrow(/cancel/i)
})
