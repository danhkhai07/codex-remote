import { secureFetch } from './secureApi'
/** Fetch SSE preserves existing epoch/cursor/fragment semantics over verified frames. */
export class SecureEvents extends EventTarget {
  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  #closed = false
  #controller?: AbortController
  #timer?: ReturnType<typeof setTimeout>
  #url: URL
  constructor(url: string) { super(); this.#url = new URL(url, location.origin); queueMicrotask(() => void this.#run()) }
  close() { this.#closed = true; clearTimeout(this.#timer); this.#controller?.abort() }
  async #run() {
    this.#controller = new AbortController()
    try {
      const res = await secureFetch(this.#url.pathname + this.#url.search, { signal: this.#controller.signal })
      if (!res.ok || !res.body) throw Error('Event stream unavailable')
      this.onopen?.(new Event('open'))
      const reader = res.body.getReader(), decoder = new TextDecoder()
      let pending = ''
      try { while (!this.#closed) {
        const { done, value } = await reader.read()
        if (done) throw Error('Event stream ended')
        pending += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
        if (pending.length > 1024 * 1024) throw Error('Oversized SSE record')
        let at: number
        while ((at = pending.indexOf('\n\n')) >= 0) {
          const lines = pending.slice(0, at).split('\n'); pending = pending.slice(at + 2)
          let type = 'message', id = '', data = ''
          for (const line of lines) {
            if (line.startsWith('event:')) type = line.slice(6).trim()
            else if (line.startsWith('id:')) id = line.slice(3).trim()
            else if (line.startsWith('data:')) data += line.slice(5).replace(/^ /, '') + '\n'
          }
          if (!data) continue
          if (id) this.#url.searchParams.set('after', id)
          if (type === 'stream-state') {
            const state = JSON.parse(data)
            if (typeof state.epoch === 'string') this.#url.searchParams.set('epoch', state.epoch)
            if (state.reset) this.#url.searchParams.set('after', '0')
          }
          const event = new MessageEvent<string>(type, { data: data.slice(0, -1), lastEventId: id })
          if (type === 'message') this.onmessage?.(event)
          this.dispatchEvent(event)
        }
      } } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    } catch { if (!this.#closed) this.onerror?.(new Event('error')) }
    if (!this.#closed) this.#timer = setTimeout(() => void this.#run(), 1500)
  }
}
