import { expect, it, vi } from 'vitest'
import { boundedBlob } from './boundedBlob'
it('cancels before collecting a file that grew beyond the earlier preview/share size', async () => {
  const cancelled = vi.fn(), body = new ReadableStream({ cancel: cancelled })
  await expect(boundedBlob(new Response(body, { headers: { 'content-length': '10000' } }), 1024)).rejects.toThrow('giới hạn')
  expect(cancelled).toHaveBeenCalledOnce()
})
it('enforces the cap on chunks even without a length, and cancels the transport', async () => {
  const cancelled = vi.fn(), body = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(512)) }, cancel: cancelled })
  await expect(boundedBlob(new Response(body), 1024)).rejects.toThrow('giới hạn')
  expect(cancelled).toHaveBeenCalledOnce()
})
it('never returns a complete preview after a truncated encrypted body', async () => {
  let sent = false
  const body = new ReadableStream({ pull(c) { if (sent) c.error(Error('Truncated secure response')); else { sent = true; c.enqueue(new Uint8Array(512)) } } })
  await expect(boundedBlob(new Response(body), 1024)).rejects.toThrow('Truncated secure response')
})
