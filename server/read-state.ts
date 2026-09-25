import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export type ReplySnapshot = { revision: number; unread: Record<string, string[]> }
type Entry = { known: string[]; unread: string[]; initialized: boolean }
type State = { revision: number; entries: Record<string, Entry> }

/** Shared by all authenticated devices; acknowledgments only remove explicitly seen replies. */
export class ReadStateStore {
  private state: State = { revision: 0, entries: {} }
  constructor(private file?: string, private changed: () => void = () => {}) {
    if (file && existsSync(file)) {
      const value = JSON.parse(readFileSync(file, 'utf8')) as State
      if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !value.entries ||
        Object.values(value.entries).some(entry => !entry || typeof entry.initialized !== 'boolean' ||
          !Array.isArray(entry.known) || !Array.isArray(entry.unread) ||
          [...entry.known, ...entry.unread].some(id => typeof id !== 'string'))) throw Error('Invalid reply read state')
      this.state = value
    }
  }
  historyBoundary(id: string): { initialized: boolean; known: Set<string> } {
    const entry = Object.hasOwn(this.state.entries, id) ? this.state.entries[id] : undefined
    return { initialized: Boolean(entry?.initialized), known: new Set(entry?.known ?? []) }
  }
  snapshot(): ReplySnapshot {
    return { revision: this.state.revision, unread: Object.fromEntries(Object.entries(this.state.entries)
      .filter(([, entry]) => entry.unread.length).map(([id, entry]) => [id, [...entry.unread]])) }
  }
  private commit(id: string, entry: Entry) {
    if (JSON.stringify(this.state.entries[id]) === JSON.stringify(entry)) return this.snapshot()
    const next = { revision: this.state.revision + 1, entries: { ...this.state.entries, [id]: entry } }
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true })
      const temporary = `${this.file}.${randomUUID()}.tmp`
      writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 })
      renameSync(temporary, this.file)
    }
    this.state = next
    this.changed()
    return this.snapshot()
  }
  observe(id: string, ids: string[], live = false): ReplySnapshot {
    const previous = Object.hasOwn(this.state.entries, id) ? this.state.entries[id] : undefined
    const known = new Set(previous?.known), unread = new Set(previous?.unread)
    for (const reply of ids) {
      if (!known.has(reply) && (live || previous?.initialized)) unread.add(reply)
      known.add(reply)
    }
    return this.commit(id, { known: [...known], unread: [...unread], initialized: !live || previous?.initialized === true })
  }
  acknowledge(id: string, ids: string[]): ReplySnapshot {
    const entry = Object.hasOwn(this.state.entries, id) ? this.state.entries[id] : undefined
    if (!entry) return this.snapshot()
    const seen = new Set(ids)
    return this.commit(id, { ...entry, unread: entry.unread.filter(reply => !seen.has(reply)) })
  }
}
