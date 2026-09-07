/** Assemble one ordered event; reconnects replay any unfinished event in full. */
export class EventAssembler {
  private id = -1
  private total = 0
  private parts: string[] = []

  reset() {
    this.id = -1
    this.total = 0
    this.parts = []
  }

  accept(encoded: string): string | null {
    let fragment: { id: number; index: number; total: number; data: string }
    try { fragment = JSON.parse(encoded) } catch { this.reset(); return null }
    if (!fragment || !Number.isSafeInteger(fragment.id) || !Number.isSafeInteger(fragment.index) ||
      !Number.isSafeInteger(fragment.total) || fragment.total < 1 || fragment.total > 100_000 ||
      fragment.index < 0 || fragment.index >= fragment.total || typeof fragment.data !== 'string' || fragment.data.length > 4_000) {
      this.reset()
      return null
    }
    if (fragment.index === 0) {
      this.reset()
      this.id = fragment.id
      this.total = fragment.total
    }
    if (fragment.id !== this.id || fragment.total !== this.total || fragment.index !== this.parts.length) {
      this.reset()
      return null
    }
    this.parts.push(fragment.data)
    if (this.parts.length !== this.total) return null
    const data = this.parts.join('')
    this.reset()
    return data
  }
}
