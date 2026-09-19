import { describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { EMPTY_NEW_CONVERSATION, prepareNewConversation, type NewConversation } from './newConversation'
import type { Thread } from './types'

const thread: Thread = { id: 'created', cwd: '/workspace', createdAt: 0, updatedAt: 0, status: {}, turns: [] }
function setup() {
  const access = { ...api,
    createThread: vi.fn().mockResolvedValue({ thread }),
    renameThread: vi.fn().mockResolvedValue({ name: 'Chosen title' }),
    moveConversation: vi.fn().mockResolvedValue({}),
  }
  let draft: NewConversation = { ...EMPTY_NEW_CONVERSATION, name: 'Chosen title', groupId: 'folder' }
  const remember = (created: Thread) => { draft = { ...draft, thread: created } }
  return { access, remember, draft: () => draft }
}
describe('prepare a conversation on first send', () => {
  it('creates in the chosen folder and preserves the explicit title before a turn starts', async () => {
    const { access, remember, draft } = setup()
    const result = await prepareNewConversation(draft(), '0', 'csrf', true, remember, access)
    expect(access.createThread).toHaveBeenCalledWith('0', 'csrf', true, 'folder')
    expect(access.renameThread).toHaveBeenCalledWith('created', 'Chosen title', 'csrf')
    expect(result.name).toBe('Chosen title')
    expect(draft().thread).toEqual(result)
  })
  it.each(['', '   ', 'x'.repeat(201), 'title\ncontrol'])('rejects invalid name before creating anything: %j', async name => {
    const { access, remember, draft } = setup()
    await expect(prepareNewConversation({ ...draft(), name }, '0', 'csrf', false, remember, access)).rejects.toThrow('Enter a conversation name')
    expect(access.createThread).not.toHaveBeenCalled()
  })
  it('retains the created ID if naming fails and reuses it on retry', async () => {
    const { access, remember, draft } = setup()
    access.renameThread.mockRejectedValueOnce(new Error('Disconnected'))
    await expect(prepareNewConversation(draft(), '0', 'csrf', false, remember, access)).rejects.toThrow('Disconnected')
    expect(draft().thread?.id).toBe('created')
    await prepareNewConversation(draft(), '0', 'csrf', false, remember, access)
    expect(access.createThread).toHaveBeenCalledTimes(1)
    expect(access.renameThread).toHaveBeenCalledTimes(2)
  })
  it('reuses the conversation after a failed turn and applies edits to the name and folder', async () => {
    const { access, remember, draft } = setup()
    await prepareNewConversation(draft(), '0', 'csrf', false, remember, access)
    const result = await prepareNewConversation({ ...draft(), name: 'Updated title', groupId: '' }, '0', 'csrf', false, remember, access)
    expect(access.createThread).toHaveBeenCalledTimes(1)
    expect(access.moveConversation).toHaveBeenCalledWith('created', null, 'csrf')
    expect(result.name).toBe('Updated title')
  })
  it('leaves an ungrouped conversation outside named folders', async () => {
    const { access, remember, draft } = setup()
    await prepareNewConversation({ ...draft(), groupId: '' }, '0', 'csrf', false, remember, access)
    expect(access.createThread).toHaveBeenCalledWith('0', 'csrf', false, undefined)
  })
})
