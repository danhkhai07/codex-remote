/** Streaming JSON projection, not a full-record accumulator. Native JSONL can
 * contain arbitrarily large strings. JSON structure is checked while only bounded
 * strings/containers are retained. Unknown/deep formats fail visibly. */
/** Only invalid JSON syntax is recoverable as a malformed native JSONL line.
 * Resource limits and unsupported valid formats must still fail closed. */
export class HistoryJsonSyntaxError extends Error {}
type Frame = { value: Record<string, unknown> | unknown[]; array: boolean; state: string; key: string; count: number; keep: boolean }
const important = new Set(['ordinal', 'payload', 'item', 'type', 'id', 'turn_id', 'thread_id', 'cwd', 'status', 'phase', 'channel', 'call_id', 'num_turns', 'history_base', 'subagent_history_start_ordinal', 'history_mode'])
export class HistoryJson {
  private stack: Frame[] = []
  private mode: 'none' | 'string' | 'word' = 'none'
  private token = ''
  private escape = false
  private key = false
  private unicode = 0
  private clippedString = false
  private tokenLimit = 0
  private bytes = 0
  private nodes = 0
  private done = false
  private root: unknown
  truncated = false
  private critical(parent: Frame) {
    // Identity exceptions apply only to the native envelope, never arbitrary
    // tool argument trees whose keys happen to be named payload/item/id.
    return !parent.array && important.has(parent.key) && (this.stack.length === 1 ||
      (this.stack[0]?.key === 'payload' && (this.stack.length === 2 ||
        (this.stack.length === 3 && this.stack[1]?.key === 'item'))))
  }
  private keepValue() {
    const parent = this.stack.at(-1)
    return !parent || (parent.keep && ((++this.nodes <= 2048 && parent.count < 64) || this.critical(parent)))
  }
  private accept(value: unknown, retained?: boolean) {
    const parent = this.stack.at(-1)
    if (!parent) { if (this.done) throw new HistoryJsonSyntaxError('Multiple history JSON values'); this.root = value; this.done = true; return }
    if (!['value', 'first'].includes(parent.state)) throw new HistoryJsonSyntaxError('Invalid history JSON value')
    // Containers reserve their place when opened. Rechecking after their
    // children exhaust the budget would discard the entire retained prefix.
    if (retained ?? this.keepValue()) {
      if (parent.array) (parent.value as unknown[]).push(value)
      else Object.defineProperty(parent.value, parent.key, { value, writable: true, enumerable: true, configurable: true })
    } else this.truncated = true
    parent.count++; parent.state = 'comma'
  }
  private start(byte: number) {
    const parent = this.stack.at(-1)
    if (parent && !['value', 'first'].includes(parent.state)) throw new HistoryJsonSyntaxError('Invalid history JSON')
    if (byte === 123 || byte === 91) {
      if (this.stack.length >= 64) throw Error('History JSON nesting exceeds supported depth')
      const keep = this.keepValue(), array = byte === 91
      this.stack.push({ value: array ? [] : Object.create(null), array, state: 'first', key: '', count: 0, keep })
    } else if (byte === 34) this.string(false)
    else if (byte === 45 || (byte >= 48 && byte <= 57) || [116, 102, 110].includes(byte)) { this.mode = 'word'; this.token = String.fromCharCode(byte) }
    else throw new HistoryJsonSyntaxError('Invalid history JSON token')
  }
  private string(key: boolean) {
    this.mode = 'string'; this.key = key; this.escape = false; this.unicode = 0; this.clippedString = false; this.token = ''
    const parent = this.stack.at(-1)
    this.tokenLimit = key ? 256 : parent && this.critical(parent) ? 4096 : Math.max(0, Math.min(16_384, 65_536 - this.bytes))
  }
  private endString() {
    let raw = this.token, value: string | undefined
    // A clipped prefix may end inside UTF-8, an escape or a surrogate pair.
    for (let cut = 0; cut <= 12; cut++) {
      try { value = JSON.parse('"' + new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(raw, 'latin1')) + '"'); break }
      catch { if (!this.clippedString || this.key) throw new HistoryJsonSyntaxError('Invalid history JSON string'); raw = raw.slice(0, -1) }
    }
    if (value === undefined) throw Error('Invalid history string prefix')
    value = value.replace(/[\uD800-\uDBFF]$/, '')
    if (this.key) {
      const parent = this.stack.at(-1)!
      parent.key = value; parent.state = 'colon'
    } else { this.bytes += raw.length; this.accept(value) }
    this.mode = 'none'; this.token = ''
  }
  get hasValue() { return this.done || this.stack.length > 0 || this.mode !== 'none' }
  /** Fast skip for the unretained tail of huge strings. The regex still scans
   * every byte for JSON control/escape/delimiter syntax; only a 64 KiB caller
   * buffer is converted, never a complete source record. */
  feedBuffer(bytes: Buffer): void {
    // JSON explicitly forbids unescaped control bytes, including clipped tails.
    // eslint-disable-next-line no-control-regex
    const text = bytes.toString('latin1'), special = /[\x00-\x1f"\\]/g
    for (let index = 0; index < text.length; index++) {
      if (this.mode === 'string' && !this.key && !this.escape && !this.unicode && this.token.length >= this.tokenLimit) {
        special.lastIndex = index
        const match = special.exec(text), stop = match?.index ?? text.length
        if (stop > index) { this.truncated = true; this.clippedString = true }
        if (!match) return
        index = stop
      }
      this.feed(text.charCodeAt(index))
    }
  }
  feed(byte: number): void {
    if (this.mode === 'string') {
      if (byte < 32) throw new HistoryJsonSyntaxError('Unescaped control in history JSON')
      if (this.unicode) {
        if (!((byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 70) || (byte >= 97 && byte <= 102))) throw new HistoryJsonSyntaxError('Invalid Unicode escape')
        this.unicode--
      } else if (this.escape) {
        if (![34, 92, 47, 98, 102, 110, 114, 116, 117].includes(byte)) throw new HistoryJsonSyntaxError('Invalid JSON escape')
        if (byte === 117) this.unicode = 4
      }
      if (!this.escape && byte === 34) { this.endString(); return }
      if (this.token.length < this.tokenLimit) this.token += String.fromCharCode(byte)
      else { if (this.key) throw Error('History JSON key too long'); this.truncated = true; this.clippedString = true }
      if (this.escape) this.escape = false
      else if (byte === 92) this.escape = true
      return
    }
    if (this.mode === 'word') {
      if (![9, 10, 13, 32, 44, 93, 125].includes(byte)) {
        if (this.token.length >= 128) throw Error('History JSON scalar too long')
        this.token += String.fromCharCode(byte); return
      }
      let value: unknown
      try { value = JSON.parse(this.token) } catch (error) {
        if (error instanceof SyntaxError) throw new HistoryJsonSyntaxError('Invalid history JSON scalar')
        throw error
      }
      if (typeof value === 'object' && value !== null) throw Error('Invalid scalar')
      if (typeof value === 'number' && !Number.isFinite(value)) throw Error('Invalid number')
      this.mode = 'none'; this.token = ''; this.accept(value)
    }
    if ([9, 10, 13, 32].includes(byte)) return
    const parent = this.stack.at(-1)
    if (!parent) { if (this.done) throw new HistoryJsonSyntaxError('Trailing history JSON'); this.start(byte); return }
    if (byte === 93 || byte === 125) {
      if ((byte === 93) !== parent.array || !['first', 'comma'].includes(parent.state)) throw new HistoryJsonSyntaxError('Invalid history JSON end')
      this.stack.pop(); this.accept(parent.value, parent.keep); return
    }
    if (parent.state === 'comma') {
      if (byte !== 44) throw new HistoryJsonSyntaxError('Missing history JSON comma')
      parent.state = parent.array ? 'value' : 'key'; return
    }
    if (!parent.array && ['first', 'key'].includes(parent.state)) {
      if (byte !== 34) throw new HistoryJsonSyntaxError('Missing history JSON key')
      this.string(true); return
    }
    if (parent.state === 'colon') {
      if (byte !== 58) throw new HistoryJsonSyntaxError('Missing history JSON colon')
      parent.state = 'value'; return
    }
    this.start(byte)
  }
  finish(): { value: unknown; truncated: boolean } {
    if (this.mode === 'word') this.feed(32)
    if (this.mode !== 'none' || this.stack.length || !this.done) throw new HistoryJsonSyntaxError('Incomplete history JSON record')
    return { value: this.root, truncated: this.truncated }
  }
}
