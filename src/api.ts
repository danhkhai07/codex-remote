import { secureFetch, secureIntent, cachedHistoryResponse } from './secureApi'
import { boundedBlob } from './boundedBlob'
import { ensurePreviewMigrationReady } from './legacyPreviewWorkers'
import type { SkillList, SkillSelection } from '../server/skills'
import type { ServiceInput, ServicesSnapshot } from '../server/services'
import type { ReplySnapshot } from '../server/read-state'
import type { GroupSnapshot } from './conversationGroups'
import type { TeamSnapshot } from './ConversationTeam'
import type { DirectoryListing, ModelList, RateLimitsResponse, ServerFileInfo, Session, ThreadList, ThreadResponse, TurnResponse } from './types'
import type { PendingSnapshot } from './pendingRequests'
import { limitConversation } from '../server/conversation-size'
import type { ContextTrace, KnowledgeSnapshot, NoteDocument, NoteVersion } from '../server/knowledge-types'

export type ContextTraceSummary = Omit<ContextTrace, 'snippets' | 'omitted'> & { noteCount: number; omittedCount: number }

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}, csrf?: string): Promise<T> {
  const intent = secureIntent(); intent.assert()
  // Successful logout deliberately invalidates its own lifetime and returns only a public acknowledgement.
  const check = () => { if (path !== '/api/session/logout') intent.assert() }
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (csrf && !['GET', 'HEAD'].includes(init.method ?? 'GET')) headers.set('X-CSRF-Token', csrf)
  const signal = init.signal ?? (['GET', 'HEAD'].includes(init.method ?? 'GET') ? AbortSignal.timeout(10_000) : undefined)
  const response = await secureFetch(path, { ...init, signal, headers, credentials: 'same-origin' })
  check()
  const body = await response.json().catch((error: unknown) => {
    if (!response.ok) return {}
    if (error instanceof SyntaxError) throw new ApiError(502, 'Server returned incomplete or invalid data. Please retry.')
    throw error
  }) as { error?: string }
  check()
  if (!response.ok) throw new ApiError(response.status, body.error ?? `Request failed (${response.status})`)
  return body as T
}

export function serverFileUrl(path: string, download = false): string {
  const query = new URLSearchParams({ path })
  if (download) query.set('download', '1')
  return `/api/files/content?${query}`
}

async function requestText(path: string): Promise<string> {
  const intent = secureIntent(); intent.assert()
  const response = await secureFetch(path, { credentials: 'same-origin' })
  intent.assert()
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string }; intent.assert()
    throw new ApiError(response.status, body.error ?? `Request failed (${response.status})`)
  }
  const value = await response.text(); intent.assert(); return value
}

async function requestBlob(path: string, signal?: AbortSignal, limit = 20 * 1024 * 1024): Promise<Blob> {
  const intent = secureIntent(); intent.assert()
  const response = await secureFetch(path, { credentials: 'same-origin', signal })
  intent.assert()
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string }; intent.assert()
    throw new ApiError(response.status, body.error ?? `Request failed (${response.status})`)
  }
  const value = await boundedBlob(response, limit); intent.assert(); return value
}

export const api = {
  knowledge: () => request<KnowledgeSnapshot>('/api/knowledge'),
  knowledgeNote: (path: string, signal?: AbortSignal) => request<NoteDocument>(`/api/knowledge/note?${new URLSearchParams({ path })}`, { signal }),
  knowledgeSource: (path: string) => request<{ path: string; content: string }>(`/api/knowledge/source?${new URLSearchParams({ path })}`),
  saveKnowledge: (path: string, content: string, revision: string, csrf: string) => request<NoteDocument>('/api/knowledge/note', { method: 'PUT', body: JSON.stringify({ path, content, revision, actor: 'knowledge-page' }) }, csrf),
  knowledgeVersions: (path: string) => request<{ versions: NoteVersion[] }>(`/api/knowledge/versions?${new URLSearchParams({ path })}`),
  knowledgeVersion: (path: string, id: string) => request<{ version: NoteVersion; content: string; diff: { changed: boolean; startLine: number; before: string; after: string } }>(`/api/knowledge/version?${new URLSearchParams({ path, id })}`),
  restoreKnowledge: (path: string, versionId: string, revision: string, csrf: string) => request<NoteDocument>('/api/knowledge/restore', { method: 'POST', body: JSON.stringify({ path, versionId, revision, actor: 'knowledge-page' }) }, csrf),
  knowledgeTraces: (threadId = '') => request<{ traces: ContextTraceSummary[] }>(`/api/knowledge/traces?${new URLSearchParams(threadId ? { threadId } : {})}`),
  knowledgeTrace: (id: string) => request<ContextTrace>(`/api/knowledge/traces?${new URLSearchParams({ id })}`),
  previewKnowledge: (threadId: string, text: string, csrf: string) => request<ContextTrace>('/api/knowledge/preview', { method: 'POST', body: JSON.stringify({ threadId, text }) }, csrf),
  services: () => request<ServicesSnapshot>('/api/services'),
  saveService: (service: ServiceInput, csrf: string) => request('/api/services', { method: 'PUT', body: JSON.stringify(service) }, csrf),
  removeService: (key: string, csrf: string) => request(`/api/services?${new URLSearchParams({ key })}`, { method: 'DELETE' }, csrf),
  localhostPreviewStatus: () => request<{ enabled: boolean }>('/api/localhost-preview'),
  launchLocalhostPreview: (port: number, path: string, csrf: string, signal?: AbortSignal) => request<{ url: string; viewUrl: string; port: number; expiresAt: number }>('/api/localhost-preview', {
    method: 'POST', body: JSON.stringify({ port, path }), signal,
  }, csrf),
  workHours: () => request<{ revision: number; autoPaused?: boolean; totals: Record<string, number>; timer: unknown; serverNow: number }>('/api/working-hours'),
  changeWorkHours: (body: Record<string, unknown>, csrf: string) => request<{ revision: number; autoPaused?: boolean; totals: Record<string, number>; timer: unknown; serverNow: number }>('/api/working-hours', { method: 'POST', body: JSON.stringify(body) }, csrf),
  fileRoots: (signal?: AbortSignal) => request<{ roots: string[] }>('/api/files/roots', { signal }),
  directory: (path: string, options: { search: string; hidden: boolean; offset: number }, signal?: AbortSignal) => request<DirectoryListing>(`/api/files/list?${new URLSearchParams({ path, search: options.search, hidden: options.hidden ? '1' : '0', offset: String(options.offset) })}`, { signal }),
  fileInfo: (path: string) => request<ServerFileInfo>(`/api/files/info?${new URLSearchParams({ path })}`),
  htmlText: (path: string) => requestText(`/api/files/html-preview?${new URLSearchParams({ path })}`),
  fileText: (path: string) => requestText(serverFileUrl(path)),
  fileBlob: (path: string) => requestBlob(serverFileUrl(path, true)),
  pdfPreview: (path: string, signal: AbortSignal) => requestBlob(serverFileUrl(path), signal, 64 * 1024 * 1024),
  pptxPreview: (path: string, signal: AbortSignal) => requestBlob(`/api/files/pptx-preview?${new URLSearchParams({ path })}`, signal, 32 * 1024 * 1024),
  uploadAttachment: (file: File, csrf: string) => request<{ id: string; size: number; contentType: string }>(`/api/attachments?${new URLSearchParams({ name: file.name })}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  }, csrf),
  deleteAttachment: (id: string, csrf: string) => request<{ ok: boolean }>(`/api/attachments/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }, csrf),
  pushKey: () => request<{ publicKey: string }>('/api/push/key'),
  pushStatus: (endpoint: string, csrf: string) => request<{ enabled: boolean }>('/api/push/status', { method: 'POST', body: JSON.stringify({ endpoint }) }, csrf),
  pushVisibility: (endpoint: string, visible: boolean, csrf: string) => request<{ ok: boolean }>('/api/push/visibility', { method: 'POST', body: JSON.stringify({ endpoint, visible }) }, csrf),
  subscribePush: (subscription: PushSubscriptionJSON, csrf: string) => request<{ ok: boolean }>('/api/push/subscription', { method: 'POST', body: JSON.stringify(subscription) }, csrf),
  unsubscribePush: (csrf: string) => request<{ ok: boolean }>('/api/push/subscription', { method: 'DELETE', body: '{}' }, csrf),
  session: async (signal?: AbortSignal) => {
    const intent = secureIntent(false)
    await ensurePreviewMigrationReady(true); intent.assert()
    return request<Session>('/api/session', { signal })
  },
  login: async (password: string) => {
    const intent = secureIntent(false)
    await ensurePreviewMigrationReady(true); intent.assert()
    return request<Session>('/api/session/login', { method: 'POST', body: JSON.stringify({ password }) })
  },
  logout: (csrf: string) => request<{ ok: boolean }>('/api/session/logout', { method: 'POST', body: '{}' }, csrf),
  threads: () => request<ThreadList>('/api/threads'),
  conversationGroups: () => request<GroupSnapshot>('/api/conversation-groups'),
  setLeader: (id: string, threadId: string | null, csrf: string) => request<GroupSnapshot>(`/api/conversation-groups/${encodeURIComponent(id)}/leader`, {
    method: 'PUT', body: JSON.stringify({ threadId }),
  }, csrf),
  team: (id: string, signal?: AbortSignal) => request<TeamSnapshot>(`/api/threads/${encodeURIComponent(id)}/orchestration`, { signal }),
  teamAction: (id: string, body: { action: 'release' | 'cancel'; taskId?: string }, csrf: string) => request<TeamSnapshot>(`/api/threads/${encodeURIComponent(id)}/orchestration`, {
    method: 'POST', body: JSON.stringify(body),
  }, csrf),
  createConversationGroup: (name: string, csrf: string) => request<GroupSnapshot>('/api/conversation-groups', {
    method: 'POST', body: JSON.stringify({ name }),
  }, csrf),
  renameConversationGroup: (id: string, name: string, csrf: string) => request<GroupSnapshot>(`/api/conversation-groups/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify({ name }),
  }, csrf),
  deleteConversationGroup: (id: string, csrf: string) => request<GroupSnapshot>(`/api/conversation-groups/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }, csrf),
  moveConversation: (id: string, groupId: string | null, csrf: string) => request<GroupSnapshot>(`/api/threads/${encodeURIComponent(id)}/group`, {
    method: 'PUT', body: JSON.stringify({ groupId }),
  }, csrf),
  readState: (signal?: AbortSignal) => request<ReplySnapshot>('/api/read-state', { signal }),
  acknowledgeReplies: (id: string, ids: string[], csrf: string, signal?: AbortSignal) => request<ReplySnapshot>(`/api/threads/${encodeURIComponent(id)}/read-state`, {
    method: 'POST', body: JSON.stringify({ ids }), signal,
  }, csrf),
  workspaceSkills: (workspaceId: string, refresh = false, signal?: AbortSignal) => request<SkillList>(`/api/workspace-skills?workspaceId=${encodeURIComponent(workspaceId)}${refresh ? '&refresh=1' : ''}`, { signal }),
  skills: (id: string, refresh = false, signal?: AbortSignal) => request<SkillList>(`/api/threads/${encodeURIComponent(id)}/skills${refresh ? '?refresh=1' : ''}`, { signal }),
  messageIds: (id: string, signal?: AbortSignal, before?: string) => request<{ ids: string[]; nextCursor?: string | null }>(`/api/threads/${encodeURIComponent(id)}/message-ids${before ? '?before=' + encodeURIComponent(before) : ''}`, { signal }),
  thread: (id: string, signal?: AbortSignal) => request<ThreadResponse>(`/api/threads/${encodeURIComponent(id)}/history`, { signal }).then(response => {
    if (response?.thread?.id !== id) throw new ApiError(502, 'Conversation response was incomplete or mismatched. Please retry.')
    return { ...response, thread: limitConversation(response.thread) }
  }),
  cachedHistory: async (id: string, before?: string): Promise<ThreadResponse | null> => {
    const path = `/api/threads/${encodeURIComponent(id)}/history${before ? '?before=' + encodeURIComponent(before) : ''}`
    const intent = secureIntent(); intent.assert()
    const response = await cachedHistoryResponse(path); intent.assert()
    if (!response) return null
    const result = await response.json(); intent.assert()
    return result?.thread?.id === id && result.thread.historyWindow && Array.isArray(result.thread.turns) ? result : null
  },
  olderHistory: (id: string, before: string, signal?: AbortSignal) => request<ThreadResponse>(`/api/threads/${encodeURIComponent(id)}/history?before=${encodeURIComponent(before)}`, { signal }),
  historyDetail: (id: string, cursor: string, offset = 0, signal?: AbortSignal) => request<{ text: string; offset: number; next: number | null }>(`/api/threads/${encodeURIComponent(id)}/history-detail?${new URLSearchParams({ cursor, offset: String(offset) })}`, { signal }),
  createThread: (workspaceId: string, csrf: string, fullAccess = false, groupId?: string) => request<ThreadResponse>('/api/threads', {
    method: 'POST',
    body: JSON.stringify({ workspaceId, fullAccess, ...(groupId ? { groupId } : {}) }),
  }, csrf),
  resumeThread: (id: string, csrf: string) => request<ThreadResponse>(`/api/threads/${encodeURIComponent(id)}/resume`, {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    body: '{}',
  }, csrf),
  archiveThread: (id: string, csrf: string) => request<Record<string, unknown>>(`/api/threads/${encodeURIComponent(id)}/archive`, {
    method: 'POST',
    body: '{}',
  }, csrf),
  renameThread: (id: string, name: string, csrf: string) => request<{ name: string }>(`/api/threads/${encodeURIComponent(id)}/name`, {
    method: 'POST',
    body: JSON.stringify({ name }),
    signal: AbortSignal.timeout(15_000),
  }, csrf),
  startTurn: (id: string, text: string, csrf: string, options: { collaborationMode?: 'default' | 'plan'; model?: string; effort?: string; fullAccess?: boolean; attachmentIds?: string[]; skills?: SkillSelection[] } = {}) => request<TurnResponse>(`/api/threads/${encodeURIComponent(id)}/turns`, {
    method: 'POST',
    body: JSON.stringify({ text, ...options }),
  }, csrf),
  interrupt: (id: string, turnId: string, csrf: string, signal?: AbortSignal) => request<Record<string, unknown>>(`/api/threads/${encodeURIComponent(id)}/interrupt`, {
    method: 'POST',
    signal,
    body: JSON.stringify({ turnId }),
  }, csrf),
  pending: () => request<PendingSnapshot>('/api/pending'),
  models: () => request<ModelList>('/api/models'),
  rateLimits: () => request<RateLimitsResponse>('/api/account/rate-limits'),
  respond: (key: string, body: Record<string, unknown>, csrf: string) => request<{ ok: boolean }>(`/api/requests/${encodeURIComponent(key)}/respond`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, csrf),
}
