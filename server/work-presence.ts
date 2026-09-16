import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

type Presence = { at: number; visible: boolean; processing: boolean }
export const MAX_PRESENCE_GAP_MS = 45_000

/** Server timestamps only. A suspended/missing browser never earns an idle allowance. */
export class WorkPresence {
  private clients = new Map<string, Presence>()
  private turns = new Set<string>()
  constructor(private file: string, private clock = Date.now) {
    mkdirSync(dirname(file), { recursive: true })
    this.write({ kind: 'restart', at: this.clock() })
  }
  private write(record: object) { appendFileSync(this.file, JSON.stringify(record) + '\n', { mode: 0o600 }) }
  report(owner: string, input: Record<string, unknown>) {
    if (typeof input.clientId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(input.clientId)
      || typeof input.visible !== 'boolean' || typeof input.processing !== 'boolean') throw new Error('Invalid screen presence')
    const now = this.clock(), key = `${owner}:${input.clientId}`, previous = this.clients.get(key)
    if (previous && now > previous.at && now - previous.at <= MAX_PRESENCE_GAP_MS) {
      this.write({ kind: 'screen', start: previous.at, end: now,
        visible: previous.visible, processing: previous.processing })
    }
    this.clients.set(key, { at: now, visible: input.visible, processing: input.processing })
    for (const [id, item] of this.clients) if (now - item.at > MAX_PRESENCE_GAP_MS) this.clients.delete(id)
  }
  processing(threadId: string, turnId: string, active: boolean) {
    const key = `${threadId}:${turnId}`
    if (active) this.turns.add(key)
    else this.turns.delete(key)
    this.write({ kind: 'processing', at: this.clock(), active: this.turns.size > 0 })
  }
}
