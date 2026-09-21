import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
// These tests exercise JSON/status handling above the authenticated transport.
vi.mock('./secureApi', () => ({ secureFetch: (...args: Parameters<typeof fetch>) => fetch(...args) }))

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
