import type { RateLimitBucket, RateLimitsResponse, RateLimitWindow, RemoteEvent, Thread, ThreadItem } from './types'

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function threadTitle(thread: Thread): string {
  const explicit = thread.name?.trim()
  if (explicit) return explicit
  const preview = thread.preview?.trim()
  if (preview) return preview.length > 72 ? `${preview.slice(0, 69)}…` : preview
  return 'New conversation'
}

export function filterThreads(threads: Thread[], query: string): Thread[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return threads

  return threads.filter((thread) => [
    threadTitle(thread),
    thread.cwd,
    thread.model ?? '',
  ].some((value) => value.toLocaleLowerCase().includes(normalized)))
}

export function shortWorkspace(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path
}

export function formatTime(epochSeconds: number | undefined): string {
  if (!epochSeconds || !Number.isFinite(epochSeconds)) return ''
  const date = new Date(epochSeconds * 1_000)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function eventThreadId(event: RemoteEvent): string | null {
  const payload = object(event.payload)
  const params = object(payload.params ?? payload)
  const direct = params.threadId
  if (typeof direct === 'string') return direct
  const thread = object(params.thread)
  if (typeof thread.id === 'string') return thread.id
  const turn = object(params.turn)
  if (typeof turn.threadId === 'string') return turn.threadId
  return null
}

export function eventTurnId(event: RemoteEvent): string | null {
  const payload = object(event.payload)
  const params = object(payload.params ?? payload)
  if (typeof params.turnId === 'string') return params.turnId
  const turn = object(params.turn)
  return typeof turn.id === 'string' ? turn.id : null
}

export function eventMethod(event: RemoteEvent): string {
  const payload = object(event.payload)
  if (event.type === 'codex' && typeof payload.method === 'string') return payload.method
  if (event.type === 'request' && typeof payload.method === 'string') return payload.method
  return event.type
}

export type OutputEventCategory = 'agent' | 'commands' | 'requests' | 'system'

export type CompactOutputEvent = {
  id: number
  at: string
  method: string
  preview: string
  count: number
  category: OutputEventCategory
  events: RemoteEvent[]
}

export function eventPreview(event: RemoteEvent): string {
  const payload = object(event.payload)
  const params = object(payload.params ?? payload)
  if (typeof params.delta === 'string') return params.delta
  if (typeof params.line === 'string') return params.line
  if (typeof params.message === 'string') return params.message
  if (typeof params.command === 'string') return params.command
  if (Array.isArray(params.command)) return params.command.join(' ')
  if (typeof params.reason === 'string') return params.reason
  const item = object(params.item)
  if (typeof item.text === 'string') return item.text
  if (typeof item.aggregatedOutput === 'string') return item.aggregatedOutput
  if (typeof item.command === 'string') return item.command
  if (Array.isArray(item.command)) return item.command.join(' ')
  return ''
}

export function outputEventCategory(event: RemoteEvent): OutputEventCategory {
  const method = eventMethod(event).toLocaleLowerCase()
  if (event.type === 'request' || event.type === 'request-resolved' || method.includes('requestapproval') || method.includes('requestuserinput')) return 'requests'
  if (method.includes('commandexecution') || method.includes('filechange') || method.includes('toolcall')) return 'commands'
  if (method.includes('agentmessage') || method.includes('reasoning') || method.includes('/plan')) return 'agent'
  return 'system'
}

export function compactOutputEvents(events: RemoteEvent[]): CompactOutputEvent[] {
  const compacted: CompactOutputEvent[] = []
  for (const event of events) {
    const method = eventMethod(event)
    const preview = eventPreview(event)
    const previous = compacted.at(-1)
    const isDelta = method.toLocaleLowerCase().includes('delta')
    if (previous && isDelta && previous.method === method) {
      previous.preview += preview
      previous.count += 1
      previous.at = event.at
      previous.events.push(event)
      continue
    }
    compacted.push({
      id: event.id,
      at: event.at,
      method,
      preview,
      count: 1,
      category: outputEventCategory(event),
      events: [event],
    })
  }
  return compacted
}

export function itemText(item: ThreadItem): string {
  if (typeof item.text === 'string') return item.text
  if (typeof item.aggregatedOutput === 'string') return item.aggregatedOutput
  if (Array.isArray(item.content)) {
    return item.content.map((entry) => {
      const value = object(entry)
      return typeof value.text === 'string' ? value.text : ''
    }).filter(Boolean).join('\n')
  }
  if (Array.isArray(item.summary)) {
    return item.summary.map((entry) => {
      const value = object(entry)
      return typeof value.text === 'string' ? value.text : String(entry)
    }).join('\n')
  }
  return ''
}

export function commandText(item: ThreadItem): string {
  if (typeof item.command === 'string') return item.command
  if (Array.isArray(item.command)) return item.command.join(' ')
  return ''
}

export function commandSummary(command: string, maxLength = 88): string {
  const compact = command.replace(/\s+/g, ' ').trim()
  if (compact.length <= maxLength) return compact
  return `${compact.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
}

function formatWindowDuration(minutes: number): string {
  if (minutes >= 1_440 && minutes % 1_440 === 0) return `${minutes / 1_440}d window`
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}h window`
  return `${minutes}m window`
}

function rateWindowValue(window: RateLimitWindow, formatReset: (epochSeconds: number) => string): string {
  const used = typeof window.usedPercent === 'number' ? Math.max(0, Math.min(100, window.usedPercent)) : null
  const parts = used === null
    ? ['Usage unavailable']
    : [`${Math.round(used)}% used`, `${Math.round(100 - used)}% left`]
  if (typeof window.windowDurationMins === 'number') parts.push(formatWindowDuration(window.windowDurationMins))
  if (typeof window.resetsAt === 'number') parts.push(`resets ${formatReset(window.resetsAt)}`)
  return parts.join(' · ')
}

export function rateLimitLines(
  response: RateLimitsResponse,
  formatReset: (epochSeconds: number) => string = (epochSeconds) => new Date(epochSeconds * 1_000).toLocaleString(),
): Array<{ label: string; value: string }> {
  const byId = response.rateLimitsByLimitId && Object.keys(response.rateLimitsByLimitId).length > 0
    ? Object.entries(response.rateLimitsByLimitId)
    : response.rateLimits
      ? [[response.rateLimits.limitId || 'usage', response.rateLimits] as [string, RateLimitBucket]]
      : []
  const lines: Array<{ label: string; value: string }> = []

  for (const [id, bucket] of byId) {
    const label = bucket.limitName || bucket.limitId || id
    if (bucket.primary) lines.push({ label, value: rateWindowValue(bucket.primary, formatReset) })
    if (bucket.secondary) lines.push({ label: `${label} secondary`, value: rateWindowValue(bucket.secondary, formatReset) })
    if (bucket.rateLimitReachedType) lines.push({ label: `${label} limit`, value: bucket.rateLimitReachedType })
  }

  const resetCredits = response.rateLimitResetCredits?.availableCount
  if (typeof resetCredits === 'number') lines.push({ label: 'Reset credits', value: String(resetCredits) })
  return lines.length > 0 ? lines : [{ label: 'Usage limits', value: 'Unavailable for this account' }]
}

export function itemLabel(item: ThreadItem): string {
  switch (item.type) {
    case 'userMessage': return 'You'
    case 'agentMessage': return 'Codex'
    case 'commandExecution': return 'Command'
    case 'fileChange': return 'File changes'
    case 'reasoning': return 'Reasoning summary'
    case 'plan': return 'Plan'
    case 'mcpToolCall': return 'Tool call'
    case 'webSearch': return 'Web search'
    default: return String(item.type ?? 'Event')
  }
}

export function isConversationItem(item: ThreadItem): boolean {
  return ['userMessage', 'agentMessage', 'plan'].includes(String(item.type))
}
