import type { SecureKey } from './secure-wire.js'
import { Writable } from 'node:stream'
import { createHash } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import { CACHE_ENTRY_BYTES, FRAME_BYTES, context, jsonBytes, seal } from './secure-wire.js'
export type ResponseMeta = { status: number; headers: Record<string, string>; resource: string; revision?: string; unchanged?: boolean }
/** Writable adapter preserves Node backpressure and existing dispatcher lifecycle. */
export class SecureResponse extends Writable {
  statusCode = 200
  headersSent = false
  #headers = new Map<string, string | number | readonly string[]>()
  #sequence = 0
  #bytes = 0
  #chunks = 0
  #buffer: Buffer[] = []
  #bufferSize = 0
  #started = false
  #cache: boolean
  constructor(readonly outer: ServerResponse, readonly key: SecureKey, readonly channel: string, readonly requestId: string, readonly resource: string, readonly valid: () => boolean, cache: boolean, readonly revision: string | undefined, readonly budget: (delta: number) => boolean, readonly representation = '') {
    super({ highWaterMark: FRAME_BYTES })
    this.#cache = cache
    outer.once('close', () => this.destroy())
    this.on('error', () => outer.destroy())
  }
  setHeader(name: string, value: string | number | readonly string[]) {
    if (this.headersSent) throw Error('Headers already sent')
    if (name.toLowerCase() === 'set-cookie') this.outer.setHeader(name, value)
    else this.#headers.set(name.toLowerCase(), value)
    return this
  }
  getHeader(name: string) { return this.#headers.get(name.toLowerCase()) }
  removeHeader(name: string) { this.#headers.delete(name.toLowerCase()) }
  writeHead(status: number, headers?: Record<string, string | number | readonly string[]>) {
    this.statusCode = status
    for (const [name, value] of Object.entries(headers ?? {})) this.setHeader(name, value)
    return this
  }
  flushHeaders() { this.#cache = false; void this.#head().catch(() => this.destroy()) }
  #meta(): ResponseMeta {
    return { status: this.statusCode, headers: Object.fromEntries([...this.#headers].filter(([name]) => ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition', 'content-security-policy'].includes(name)).map(([name, value]) => [name, String(value)])), resource: this.resource }
  }
  async #send(kind: string, value: Uint8Array) {
    if (this.destroyed || !this.valid()) throw Error('Secure response closed')
    const packet = await seal(this.key, context(this.channel, 'response', this.requestId, this.#sequence++, kind), value)
    if (this.destroyed || !this.valid()) throw Error('Secure response closed')
    if (!this.outer.headersSent) this.outer.writeHead(200, { 'Content-Type': 'application/x-codex-secure', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no' })
    if (!this.outer.write(packet + '\n')) await new Promise<void>((resolve, reject) => {
      const clean = () => { clearTimeout(timer); this.outer.off('drain', drain); this.outer.off('close', close) }
      const drain = () => { clean(); resolve() }, close = () => { clean(); reject(Error('Closed')) }
      const timer = setTimeout(() => { clean(); reject(Error('Slow consumer')) }, 30_000); timer.unref()
      this.outer.once('drain', drain); this.outer.once('close', close)
    })
  }
  #headPromise?: Promise<void>
  #head(meta = this.#meta()) {
    if (!this.#headPromise) { this.headersSent = true; this.#started = true; this.#headPromise = this.#send('head', jsonBytes(meta)) }
    return this.#headPromise
  }
  async #body(chunk: Buffer) {
    await this.#head()
    for (let offset = 0; offset < chunk.length; offset += FRAME_BYTES) {
      const part = chunk.subarray(offset, offset + FRAME_BYTES)
      await this.#send('body', part); this.#bytes += part.length; this.#chunks++
    }
  }
  async #release() {
    const parts = this.#buffer, reserved = this.#bufferSize
    this.#buffer = []; this.#bufferSize = 0
    // Keep budget reserved while backpressure still retains these plaintext
    // chunks; merely moving them to a local array does not free memory.
    try { for (const part of parts) await this.#body(part) }
    finally { this.budget(-reserved) }
  }
  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    void (async () => {
      if (this.#cache && this.statusCode === 200 && this.#bufferSize + chunk.length <= CACHE_ENTRY_BYTES && this.budget(chunk.length)) {
        this.#buffer.push(Buffer.from(chunk)); this.#bufferSize += chunk.length; return
      }
      this.#cache = false
      await this.#release(); await this.#body(chunk)
    })().then(() => callback(), () => callback(Error('Secure response failed')))
  }
  _final(callback: (error?: Error | null) => void) {
    void (async () => {
      if (this.#cache && this.statusCode === 200 && !this.#started) {
        const meta = this.#meta()
        const hash = createHash('sha256').update(JSON.stringify([this.resource, this.representation, meta.status, meta.headers]))
        for (const part of this.#buffer) hash.update(part)
        meta.revision = hash.digest('base64url')
        meta.unchanged = Boolean(this.revision && this.revision === meta.revision)
        await this.#head(meta)
        if (!meta.unchanged) await this.#release()
        else { this.budget(-this.#bufferSize); this.#bufferSize = 0; this.#buffer = [] }
      } else { await this.#release(); await this.#head() }
      await this.#send('end', jsonBytes({ bytes: this.#bytes, chunks: this.#chunks }))
      this.outer.end()
    })().then(() => callback(), () => callback(Error('Secure response failed')))
  }
  _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    this.budget(-this.#bufferSize); this.#bufferSize = 0; this.#buffer = []
    if (!this.outer.writableEnded) this.outer.destroy()
    callback(error)
  }
}
