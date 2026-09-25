import { expect, it } from 'vitest'
import { HistoryJson } from './history-json.js'
const project = (text: string) => { const parser = new HistoryJson(); for (const byte of Buffer.from(text)) parser.feed(byte); return parser.finish() }
it('preserves valid small native structure, Unicode, escapes, null, numbers and prototypes safely', () => {
  const text = JSON.stringify({ type: 'event_msg', payload: { item: { id: 'a', type: 'AgentMessage', text: 'Việt 😀 ☃ \"' }, turn_id: 't' }, ['__proto__']: { polluted: true }, x: [null, true, false, -125] })
  expect(project(text).value).toEqual(JSON.parse(text))
  expect({}).not.toHaveProperty('polluted')
})
it('bounds huge strings/arrays while preserving identities after clipped content', () => {
  const parser = new HistoryJson()
  for (const byte of Buffer.from('{"payload":{"item":{"text":"')) parser.feed(byte)
  const block = Buffer.from('Việt 😀 '.repeat(1000))
  for (let n = 0; n < 500; n++) for (const byte of block) parser.feed(byte)
  for (const byte of Buffer.from('","type":"AgentMessage","id":"exact-id"},"turn_id":"exact-turn"},"type":"event_msg"}')) parser.feed(byte)
  const result = parser.finish()
  expect(result.truncated).toBe(true)
  expect(result.value).toMatchObject({ type: 'event_msg', payload: { turn_id: 'exact-turn', item: { id: 'exact-id', type: 'AgentMessage' } } })
  expect(JSON.stringify(result.value).length).toBeLessThan(20_000)
  const array = project(JSON.stringify({ content: Array.from({ length: 10000 }, (_, n) => ({ type: 'text', text: 'x'.repeat(100), id: String(n) })), id: 'after' }))
  expect((array.value as { content: unknown[] }).content.length).toBeLessThanOrEqual(64)
  expect(array.value).toHaveProperty('id', 'after')
})
it('rejects malformed input even after retention cap, depth and oversized keys', () => {
  for (const value of ['{"a":1,}', '[1,]', '{"a":"bad\\x"}', '{"a":"\\uZZZZ"}', 'true false', '[NaN]', '1e999', '{"x":', '['.repeat(65) + ']'.repeat(65), JSON.stringify({ ['k'.repeat(257)]: 1 }), '{"x":"' + 'x'.repeat(20000) + '\\q"}']) expect(() => project(value)).toThrow()
})
it('bounded block path matches byte-wise projection and validates clipped tails', () => {
  const text = JSON.stringify({ text: 'Việt 😀 '.repeat(20000) + '\\"end', id: 'after', content: [{ type: 'text', text: 'retained' }] })
  const bytes = Buffer.from(text), parser = new HistoryJson()
  for (let n = 0; n < bytes.length; n += 65536) parser.feedBuffer(bytes.subarray(n, n + 65536))
  expect(parser.finish()).toEqual(project(text))
  for (const tail of ['\\q"}', '\u0001"}', '\\uZZZZ"}']) {
    const bad = new HistoryJson()
    expect(() => { bad.feedBuffer(Buffer.from('{"text":"' + 'x'.repeat(65536) + tail)); bad.finish() }).toThrow()
  }
})
