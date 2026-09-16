export type Workspace = {
  id: string
  label: string
  path: string
}

export type Session = {
  csrf: string
  expiresAt: number
  workspaces: Workspace[]
}

export type ThreadItem = Record<string, unknown> & {
  id?: string
  type?: string
}

export type Turn = {
  id: string
  status: string
  items: ThreadItem[]
  startedAt?: number | null
  completedAt?: number | null
}

export type Thread = {
  id: string
  name?: string | null
  preview?: string
  cwd: string
  createdAt: number
  updatedAt: number
  status: unknown
  model?: string | null
  turns?: Turn[]
  historyUnavailable?: boolean
  historyCacheTruncated?: boolean
  historyTruncation?: 'head' | 'tail'
  latestTurn?: { id: string; status: string }
}

export type ThreadList = {
  data: Thread[]
  nextCursor?: string | null
}

export type ThreadResponse = {
  thread: Thread
}

export type TurnResponse = {
  turn: Turn
}

export type ReasoningEffort = {
  reasoningEffort: string
  description?: string
}

export type ModelOption = {
  id: string
  model: string
  displayName?: string
  defaultReasoningEffort?: string
  supportedReasoningEfforts?: ReasoningEffort[]
  inputModalities?: string[]
  isDefault?: boolean
}

export type ModelList = {
  data: ModelOption[]
  nextCursor?: string | null
}

export type DirectoryListing = {
  path: string
  parentPath: string | null
  entries: Array<{ name: string; path: string; kind: 'directory' | 'file' | 'unavailable'; symlink: boolean; size: number | null; modifiedAt: string | null }>
  total: number
  offset: number
  limit: number
}

export type ServerFileInfo = {
  path: string
  name: string
  size: number
  extension: string
  contentType: string
  kind: 'text' | 'image' | 'pdf' | 'docx' | 'pptx' | 'download'
  previewable: boolean
  createdAt: string
  modifiedAt: string
}

export type RateLimitWindow = {
  usedPercent?: number | null
  windowDurationMins?: number | null
  resetsAt?: number | null
}

export type RateLimitBucket = {
  limitId?: string | null
  limitName?: string | null
  primary?: RateLimitWindow | null
  secondary?: RateLimitWindow | null
  rateLimitReachedType?: string | null
  planType?: string | null
}

export type RateLimitsResponse = {
  rateLimits?: RateLimitBucket | null
  rateLimitsByLimitId?: Record<string, RateLimitBucket> | null
  rateLimitResetCredits?: { availableCount?: number | null } | null
}

export type PendingRequest = {
  key: string
  method: string
  params: Record<string, unknown>
  createdAt: string
}

export type RemoteEvent = {
  id: number
  at: string
  type: 'codex' | 'request' | 'request-resolved' | 'server-log' | 'state'
  payload: Record<string, unknown>
  replayed?: boolean
}

export type PwaInstallPrompt = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}
