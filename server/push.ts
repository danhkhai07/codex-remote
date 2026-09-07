import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs'
import webpush, { type PushSubscription } from 'web-push'

type Owner = { nonce: string; expiresAt: number }
type Device = { subscription: PushSubscription; owner: Owner }
type Delivery = { endpoint: string; nonce: string; tag: string; attempts: number; nextAt: number }
type State = { fingerprint: string; keys: { publicKey: string; privateKey: string }; devices: Device[]; deliveries: Delivery[]; seen: string[] }
const hash = (text: string) => createHash('sha256').update(text).digest('base64url')

export function validateSubscription(value: unknown): PushSubscription {
  const input = value as PushSubscription | undefined
  if (!input || typeof input.endpoint !== 'string' || input.endpoint.length > 4096) throw new Error('Invalid push subscription')
  const url = new URL(input.endpoint)
  const host = url.hostname
  const allowed = host === 'fcm.googleapis.com' || host === 'web.push.apple.com' ||
    host === 'updates.push.services.mozilla.com' || /^[a-z0-9-]+\.push\.services\.mozilla\.com$/.test(host)
  if (!allowed || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) throw new Error('Unsupported push service')
  for (const [key, size] of [['p256dh', 65], ['auth', 16]] as const) {
    const encoded = input.keys?.[key]
    if (typeof encoded !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(encoded) || Buffer.from(encoded, 'base64url').length !== size) throw new Error('Invalid push encryption key')
  }
  return { endpoint: url.href, keys: { p256dh: input.keys.p256dh, auth: input.keys.auth } }
}

/** Private single-host state, separate from Codex conversations and the browser event stream. */
export class PushService {
  #state: State
  #timer?: NodeJS.Timeout
  #running = false
  #stopped = false
  constructor(
    private readonly path: string,
    secret: string,
    private readonly subject: string,
    private readonly send: typeof webpush.sendNotification = webpush.sendNotification,
  ) {
    const fingerprint = hash(secret)
    try {
      this.#state = JSON.parse(readFileSync(path, 'utf8')) as State
      if (!this.#state.keys?.publicKey || !this.#state.keys.privateKey || !Array.isArray(this.#state.devices) || !Array.isArray(this.#state.deliveries) || !Array.isArray(this.#state.seen)) throw new Error('Invalid push state')
      if (this.#state.fingerprint !== fingerprint) this.#state = { fingerprint, keys: webpush.generateVAPIDKeys(), devices: [], deliveries: [], seen: [] }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.#state = { fingerprint, keys: webpush.generateVAPIDKeys(), devices: [], deliveries: [], seen: [] }
    }
    this.#save()
  }
  get publicKey() { return this.#state.keys.publicKey }
  #save() {
    const temporary = `${this.path}.tmp`
    writeFileSync(temporary, JSON.stringify(this.#state), { mode: 0o600 })
    chmodSync(temporary, 0o600)
    renameSync(temporary, this.path)
  }
  #prune() {
    this.#state.devices = this.#state.devices.filter(device => device.owner.expiresAt * 1000 > Date.now())
    this.#state.deliveries = this.#state.deliveries.filter(job => this.#state.devices.some(device => device.subscription.endpoint === job.endpoint && device.owner.nonce === job.nonce))
  }
  subscribe(value: unknown, owner: Owner) {
    const subscription = validateSubscription(value)
    this.#prune()
    const existing = this.#state.devices.find(device => device.subscription.endpoint === subscription.endpoint)
    if (existing) {
      existing.owner = { nonce: owner.nonce, expiresAt: owner.expiresAt }
      existing.subscription = subscription
    } else {
      if (this.#state.devices.length >= 64) throw new Error('Push device limit reached')
      this.#state.devices.push({ subscription, owner: { nonce: owner.nonce, expiresAt: owner.expiresAt } })
    }
    this.#prune()
    this.#save()
  }
  enabled(endpoint: unknown, owner: Owner) {
    return typeof endpoint === 'string' && this.#state.devices.some(device => device.subscription.endpoint === endpoint && device.owner.nonce === owner.nonce && device.owner.expiresAt * 1000 > Date.now())
  }
  unsubscribe(owner: Owner, endpoint?: unknown) {
    this.#state.devices = this.#state.devices.filter(device => device.owner.nonce !== owner.nonce || (endpoint !== undefined && device.subscription.endpoint !== endpoint))
    this.#prune()
    this.#save()
  }
  completed(threadId: string, turnId: string) {
    const tag = hash(`${threadId}:${turnId}`).slice(0, 32)
    if (this.#state.seen.includes(tag)) return
    this.#prune()
    this.#state.seen = [...this.#state.seen, tag].slice(-1000)
    for (const device of this.#state.devices) {
      // Coalesce a device's outstanding alerts into its latest completion.
      this.#state.deliveries = this.#state.deliveries.filter(job => job.endpoint !== device.subscription.endpoint)
      this.#state.deliveries.push({ endpoint: device.subscription.endpoint, nonce: device.owner.nonce, tag, attempts: 0, nextAt: Date.now() })
    }
    this.#save()
    this.start()
  }
  start() {
    if (this.#running || this.#stopped) return
    clearTimeout(this.#timer)
    void this.flush().catch(() => console.error('Web Push delivery state could not be saved'))
  }
  stop() { this.#stopped = true; clearTimeout(this.#timer) }
  async flush() {
    if (this.#running) return
    this.#running = true
    try {
      this.#prune()
      for (const job of this.#state.deliveries) {
        if (this.#stopped || job.nextAt > Date.now()) continue
        const device = this.#state.devices.find(device => device.subscription.endpoint === job.endpoint && device.owner.nonce === job.nonce && device.owner.expiresAt * 1000 > Date.now())
        if (!device || !this.#state.deliveries.includes(job)) continue
        try {
          await this.send(device.subscription, JSON.stringify({ tag: job.tag }), {
            vapidDetails: { subject: this.subject, ...this.#state.keys }, timeout: 10000,
            TTL: Math.max(0, Math.min(3600, device.owner.expiresAt - Math.floor(Date.now() / 1000))), urgency: 'high', topic: job.tag,
          })
          this.#state.deliveries = this.#state.deliveries.filter(entry => entry !== job)
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode
          if (status === 404 || status === 410) this.#state.devices = this.#state.devices.filter(entry => entry !== device)
          job.attempts++
          if (job.attempts >= 5 || (status && status >= 400 && status < 500 && status !== 429)) {
            this.#state.deliveries = this.#state.deliveries.filter(entry => entry !== job)
            console.error('Web Push delivery failed; enable notifications again if alerts stop')
          } else job.nextAt = Date.now() + Math.min(300000, 1000 * 2 ** job.attempts)
        }
        this.#prune()
        this.#save()
      }
    } finally {
      this.#running = false
      if (!this.#stopped && this.#state.deliveries.length) {
        const delay = Math.max(100, Math.min(...this.#state.deliveries.map(job => job.nextAt)) - Date.now())
        this.#timer = setTimeout(() => this.start(), delay)
        this.#timer.unref()
      }
    }
  }
}
