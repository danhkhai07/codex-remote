import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AttachmentStore, MAX_IMAGE_BYTES } from './attachments.js'

const roots: string[] = []
const stores: AttachmentStore[] = []
const owner = { nonce: 'session-one', expiresAt: Math.floor(Date.now() / 1000) + 3600 }
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'attachment-test-'))
  roots.push(root)
  const store = new AttachmentStore(root)
  stores.push(store)
  return store
}

afterEach(() => {
  for (const store of stores.splice(0)) store.stop()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('AttachmentStore', () => {
  it('keeps images readable after turn acceptance and logout until the turn completes', async () => {
    const store = setup()
    const attached = store.add(png, 'image/png', owner)
    let localPath = ''
    await store.use([attached.id], owner, async paths => {
      localPath = paths[0]
      expect(existsSync(localPath)).toBe(true)
      return { turn: { id: 'turn-one' } }
    })
    store.clear(owner)
    expect(existsSync(localPath)).toBe(true)
    await expect(store.use([attached.id], owner, async () => {})).rejects.toThrow('Attachment not found')
    store.completeTurn('turn-one')
    expect(existsSync(localPath)).toBe(false)
  })

  it('allows retry after rejection and handles completion before the start response', async () => {
    const store = setup()
    const image = store.add(png, 'image/png', owner)
    await expect(store.use([image.id], owner, async () => { throw new Error('rejected') })).rejects.toThrow('rejected')
    let localPath = ''
    await store.use([image.id], owner, async paths => {
      localPath = paths[0]
      expect(existsSync(localPath)).toBe(true)
      store.completeTurn('fast-turn')
      return { turn: { id: 'fast-turn' } }
    })
    expect(existsSync(localPath)).toBe(false)
  })

  it('rejects another session, spoofed image bytes, oversized images, and duplicate ids', async () => {
    const store = setup()
    const attached = store.add(png, 'image/png', owner)
    await expect(store.use([attached.id], { ...owner, nonce: 'other' }, async () => {})).rejects.toThrow('Attachment not found')
    expect(() => store.add(Buffer.from('not png'), 'image/png', owner)).toThrow('do not match')
    expect(() => store.add(Buffer.alloc(MAX_IMAGE_BYTES + 1), 'image/jpeg', owner)).toThrow('10 MB')
    await expect(store.use([attached.id, attached.id], owner, async () => {})).rejects.toThrow('Invalid attachment list')
  })
})
