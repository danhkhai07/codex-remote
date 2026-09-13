import type { ServerResponse } from 'node:http'

/** Bound each client's backlog and stop writing until the socket drains. */
export class SseWriter {
  #queue: string[] = []
  #queuedBytes = 0
  #blocked = false
  #closed = false
  #timer: NodeJS.Timeout | undefined

  constructor(
    readonly response: ServerResponse,
    readonly maxBufferedBytes = 32 * 1024 * 1024,
    readonly drainTimeoutMs = 30_000,
  ) {
    response.on('drain', this.#drain)
    response.on('close', this.close)
    response.on('error', this.#disconnect)
  }

  write(frames: readonly string[]): void {
    for (const frame of frames) {
      if (this.#closed) return
      const bytes = Buffer.byteLength(frame)
      if (this.#queuedBytes + this.response.writableLength + bytes > this.maxBufferedBytes) {
        this.#disconnect()
        return
      }
      if (this.#blocked) {
        this.#queue.push(frame)
        this.#queuedBytes += bytes
      } else {
        this.#write(frame)
      }
    }
  }

  close = (): void => {
    if (this.#closed) return
    this.#closed = true
    clearTimeout(this.#timer)
    this.#queue = []
    this.#queuedBytes = 0
    this.response.off('drain', this.#drain)
    this.response.off('close', this.close)
    this.response.off('error', this.#disconnect)
  }

  #disconnect = (): void => {
    this.response.destroy()
    this.close()
  }

  #write(frame: string): void {
    if (this.response.destroyed || this.response.writableEnded) {
      this.close()
      return
    }
    if (!this.response.write(frame)) {
      this.#blocked = true
      this.#timer = setTimeout(this.#disconnect, this.drainTimeoutMs)
      this.#timer.unref()
    }
  }

  #drain = (): void => {
    if (this.#closed) return
    clearTimeout(this.#timer)
    this.#blocked = false
    while (this.#queue.length && !this.#blocked && !this.#closed) {
      const frame = this.#queue.shift()!
      this.#queuedBytes -= Buffer.byteLength(frame)
      this.#write(frame)
    }
  }
}
