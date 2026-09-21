import { expect, it } from 'vitest'
import { context, deriveKey, encode64, frameBytes, FRAME_BYTES, importOwner, jsonBytes, randomId, seal, unseal, utf8, wireLines } from './secure-wire'
async function* source(...values: string[]) { for (const value of values) yield utf8.encode(value) }
async function collect<T>(source: AsyncIterable<T>) { const result: T[] = []; for await (const value of source) result.push(value); return result }
it('bounds total ASCII wire bytes and frame count independently of plaintext size', async () => {
  await expect(collect(wireLines(source('1234\n', '1234\n'), { bytes: 9, lines: 3 }))).rejects.toThrow('wire limit')
  await expect(collect(wireLines(source('a\nb\nc\n'), { bytes: 100, lines: 2 }))).rejects.toThrow('frame limit')
  expect(await collect(wireLines(source('a\nb\n'), { bytes: 4, lines: 2 }))).toEqual(['a', 'b'])
})
it('rejects zip or unexpected protected headers before attempting any decryption', async () => {
  const key = await deriveKey(await importOwner(randomId(32)), randomId(32), 'test'), ctx = context('channel', 'request', 'request', 0, 'head')
  const packet = await seal(key, ctx, utf8.encode('normal'))
  expect(await unseal(key, ctx, packet)).toEqual(utf8.encode('normal'))
  for (const extra of [{ zip: 'DEF' }, { unrecognized: true }]) {
    const fields = packet.split('.')
    fields[0] = encode64(jsonBytes({ alg: 'dir', enc: 'A256GCM', typ: 'codex-remote+secure', v: 1, c: 'channel', d: 'request', r: 'request', s: 0, k: 'head', ...extra }))
    await expect(unseal(key, ctx, fields.join('.'))).rejects.toThrow('context mismatch')
  }
})
it('coalesces producer chunks without losing bytes or emitting empty records', async () => {
  async function* input() { yield new Uint8Array(0); for (let i = 0; i < FRAME_BYTES + 3; i++) yield new Uint8Array([i % 256]) }
  const frames = await collect(frameBytes(input()))
  expect(frames.map(f => f.length)).toEqual([FRAME_BYTES, 3])
  expect(frames[1]).toEqual(new Uint8Array([0, 1, 2]))
})
