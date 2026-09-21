import { api } from './api'
import { secureIntent } from './secureApi'
import type { Thread } from './types'

export const NEW_CONVERSATION_KEY = 'new-conversation-draft'
export type NewConversation = { name: string; groupId: string; thread: Thread | null }
export const EMPTY_NEW_CONVERSATION: NewConversation = { name: '', groupId: '', thread: null }

/** Keep the created ID before any subsequent request so retries reuse the same conversation. */
export async function prepareNewConversation(draft: NewConversation, workspaceId: string, csrf: string, fullAccess: boolean,
  remember: (thread: Thread) => void, access = api): Promise<Thread> {
  const intent = secureIntent(); intent.assert()
  const name = draft.name.trim()
  if (!name || name.length > 200 || [...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw new Error('Enter a conversation name (1–200 characters, no control characters).')
  }
  let thread = draft.thread
  if (!thread) {
    thread = (await access.createThread(workspaceId, csrf, fullAccess, draft.groupId || undefined)).thread
    intent.assert()
    remember(thread)
  } else {
    await access.moveConversation(thread.id, draft.groupId || null, csrf)
    intent.assert()
  }
  if (thread.name !== name) {
    await access.renameThread(thread.id, name, csrf)
    intent.assert()
    thread = { ...thread, name }
    remember(thread)
  }
  return thread
}
