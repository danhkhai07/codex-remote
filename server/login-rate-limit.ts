type LoginWindow = { failures: number[]; blockedUntil: number }

export class LoginRateLimiter {
  readonly #windows = new Map<string, LoginWindow>()
  readonly #maxFailures: number
  readonly #windowMs: number

  constructor(maxFailures = 8, windowMs = 15 * 60_000) {
    this.#maxFailures = maxFailures
    this.#windowMs = windowMs
  }

  isBlocked(key: string, now = Date.now()): boolean {
    const window = this.#windows.get(key)
    if (!window) return false

    if (window.blockedUntil > now) return true

    window.failures = window.failures.filter((time) => now - time < this.#windowMs)
    if (window.failures.length >= this.#maxFailures) {
      window.blockedUntil = now + this.#windowMs
      return true
    }
    if (window.failures.length === 0) this.#windows.delete(key)
    return false
  }

  recordFailure(key: string, now = Date.now()): void {
    const window = this.#windows.get(key) ?? { failures: [], blockedUntil: 0 }
    window.failures = window.failures.filter((time) => now - time < this.#windowMs)
    window.failures.push(now)
    this.#windows.set(key, window)
  }

  clear(key: string): void {
    this.#windows.delete(key)
  }
}
