import { limitConversation } from '../server/conversation-size'
import type { ModelList, PendingRequest, RateLimitsResponse, Session, ThreadList, ThreadResponse, TurnResponse } from './types'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}, csrf?: string): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (csrf && !['GET', 'HEAD'].includes(init.method ?? 'GET')) headers.set('X-CSRF-Token', csrf)
  const signal = init.signal ?? (['GET', 'HEAD'].includes(init.method ?? 'GET') ? AbortSignal.timeout(10_000) : undefined)
  const response = await fetch(path, { ...init, signal, headers, credentials: 'same-origin' })
  const body = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new ApiError(response.status, body.error ?? `Request failed (${response.status})`)
  return body as T
}

export const api = {
  uploadAttachment: (file: File, csrf: string) => request<{ id: string; size: number; contentType: string }>('/api/attachments', {
    method: 'POST',
    headers: { 'Content-Type': file.type },
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
  session: (signal?: AbortSignal) => request<Session>('/api/session', { signal }),
  login: (password: string) => request<Session>('/api/session/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  }),
  logout: (csrf: string) => request<{ ok: boolean }>('/api/session/logout', { method: 'POST', body: '{}' }, csrf),
  threads: () => request<ThreadList>('/api/threads'),
  thread: (id: string, signal?: AbortSignal) => request<ThreadResponse>(`/api/threads/${encodeURIComponent(id)}`, { signal }).then(response => ({ ...response, thread: limitConversation(response.thread) })),
  createThread: (workspaceId: string, csrf: string, fullAccess = false) => request<ThreadResponse>('/api/threads', {
    method: 'POST',
    body: JSON.stringify({ workspaceId, fullAccess }),
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
  startTurn: (id: string, text: string, csrf: string, options: { model?: string; effort?: string; fullAccess?: boolean; attachmentIds?: string[] } = {}) => request<TurnResponse>(`/api/threads/${encodeURIComponent(id)}/turns`, {
    method: 'POST',
    body: JSON.stringify({ text, ...options }),
  }, csrf),
  interrupt: (id: string, turnId: string, csrf: string, signal?: AbortSignal) => request<Record<string, unknown>>(`/api/threads/${encodeURIComponent(id)}/interrupt`, {
    method: 'POST',
    signal,
    body: JSON.stringify({ turnId }),
  }, csrf),
  pending: () => request<{ data: PendingRequest[] }>('/api/pending'),
  models: () => request<ModelList>('/api/models'),
  rateLimits: () => request<RateLimitsResponse>('/api/account/rate-limits'),
  respond: (key: string, body: Record<string, unknown>, csrf: string) => request<{ ok: boolean }>(`/api/requests/${encodeURIComponent(key)}/respond`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, csrf),
}
