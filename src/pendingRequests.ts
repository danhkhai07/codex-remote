import type { PendingRequest, RemoteEvent } from './types'

export type PendingSnapshot = { data: PendingRequest[]; cursor: number; epoch: string }

/** Reconcile authoritative snapshots with SSE changes that can arrive during HTTP reads. */
export class PendingRequests {
  private epoch = ''
  private cursor = -1
  private requests = new Map<string, PendingRequest>()
  private changes = new Map<string, { id: number; request?: PendingRequest }>()
  private dismissed = new Set<string>()

  beginEpoch(epoch: string): void {
    if (this.epoch === epoch) return
    this.epoch = epoch
    this.cursor = -1
    this.requests.clear()
    this.changes.clear()
    this.dismissed.clear()
  }

  snapshot(snapshot: PendingSnapshot): PendingRequest[] {
    if (!this.epoch) this.beginEpoch(snapshot.epoch)
    if (snapshot.epoch !== this.epoch || snapshot.cursor < this.cursor) return this.values()
    this.cursor = snapshot.cursor
    this.requests = new Map(snapshot.data.map(request => [request.key, request]))
    for (const [key, change] of this.changes) {
      if (change.id <= this.cursor) this.changes.delete(key)
      else if (change.request) this.requests.set(key, change.request)
      else this.requests.delete(key)
    }
    for (const key of this.dismissed) {
      if (!this.requests.has(key)) this.dismissed.delete(key)
      this.requests.delete(key)
    }
    return this.values()
  }

  event(event: RemoteEvent): PendingRequest[] {
    if (event.id <= this.cursor) return this.values()
    const request = event.type === 'request' ? event.payload as unknown as PendingRequest : undefined
    const key = request?.key ?? String((event.payload as { key?: string }).key ?? '')
    if (!key || (this.changes.get(key)?.id ?? -1) >= event.id) return this.values()
    this.changes.set(key, { id: event.id, request })
    if (request && !this.dismissed.has(key)) this.requests.set(key, request)
    else this.requests.delete(key)
    return this.values()
  }

  dismiss(key: string): PendingRequest[] {
    this.dismissed.add(key)
    this.requests.delete(key)
    return this.values()
  }

  values(): PendingRequest[] { return [...this.requests.values()] }
}
