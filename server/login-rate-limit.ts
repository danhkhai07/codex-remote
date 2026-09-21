type LoginWindow = { failures: number[]; blockedUntil: number; pending: number }
export type LoginAdmission =
  | { allowed: true; finish: (success: boolean, now?: number) => void }
  | { allowed: false; reason: 'blocked' | 'capacity'; retryAfterSeconds: number }

/** Bounded, per-process admission. Existing identities are never evicted for churn.
 * In-flight attempts reserve a slot before the request body is awaited. */
export class LoginRateLimiter {
  readonly #windows = new Map<string, LoginWindow>()
  readonly #maxFailures: number
  readonly #windowMs: number
  readonly #capacity: number
  #sweepCursor: MapIterator<[string, LoginWindow]> | undefined

  constructor(maxFailures = 8, windowMs = 15 * 60_000, capacity = 4096) {
    if (!Number.isSafeInteger(maxFailures) || maxFailures < 1 || maxFailures > 100 ||
        !Number.isSafeInteger(windowMs) || windowMs < 1 ||
        !Number.isSafeInteger(capacity) || capacity < 1 || capacity > 65_536) throw new Error('Invalid login rate limit bounds')
    this.#maxFailures = maxFailures
    this.#windowMs = windowMs
    this.#capacity = capacity
  }

  get trackedIdentities(): number { return this.#windows.size }

  #prune(window: LoginWindow, now: number): void {
    // At most maxFailures timestamps, including when many requests complete at once.
    window.failures = window.failures.filter(time => now - time < this.#windowMs)
  }

  #sweep(now: number): void {
    // A rotating cursor globally reclaims expired identities, including cold ones.
    // Fixed work per admission/completion, not a full scan on an attacker request.
    this.#sweepCursor ??= this.#windows.entries()
    for (let i = 0; i < 32; i += 1) {
      const entry = this.#sweepCursor.next()
      if (entry.done) { this.#sweepCursor = undefined; break }
      const [key, window] = entry.value
      this.#prune(window, now)
      if (!window.pending && !window.failures.length && window.blockedUntil <= now) this.#windows.delete(key)
    }
  }

  beginAttempt(key: string, now = Date.now()): LoginAdmission {
    this.#sweep(now)
    let window = this.#windows.get(key)
    if (!window) {
      // Real HTTP callers use normalized IPs. Bound retained keys even for other callers.
      if (key.length > 128 || this.#windows.size >= this.#capacity) {
        return { allowed: false, reason: 'capacity', retryAfterSeconds: 1 }
      }
      window = { failures: [], blockedUntil: 0, pending: 0 }
      this.#windows.set(key, window)
    }
    this.#prune(window, now)
    if (window.blockedUntil > now) {
      return { allowed: false, reason: 'blocked', retryAfterSeconds: Math.max(1, Math.ceil((window.blockedUntil - now) / 1000)) }
    }
    if (window.failures.length + window.pending >= this.#maxFailures) {
      return { allowed: false, reason: 'blocked', retryAfterSeconds: 1 }
    }
    window.pending += 1
    let finished = false
    return { allowed: true, finish: (success, completedAt = Date.now()) => {
      if (finished) return
      finished = true
      window.pending -= 1
      this.#prune(window, completedAt)
      if (success) { window.failures = []; window.blockedUntil = 0 }
      else if (window.failures.length < this.#maxFailures) {
        window.failures.push(completedAt)
        if (window.failures.length >= this.#maxFailures && window.blockedUntil <= completedAt) window.blockedUntil = completedAt + this.#windowMs
      }
      if (!window.pending && !window.failures.length && window.blockedUntil <= completedAt) this.#windows.delete(key)
      this.#sweep(completedAt)
    } }
  }
}
