import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_IMAGES_PER_TURN = 4
const MAX_PENDING_IMAGES = 32

type Owner = { nonce: string; expiresAt: number }
type StoredAttachment = { id: string; path: string; nonce: string; expiresAt: number; consuming: boolean; turnId?: string }

export class AttachmentError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

function imageExtension(data: Buffer, contentType: string): string {
  const png = data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const jpeg = data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
  const webp = data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP'
  if (contentType === 'image/png' && png) return 'png'
  if (contentType === 'image/jpeg' && jpeg) return 'jpg'
  if (contentType === 'image/webp' && webp) return 'webp'
  throw new AttachmentError(400, 'Image bytes do not match the declared type')
}

/** Session-owned temporary image files; browser-supplied paths never cross this boundary. */
export class AttachmentStore {
  readonly #root: string
  readonly #items = new Map<string, StoredAttachment>()
  readonly #completed = new Set<string>()
  readonly #timer: NodeJS.Timeout

  constructor(root?: string) {
    this.#root = root ?? mkdtempSync(join(tmpdir(), 'codex-remote-images-'))
    if (root) mkdirSync(root, { recursive: true, mode: 0o700 })
    this.#timer = setInterval(() => this.prune(), 60_000)
    this.#timer.unref()
  }

  add(data: Buffer, contentType: string, owner: Owner): { id: string; size: number; contentType: string } {
    this.prune()
    if (data.length === 0) throw new AttachmentError(400, 'Image is empty')
    if (data.length > MAX_IMAGE_BYTES) throw new AttachmentError(413, 'Image exceeds the 10 MB limit')
    if (this.#items.size >= MAX_PENDING_IMAGES) throw new AttachmentError(503, 'Too many pending images; try again shortly')
    if ([...this.#items.values()].filter(item => item.nonce === owner.nonce && !item.turnId).length >= MAX_IMAGES_PER_TURN) {
      throw new AttachmentError(409, `Only ${MAX_IMAGES_PER_TURN} pending images are allowed`)
    }
    const normalized = contentType.toLowerCase().split(';', 1)[0].trim()
    const extension = imageExtension(data, normalized)
    const id = randomUUID()
    const path = join(this.#root, `${id}.${extension}`)
    writeFileSync(path, data, { flag: 'wx', mode: 0o600 })
    this.#items.set(id, {
      id,
      path,
      nonce: owner.nonce,
      expiresAt: Math.min(owner.expiresAt * 1000, Date.now() + 10 * 60_000),
      consuming: false,
    })
    return { id, size: data.length, contentType: normalized }
  }

  remove(id: string, owner: Owner): void {
    const item = this.#items.get(id)
    if (!item || item.nonce !== owner.nonce || item.consuming || item.turnId) throw new AttachmentError(404, 'Attachment not found')
    this.#delete(item)
  }

  clear(owner: Owner): void {
    for (const item of this.#items.values()) if (item.nonce === owner.nonce && !item.consuming && !item.turnId) this.#delete(item)
  }

  async use<T>(ids: unknown, owner: Owner, operation: (paths: string[]) => Promise<T>): Promise<T> {
    this.prune()
    if (ids === undefined || ids === null) return operation([])
    if (!Array.isArray(ids) || ids.length > MAX_IMAGES_PER_TURN || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) {
      throw new AttachmentError(400, 'Invalid attachment list')
    }
    const items = ids.map(id => this.#items.get(id as string)).map(item => {
      if (!item || item.nonce !== owner.nonce || item.consuming || item.turnId) throw new AttachmentError(404, 'Attachment not found')
      return item
    })
    for (const item of items) item.consuming = true
    try {
      const result = await operation(items.map(item => item.path))
      const turnId = (result as { turn?: { id?: unknown } } | null)?.turn?.id
      for (const item of items) {
        if (typeof turnId === 'string' && !this.#completed.has(turnId)) {
          item.turnId = turnId
          item.expiresAt = Date.now() + 24 * 60 * 60_000
        } else this.#delete(item)
      }
      return result
    } finally {
      for (const item of items) item.consuming = false
    }
  }

  completeTurn(turnId: string): void {
    this.#completed.add(turnId)
    if (this.#completed.size > 256) this.#completed.delete(this.#completed.values().next().value!)
    for (const item of this.#items.values()) if (item.turnId === turnId) this.#delete(item)
  }

  prune(now = Date.now()): void {
    for (const item of this.#items.values()) if (!item.consuming && item.expiresAt <= now) this.#delete(item)
  }

  stop(): void {
    clearInterval(this.#timer)
    this.#items.clear()
    rmSync(this.#root, { recursive: true, force: true })
  }

  #delete(item: StoredAttachment): void {
    this.#items.delete(item.id)
    rmSync(item.path, { force: true })
  }
}
