/** Shared Node/browser wire codec. Cryptographic primitives belong to jose/WebCrypto. */
import { CompactEncrypt, compactDecrypt, decodeProtectedHeader, base64url } from 'jose'
export type SecureKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>
export const SECURE_VERSION = 1
export const FRAME_BYTES = 64 * 1024
export const MAX_WIRE_LINE = 100_000
export const MAX_REQUEST_BYTES = 25 * 1024 * 1024
export const MAX_REQUEST_BODY_FRAMES = 1024
export const MAX_REQUEST_WIRE_BYTES = 36 * 1024 * 1024
export const CACHE_ENTRY_BYTES = 8 * 1024 * 1024
export const utf8 = new TextEncoder()
export const text = new TextDecoder('utf-8', { fatal: true })
export const encode64 = (value: Uint8Array) => base64url.encode(value)
export const decode64 = (value: string) => new Uint8Array(base64url.decode(value))
export const randomId = (bytes = 24) => encode64(crypto.getRandomValues(new Uint8Array(bytes)))
export const jsonBytes = (value: unknown) => utf8.encode(JSON.stringify(value))
export type Challenge = { v: 1; id: string; channel: string; salt: string; app: string; generation: string; binding: string; expiresAt: number }
export type FrameContext = { channel: string; direction: string; request: string; sequence: number; kind: string }
export type SecureMetadata = { required: boolean; version: number; app?: string; generation?: string }
export async function importOwner(value: string): Promise<SecureKey> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw Error('Use the separate 256-bit unlock key')
  const bytes = decode64(value)
  if (bytes.length !== 32 || encode64(bytes) !== value) throw Error('Invalid unlock key')
  return crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey'])
}
export function deriveKey(owner: SecureKey, salt: string, domain: string): Promise<SecureKey> {
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: decode64(salt), info: utf8.encode('codex-remote/secure/v1/' + domain) }, owner, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
export function channelKey(owner: SecureKey, challenge: Challenge, direction: 'proof' | 'request' | 'response') {
  return deriveKey(owner, challenge.salt, JSON.stringify([direction, challenge.app, challenge.generation, challenge.binding, challenge.id, challenge.channel]))
}
export async function seal(key: SecureKey, context: FrameContext, payload: Uint8Array): Promise<string> {
  return new CompactEncrypt(payload).setProtectedHeader({ alg: 'dir', enc: 'A256GCM', typ: 'codex-remote+secure', v: 1, c: context.channel, d: context.direction, r: context.request, s: context.sequence, k: context.kind }).encrypt(key)
}
export async function unseal(key: SecureKey, context: FrameContext, packet: string): Promise<Uint8Array> {
  if (packet.length > MAX_WIRE_LINE) throw Error('Oversized secure frame')
  // Reject compression/extra headers before decrypting or decompressing anything.
  const h = decodeProtectedHeader(packet)
  if (Object.keys(h).sort().join(',') !== 'alg,c,d,enc,k,r,s,typ,v' || h.typ !== 'codex-remote+secure' || h.v !== 1 || h.c !== context.channel || h.d !== context.direction || h.r !== context.request || h.s !== context.sequence || h.k !== context.kind) throw Error('Secure frame context mismatch')
  const { plaintext } = await compactDecrypt(packet, key, { keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'], maxDecompressedLength: 0 })
  return plaintext
}
export async function* wireLines(source: AsyncIterable<Uint8Array>, limits?: { bytes: number; lines: number }): AsyncGenerator<string> {
  let pending = '', bytes = 0, lines = 0
  for await (const chunk of source) {
    bytes += chunk.length
    if (limits && bytes > limits.bytes) throw Error('Secure wire limit exceeded')
    // Wire is ASCII JWE, never accept replacement characters or an unbounded line.
    const value = text.decode(chunk)
    if (/[^\x20-\x7e\n]/.test(value)) throw Error('Invalid secure framing')
    pending += value
    let at: number
    while ((at = pending.indexOf('\n')) >= 0) {
      if (at === 0 || at > MAX_WIRE_LINE) throw Error('Invalid secure framing')
      if (limits && ++lines > limits.lines) throw Error('Secure frame limit exceeded')
      yield pending.slice(0, at); pending = pending.slice(at + 1)
    }
    if (pending.length > MAX_WIRE_LINE) throw Error('Oversized secure frame')
  }
  if (pending) throw Error('Truncated secure framing')
}
export async function* webBytes(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader()
  try { while (true) { const next = await reader.read(); if (next.done) return; yield next.value } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
/** Coalesce small source chunks so the wire frame limit is independent of I/O chunking. */
export async function* frameBytes(source: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  let buffer = new Uint8Array(FRAME_BYTES), size = 0
  for await (const chunk of source) {
    let offset = 0
    while (offset < chunk.length) {
      const length = Math.min(FRAME_BYTES - size, chunk.length - offset)
      buffer.set(chunk.subarray(offset, offset + length), size); size += length; offset += length
      if (size === FRAME_BYTES) { yield buffer; buffer = new Uint8Array(FRAME_BYTES); size = 0 }
    }
  }
  if (size) yield buffer.subarray(0, size)
}
export const context = (channel: string, direction: string, request: string, sequence: number, kind: string): FrameContext => ({ channel, direction, request, sequence, kind })
