import { ChangeEvent, Fragment, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { conversationItems, updateTranscript, type TranscriptItem } from './transcript'
import { api, ApiError } from './api'
import { useYoloPreference } from './useYoloPreference'
import { enablePush, disablePush, restorePush } from './push'
import { MarkdownMessage } from './MarkdownMessage'
import { EventAssembler, shouldKeepEventStream } from './eventStream'
import { TranscriptViewport, type ReadingPosition } from './TranscriptViewport'
import { matchingSlashCommands, parseSlashCommand, slashCommands } from './slashCommands'
import { clearConversationSnapshot, loadConversationSnapshot, saveConversationSnapshot } from './deviceCache'
import {
  commandText,
  commandSummary,
  compactOutputEvents,
  eventMethod,
  eventThreadId,
  filterThreads,
  formatTime,
  itemLabel,
  itemText,
  rateLimitLines,
  shortWorkspace,
  threadTitle,
} from './model'
import type { ModelOption, PendingRequest, PwaInstallPrompt, RemoteEvent, Session, Thread, ThreadItem } from './types'

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}

const NOTIFICATION_PREFERENCE = 'codex-remote:completion-notifications'
const MAX_COMPOSER_IMAGES = 4
const MAX_COMPOSER_IMAGE_BYTES = 10 * 1024 * 1024

type ComposerImage = { key: string; file: File; previewUrl: string }
type SentMessage = { text: string; turnId?: string; images?: Array<{ name: string; previewUrl: string }> }

function savedNotificationPreference(): boolean {
  try {
    return 'Notification' in window && Notification.permission === 'granted' && localStorage.getItem(NOTIFICATION_PREFERENCE) === 'enabled'
  } catch {
    return false
  }
}

function Login({ installPrompt, offline, onInstall, onLogin }: {
  installPrompt: PwaInstallPrompt | null
  offline: boolean
  onInstall: () => void
  onLogin: (session: Session) => void
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      onLogin(await api.login(password))
      setPassword('')
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">&gt;_</div>
          <div>
            <p className="eyebrow">Secure remote access</p>
            <p className="brand-name">Codex</p>
          </div>
        </div>
        <h1>Your agent,<br />within reach.</h1>
        <p className="muted">Continue local Codex conversations securely from this device.</p>
        {offline && <p className="offline-banner" role="status">You’re offline. Reconnect to unlock your workspace.</p>}
        <form onSubmit={submit} className="login-form">
          <label htmlFor="password">Access password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            autoFocus
            minLength={16}
            required
          />
          {error && <p className="error-banner" role="alert">{error}</p>}
          <button className="primary-button login-button" disabled={busy || offline} type="submit">
            {busy ? 'Connecting…' : 'Open Codex Remote'}
          </button>
        </form>
        {installPrompt && <button className="install-link" type="button" onClick={onInstall}>＋ Install on this device</button>}
        <p className="security-note"><span aria-hidden="true">●</span> Credentials never leave your host machine</p>
      </section>
    </main>
  )
}

function ThreadSidebar({
  threads,
  selectedId,
  open,
  busy,
  onClose,
  onCreate,
  onRefresh,
  onSelect,
  workspaceLabel,
}: {
  threads: Thread[]
  selectedId: string | null
  open: boolean
  busy: boolean
  onClose: () => void
  onCreate: () => void
  onRefresh: () => void
  onSelect: (thread: Thread) => void
  workspaceLabel: string
}) {
  const [query, setQuery] = useState('')
  const visibleThreads = useMemo(() => filterThreads(threads, query), [threads, query])

  return (
    <>
      {open && <button className="drawer-scrim" aria-label="Close conversations" onClick={onClose} />}
      <aside className={`thread-sidebar ${open ? 'is-open' : ''}`}>
        <div className="sidebar-heading">
          <div className="sidebar-brand">
            <span className="mini-brand" aria-hidden="true">&gt;_</span>
            <div>
              <p className="eyebrow">Codex Remote</p>
              <h2>{workspaceLabel}</h2>
            </div>
          </div>
          <button className="icon-button mobile-only" onClick={onClose} aria-label="Close">×</button>
        </div>
        <button className="primary-button new-thread-button" onClick={onCreate} disabled={busy}>＋ New conversation</button>
        <label className="thread-search">
          <span className="sr-only">Search conversations</span>
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search conversations"
          />
        </label>
        <div className="thread-list" aria-label="Conversation list">
          {threads.length === 0 && <p className="empty-copy">No conversations in this workspace yet.</p>}
          {threads.length > 0 && visibleThreads.length === 0 && <p className="empty-copy">No conversations match “{query}”.</p>}
          {visibleThreads.map((thread) => (
            <button
              key={thread.id}
              className={`thread-row ${selectedId === thread.id ? 'is-selected' : ''}`}
              onClick={() => onSelect(thread)}
            >
              <span className="thread-row-title">{threadTitle(thread)}</span>
              <span className="thread-row-meta">
                {shortWorkspace(thread.cwd)} · {formatTime(thread.updatedAt)}
              </span>
            </button>
          ))}
        </div>
        <button className="quiet-button sidebar-refresh" onClick={onRefresh} disabled={busy}>↻ Refresh list</button>
      </aside>
    </>
  )
}

function JsonDetails({ value, label = 'Raw data' }: { value: unknown; label?: string }) {
  return (
    <details className="json-details">
      <summary>{label}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  )
}

function HistoryItem({ item }: { item: ThreadItem }) {
  const text = itemText(item)
  const command = commandText(item)
  const changes = Array.isArray(item.changes) ? item.changes : []
  const conversational = item.type === 'userMessage' || item.type === 'agentMessage'
  const attachmentPreviews = Array.isArray(item.attachmentPreviews)
    ? item.attachmentPreviews.filter((entry): entry is { name: string; previewUrl: string } => Boolean(entry)
      && typeof (entry as { name?: unknown }).name === 'string'
      && typeof (entry as { previewUrl?: unknown }).previewUrl === 'string')
    : []
  const imageCount = Array.isArray(item.content)
    ? item.content.filter(entry => ['image', 'localImage'].includes(String(object(entry).type ?? ''))).length
    : 0

  if (conversational) {
    return (
      <article className={`message ${item.type === 'userMessage' ? 'message-user' : 'message-agent'}`}>
        <span className="message-author">{itemLabel(item)}</span>
        {text && <MarkdownMessage streaming={item.type === 'agentMessage' && item.streaming === true}>{text}</MarkdownMessage>}
        {attachmentPreviews.length > 0 && <div className="message-images">
          {attachmentPreviews.map(image => <img src={image.previewUrl} alt={image.name} key={image.previewUrl} />)}
        </div>}
        {attachmentPreviews.length === 0 && imageCount > 0 && <span className="image-attachment-label">▧ {imageCount} image{imageCount === 1 ? '' : 's'} attached</span>}
      </article>
    )
  }

  const preview = commandSummary(command || text || changes.map((change) => String(object(change).path ?? '')).filter(Boolean).join(', ') || 'View details')
  const status = typeof item.status === 'string' && item.status !== 'completed' ? item.status : null

  return (
    <details className="activity-card">
      <summary>
        <span className="activity-icon" aria-hidden="true">{item.type === 'commandExecution' ? '$' : item.type === 'fileChange' ? '±' : '·'}</span>
        <span className="activity-summary"><strong>{itemLabel(item)}</strong><small>{preview}</small></span>
        {status && <span className={`status-pill status-${status}`}>{status}</span>}
        <span className="details-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div className="activity-body">
        {command && <pre className="command-block"><code>$ {command}</code></pre>}
        {text && <pre className="output-block">{text}</pre>}
        {changes.map((change, index) => {
          const value = object(change)
          return (
            <section className="diff-block" key={`${String(value.path)}-${index}`}>
              <strong>{String(value.path ?? 'Changed file')}</strong>
              {typeof value.diff === 'string' && <pre>{value.diff}</pre>}
            </section>
          )
        })}
        <JsonDetails value={item} />
      </div>
    </details>
  )
}

const starterPrompts = [
  'Summarize the current repository state',
  'Find the most important issue to fix next',
  'Review the latest changes',
]

export function Conversation({ thread, activeTurnId, items, pendingMessage, yoloMode, onSuggestion }: {
  thread: Thread
  activeTurnId: string | null
  items: TranscriptItem[]
  pendingMessage?: SentMessage
  yoloMode: boolean
  onSuggestion: (prompt: string) => void
}) {
  const rows = conversationItems(thread, items)
  const pendingMatch = pendingMessage ? rows.findIndex(item => item.type === 'userMessage'
    && Boolean(pendingMessage.turnId) && item.turnId === pendingMessage.turnId
    && itemText(item) === pendingMessage.text) : -1
  const showPending = Boolean(pendingMessage) && pendingMatch < 0
  const pendingItem = pendingMessage ? {
    type: 'userMessage',
    text: pendingMessage.text,
    attachmentPreviews: pendingMessage.images ?? [],
  } : null
  return (
    <section className={`conversation-stream${rows.length === 0 && !pendingMessage && !activeTurnId ? ' is-empty' : ''}`} aria-live="polite">
      {rows.length === 0 && !pendingMessage && !activeTurnId && (
        <div className="empty-state">
          <h2>What should Codex work on?</h2>
          <p>Working in <strong>{shortWorkspace(thread.cwd)}</strong>. {yoloMode ? 'Workspace sandbox on; approval prompts off.' : 'Changes stay sandboxed and approval-gated.'}</p>
          <div className="starter-prompts">
            {starterPrompts.map(prompt => <button className="starter-prompt" key={prompt} onClick={() => onSuggestion(prompt)}>{prompt}</button>)}
          </div>
        </div>
      )}
      {rows.map((item, index) => (
        <Fragment key={item.id ? `${item.turnId}-${item.id}` : `${item.turnId}-${index}`}>
          {showPending && pendingMessage?.turnId === item.turnId && (index === 0 || rows[index - 1].turnId !== item.turnId) &&
            <HistoryItem item={pendingItem!} />}
          <HistoryItem item={index === pendingMatch ? pendingItem! : item} />
        </Fragment>
      ))}
      {showPending && !rows.some(item => item.turnId === pendingMessage?.turnId) &&
        <HistoryItem item={pendingItem!} />}
      {(activeTurnId || (showPending && !pendingMessage?.turnId)) &&
        <div className="working-line"><span className="pulse-dot" />{activeTurnId ? 'Codex is working' : 'Sending…'}</div>}
    </section>
  )
}

function OutputFeed({ events }: { events: RemoteEvent[] }) {
  const [filter, setFilter] = useState<'all' | 'agent' | 'commands' | 'requests' | 'system'>('all')
  const [query, setQuery] = useState('')
  const rows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return compactOutputEvents(events).filter((entry) => {
      if (filter !== 'all' && entry.category !== filter) return false
      return !normalized || `${entry.method} ${entry.preview}`.toLocaleLowerCase().includes(normalized)
    })
  }, [events, filter, query])

  return (
    <section className="output-view">
      <div className="output-toolbar">
        <label className="output-search"><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find output" aria-label="Find output" /></label>
        <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} aria-label="Filter output">
          <option value="all">All types</option>
          <option value="agent">Agent</option>
          <option value="commands">Commands</option>
          <option value="requests">Requests</option>
          <option value="system">System</option>
        </select>
        <span className="output-count">{rows.length} rows · {events.length} events</span>
      </div>
      <div className="event-feed">
        {events.length === 0 && <p className="empty-copy">Live output will appear here.</p>}
        {events.length > 0 && rows.length === 0 && <p className="empty-copy">No output matches this filter.</p>}
        {rows.map((entry) => (
          <details className={`event-row event-${entry.category}`} key={`${entry.method}-${entry.id}`}>
            <summary>
              <time>{new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
              <code>{entry.method}</code>
              <span className="event-preview">{commandSummary(entry.preview || 'No text payload', 120)}</span>
              {entry.count > 1 && <span className="event-count">{entry.count}×</span>}
              <span className="details-chevron" aria-hidden="true">⌄</span>
            </summary>
            <div className="event-body">
              {entry.preview && <pre>{entry.preview}</pre>}
              <JsonDetails value={entry.events.map((event) => event.payload)} label={entry.count > 1 ? `${entry.count} complete events` : 'Complete event'} />
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}

function RequestCard({ request, csrf, onResolved }: {
  request: PendingRequest
  csrf: string
  onResolved: (key: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})

  async function respond(body: Record<string, unknown>) {
    setBusy(true)
    setError('')
    try {
      await api.respond(request.key, body, csrf)
      onResolved(request.key)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  const isApproval = request.method === 'item/commandExecution/requestApproval' || request.method === 'item/fileChange/requestApproval'
  const isPermissions = request.method === 'item/permissions/requestApproval'
  const isUserInput = request.method === 'item/tool/requestUserInput'
  const questions = Array.isArray(request.params.questions) ? request.params.questions.map(object) : []

  return (
    <article className="request-card">
      <div className="request-kicker">Action needed</div>
      <h3>{request.method === 'item/commandExecution/requestApproval' ? 'Approve command?' : request.method === 'item/fileChange/requestApproval' ? 'Approve file changes?' : request.method === 'item/tool/requestUserInput' ? 'Codex has a question' : request.method === 'item/permissions/requestApproval' ? 'Grant additional permissions?' : 'Codex needs input'}</h3>
      {typeof request.params.reason === 'string' && <p>{request.params.reason}</p>}
      {typeof request.params.command === 'string' && <pre className="command-block"><code>$ {request.params.command}</code></pre>}
      {typeof request.params.cwd === 'string' && <p className="request-path">in {request.params.cwd}</p>}

      {isUserInput && questions.map((question) => {
        const id = String(question.id)
        const options = Array.isArray(question.options) ? question.options.map(object) : []
        return (
          <label className="question-field" key={id}>
            <span>{String(question.question ?? question.header ?? 'Your answer')}</span>
            {options.length > 0 ? (
              <select value={answers[id] ?? ''} onChange={(event) => setAnswers((current) => ({ ...current, [id]: event.target.value }))}>
                <option value="">Choose an answer</option>
                {options.map((option) => <option key={String(option.label)} value={String(option.label)}>{String(option.label)}</option>)}
              </select>
            ) : (
              <input value={answers[id] ?? ''} onChange={(event) => setAnswers((current) => ({ ...current, [id]: event.target.value }))} />
            )}
          </label>
        )
      })}

      {error && <p className="error-banner" role="alert">{error}</p>}
      <div className="request-actions">
        {isApproval && (
          <>
            <button className="danger-button" disabled={busy} onClick={() => void respond({ decision: 'decline' })}>Decline</button>
            <button className="quiet-button" disabled={busy} onClick={() => void respond({ decision: 'accept' })}>Allow once</button>
            <button className="primary-button" disabled={busy} onClick={() => void respond({ decision: 'acceptForSession' })}>Allow session</button>
          </>
        )}
        {isPermissions && (
          <>
            <button className="danger-button" disabled={busy} onClick={() => void respond({ decision: 'decline' })}>Decline</button>
            <button className="quiet-button" disabled={busy} onClick={() => void respond({ decision: 'accept', scope: 'turn' })}>Allow this turn</button>
            <button className="primary-button" disabled={busy} onClick={() => void respond({ decision: 'accept', scope: 'session' })}>Allow session</button>
          </>
        )}
        {isUserInput && (
          <button
            className="primary-button"
            disabled={busy || questions.some((question) => !answers[String(question.id)]?.trim())}
            onClick={() => void respond({ answers: Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, { answers: [value] }])) })}
          >Send answer</button>
        )}
        {!isApproval && !isPermissions && !isUserInput && (
          <button className="danger-button" disabled={busy} onClick={() => void respond({ action: 'cancel' })}>Cancel request</button>
        )}
      </div>
      <JsonDetails value={request.params} label="Request details" />
    </article>
  )
}

type SlashOption = {
  key: string
  label: string
  description: string
  fill: string
  badge?: string
}

type CommandNotice = {
  title: string
  lines: Array<{ label: string; value: string }>
}

function SlashMenu({ activeIndex, options, onChoose }: {
  activeIndex: number
  options: SlashOption[]
  onChoose: (option: SlashOption) => void
}) {
  if (options.length === 0) return null
  return (
    <div className="slash-menu" id="slash-command-menu" role="listbox" aria-label="Slash commands">
      <div className="slash-menu-heading"><span>Commands</span><span>↑↓ navigate · Enter select</span></div>
      <div className="slash-options">
        {options.map((option, index) => (
          <button
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            className={index === activeIndex ? 'is-active' : ''}
            key={option.key}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChoose(option)}
          >
            <span className="slash-option-copy"><strong>{option.label}</strong><small>{option.description}</small></span>
            {option.badge && <span className="slash-option-badge">{option.badge}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

function LocalCommandResult({ notice, onClose }: { notice: CommandNotice; onClose: () => void }) {
  return (
    <section className="local-command-result" aria-live="polite">
      <header><span><b aria-hidden="true">/</b>{notice.title}</span><button type="button" onClick={onClose} aria-label="Dismiss command result">×</button></header>
      <dl>
        {notice.lines.map((line) => <div key={`${line.label}-${line.value}`}><dt>{line.label}</dt><dd>{line.value}</dd></div>)}
      </dl>
    </section>
  )
}

export function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [threads, setThreads] = useState<Thread[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [thread, setThread] = useState<Thread | null>(null)
  const [events, setEvents] = useState<RemoteEvent[]>([])
  const [transcripts, setTranscripts] = useState<Record<string, TranscriptItem[]>>({})
  const [sentMessages, setSentMessages] = useState<Record<string, SentMessage>>({})
  const [attachments, setAttachments] = useState<ComposerImage[]>([])
  const [uploadStatus, setUploadStatus] = useState('')
  const [pending, setPending] = useState<PendingRequest[]>([])
  const [models, setModels] = useState<ModelOption[]>([])
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [selectedEffort, setSelectedEffort] = useState<string | null>(null)
  const [yoloMode, setYoloMode, yoloSaveError] = useYoloPreference()
  const [commandNotice, setCommandNotice] = useState<CommandNotice | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null)
  const [composer, setComposer] = useState('')
  const [tab, setTab] = useState<'conversation' | 'output'>('conversation')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [connected, setConnected] = useState(false)
  const [cacheReady, setCacheReady] = useState(false)
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== 'hidden')
  const [online, setOnline] = useState(() => navigator.onLine)
  const [installPrompt, setInstallPrompt] = useState<PwaInstallPrompt | null>(null)
  const [updateWorker, setUpdateWorker] = useState<ServiceWorker | null>(null)
  const [notificationsEnabled, setNotificationsEnabled] = useState(false)
  const [notificationBusy, setNotificationBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selectedRef = useRef<string | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const attachmentInputRef = useRef<HTMLInputElement | null>(null)
  const previewUrls = useRef(new Set<string>())
  const readingPositions = useRef(new Map<string, ReadingPosition>())
  const notificationOperation = useRef(false)
  const eventCursor = useRef(0)

  useEffect(() => () => {
    for (const url of previewUrls.current) URL.revokeObjectURL(url)
    previewUrls.current.clear()
  }, [])

  useEffect(() => {
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | undefined
    setNotificationsEnabled(false)
    if (!session) return
    const restore = async () => {
      if (cancelled) return
      if (notificationOperation.current) {
        clearTimeout(retry)
        retry = setTimeout(() => void restore(), 100)
        return
      }
      if (!savedNotificationPreference()) {
        setNotificationsEnabled(false)
        setNotificationBusy(false)
        return
      }
      notificationOperation.current = true
      setNotificationBusy(true)
      try {
        const enabled = await restorePush(session.csrf)
        if (!cancelled) setNotificationsEnabled(enabled)
      } catch (requestError) {
        if (!cancelled) {
          setNotificationsEnabled(false)
          setError(`Could not restore notifications: ${errorMessage(requestError)}`)
        }
      } finally {
        notificationOperation.current = false
        if (!cancelled) setNotificationBusy(false)
      }
    }
    queueMicrotask(() => { if (!cancelled) void restore() })
    window.addEventListener('focus', restore)
    window.addEventListener('online', restore)
    return () => {
      cancelled = true
      clearTimeout(retry)
      window.removeEventListener('focus', restore)
      window.removeEventListener('online', restore)
    }
  }, [session])

  useEffect(() => {
    api.session().then(setSession).catch((requestError) => {
      if (!(requestError instanceof ApiError) || requestError.status !== 401) setError(errorMessage(requestError))
    }).finally(() => setAuthLoading(false))
  }, [])

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as PwaInstallPrompt)
    }
    const handleInstalled = () => setInstallPrompt(null)
    const handleOnline = () => setOnline(true)
    const handleOffline = () => {
      setOnline(false)
      setConnected(false)
    }
    const handleUpdate = (event: Event) => {
      setUpdateWorker((event as CustomEvent<ServiceWorker>).detail)
    }

    window.addEventListener('beforeinstallprompt', handleInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('codex-remote:update-ready', handleUpdate)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('codex-remote:update-ready', handleUpdate)
    }
  }, [])

  useEffect(() => {
    const handleVisibility = () => setPageVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  const refreshThreads = useCallback(async () => {
    const response = await api.threads()
    setThreads(response.data)
    return response.data
  }, [])

  const openThread = useCallback(async (target: Thread, csrf = session?.csrf, preserveVisibleCache = false) => {
    if (!csrf) return
    setSelectedId(target.id)
    selectedRef.current = target.id
    setDrawerOpen(false)
    setError('')
    setCommandNotice(null)
    if (!preserveVisibleCache) setThread(null)
    const history = await api.thread(target.id)
    await api.resumeThread(target.id, csrf)
    setThread((current) => history.thread.historyUnavailable && preserveVisibleCache && current?.id === target.id
      ? { ...current, ...history.thread, turns: current.turns }
      : history.thread)
    setSelectedModel(history.thread.model ?? null)
    setSelectedEffort(null)
    if (!history.thread.historyUnavailable || !preserveVisibleCache) {
      const running = [...(history.thread.turns ?? [])].reverse().find((turn) => turn.status === 'inProgress')
      setActiveTurnId(running?.id ?? null)
    }
  }, [session?.csrf])

  useEffect(() => {
    if (!session) {
      setCacheReady(false)
      return
    }
    let cancelled = false
    void (async () => {
      const cached = await loadConversationSnapshot()
      if (cancelled) return
      if (cached) {
        setThreads(cached.threads)
        setSelectedId(cached.selectedId)
        selectedRef.current = cached.selectedId
        setThread(cached.thread)
        setTranscripts(cached.transcripts)
        setActiveTurnId(cached.activeTurnId)
        eventCursor.current = cached.lastEventId
      }
      setCacheReady(true)

      try {
        const [items, pendingResponse, modelResponse] = await Promise.all([refreshThreads(), api.pending(), api.models()])
        if (cancelled) return
        setPending(pendingResponse.data)
        setModels(modelResponse.data)
        const preferred = items.find((item) => item.id === cached?.selectedId) ?? items[0]
        if (preferred) await openThread(preferred, session.csrf, preferred.id === cached?.selectedId)
      } catch (requestError) {
        if (!cancelled) setError(errorMessage(requestError))
      }
    })()
    return () => { cancelled = true }
  }, [session, refreshThreads, openThread])

  useEffect(() => {
    if (!session || !cacheReady || (thread && thread.id !== selectedId)) return
    const timer = setTimeout(() => {
      void saveConversationSnapshot({
        threads,
        selectedId,
        thread,
        transcripts,
        activeTurnId,
        lastEventId: eventCursor.current,
      })
    }, 150)
    return () => clearTimeout(timer)
  }, [activeTurnId, cacheReady, selectedId, session, thread, threads, transcripts])

  const keepLive = shouldKeepEventStream(pageVisible, activeTurnId)

  useEffect(() => {
    if (!session || !keepLive) {
      setConnected(false)
      return
    }
    const source = new EventSource(`/api/events?after=${eventCursor.current}`)
    const assembler = new EventAssembler()
    source.onopen = () => {
      setConnected(true)
      if (document.visibilityState !== 'hidden') {
        void refreshThreads().catch(() => undefined)
        const id = selectedRef.current
        if (id) void api.thread(id).then((response) => setThread((current) => (
          response.thread.historyUnavailable && current?.id === id
            ? { ...current, ...response.thread, turns: current.turns }
            : response.thread
        ))).catch(() => undefined)
      }
    }
    source.onerror = () => { assembler.reset(); setConnected(false) }
    const receive = (data: string) => {
      let event: RemoteEvent
      try {
        event = JSON.parse(data) as RemoteEvent
      } catch {
        return
      }
      eventCursor.current = Math.max(eventCursor.current, event.id)
      setEvents((current) => [...current, event].slice(-600))

      if (event.type === 'request') {
        const incoming = event.payload as unknown as PendingRequest
        setPending((current) => current.some((item) => item.key === incoming.key) ? current : [...current, incoming])
      }
      if (event.type === 'request-resolved') {
        const key = String(object(event.payload).key ?? '')
        setPending((current) => current.filter((item) => item.key !== key))
      }

      const method = eventMethod(event)
      const params = object(object(event.payload).params)
      const eventThread = eventThreadId(event)
      if (eventThread) setTranscripts(current => ({ ...current, [eventThread]: updateTranscript(current[eventThread] ?? [], event) }))
      if (method === 'turn/started' && eventThread === selectedRef.current) {
        const turn = object(params.turn)
        if (typeof turn.id === 'string') setActiveTurnId(turn.id)
      }
      if (method === 'turn/completed') {
        if (eventThread) setSentMessages(current => {
          const sent = current[eventThread]
          if (!sent) return current
          for (const image of sent.images ?? []) {
            URL.revokeObjectURL(image.previewUrl)
            previewUrls.current.delete(image.previewUrl)
          }
          const next = { ...current }
          delete next[eventThread]
          return next
        })
        if (eventThread === selectedRef.current) {
          setActiveTurnId(null)
          setTimeout(() => {
            const id = selectedRef.current
            if (id) api.thread(id).then((response) => setThread((current) => (
              response.thread.historyUnavailable && current?.id === id
                ? { ...current, ...response.thread, turns: current.turns }
                : response.thread
            ))).catch(() => undefined)
          }, 150)
        }
        void refreshThreads().catch(() => undefined)
      }
      if (['thread/started', 'thread/archived', 'thread/name/updated'].includes(method)) {
        void refreshThreads().catch(() => undefined)
      }
    }
    source.onmessage = (message) => receive(message.data)
    source.addEventListener('fragment', (message) => {
      const data = assembler.accept((message as MessageEvent<string>).data)
      if (data !== null) receive(data)
    })
    return () => {
      source.close()
      setConnected(false)
    }
  }, [keepLive, session, refreshThreads])

  const selectedEvents = useMemo(() => events.filter((event) => {
    const id = eventThreadId(event)
    return id === null || id === selectedId
  }), [events, selectedId])
  const selectedPending = useMemo(() => pending.filter((request) => {
    const id = request.params.threadId
    return !selectedId || typeof id !== 'string' || id === selectedId
  }), [pending, selectedId])
  const effectiveModel = selectedModel ?? thread?.model ?? models.find((model) => model.isDefault)?.model ?? null
  const effectiveModelOption = models.find((model) => model.model === effectiveModel)
  const effortOptions = effectiveModelOption?.supportedReasoningEfforts ?? []
  const slashOptions = useMemo<SlashOption[]>(() => {
    const input = composer.trimStart()
    const modelMatch = input.match(/^\/model(?:\s+(.*))?$/i)
    if (modelMatch) {
      const query = (modelMatch[1] ?? '').toLocaleLowerCase()
      return models
        .filter((model) => [model.model, model.displayName ?? ''].some((value) => value.toLocaleLowerCase().includes(query)))
        .slice(0, 12)
        .map((model) => ({
          key: `model-${model.model}`,
          label: model.displayName || model.model,
          description: model.model,
          fill: `/model ${model.model}`,
          badge: model.isDefault ? 'Default' : undefined,
        }))
    }

    const effortMatch = input.match(/^\/effort(?:\s+(.*))?$/i)
    if (effortMatch) {
      const query = (effortMatch[1] ?? '').toLocaleLowerCase()
      return effortOptions
        .filter((entry) => entry.reasoningEffort.toLocaleLowerCase().includes(query))
        .map((entry) => ({
          key: `effort-${entry.reasoningEffort}`,
          label: entry.reasoningEffort,
          description: entry.description || `Use ${entry.reasoningEffort} reasoning effort`,
          fill: `/effort ${entry.reasoningEffort}`,
          badge: entry.reasoningEffort === effectiveModelOption?.defaultReasoningEffort ? 'Default' : undefined,
        }))
    }

    const yoloMatch = input.match(/^\/yolo(?:\s+(.*))?$/i)
    if (yoloMatch) {
      const query = (yoloMatch[1] ?? '').toLocaleLowerCase()
      return [
        { key: 'yolo-on', label: 'on', description: 'Disable approval prompts; keep workspace sandbox', fill: '/yolo on', badge: yoloMode ? 'Active' : undefined },
        { key: 'yolo-off', label: 'off', description: 'Restore approval prompts', fill: '/yolo off', badge: yoloMode ? undefined : 'Active' },
      ].filter((option) => option.label.startsWith(query))
    }

    return matchingSlashCommands(input).map((command) => ({
      key: `command-${command.name}`,
      label: command.usage,
      description: command.description,
      fill: command.takesArgument ? `/${command.name} ` : `/${command.name}`,
    }))
  }, [composer, effectiveModelOption?.defaultReasoningEffort, effortOptions, models, yoloMode])

  useEffect(() => setSlashIndex(0), [composer])

  useEffect(() => {
    const textarea = composerRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`
  }, [composer])

  async function createThread() {
    if (!session || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await api.createThread(session.workspaces[0]?.id ?? '0', session.csrf)
      await refreshThreads()
      await openThread(response.thread)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  function showCommandNotice(title: string, lines: CommandNotice['lines']) {
    setCommandNotice({ title, lines })
    setComposer('')
    setError('')
  }

  async function executeSlashCommand(name: string, argument: string) {
    switch (name) {
      case 'status': {
        const runtimeStatus = object(thread?.status).type
        setBusy(true)
        let usageLines: CommandNotice['lines']
        try {
          const limits = await api.rateLimits()
          usageLines = rateLimitLines(limits, (epochSeconds) => new Intl.DateTimeFormat(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(epochSeconds * 1_000)))
        } catch {
          usageLines = [{ label: 'Usage limits', value: 'Unavailable for this account' }]
        } finally {
          setBusy(false)
        }
        showCommandNotice('Remote status', [
          { label: 'Connection', value: !online ? 'Offline' : connected ? 'Live' : 'Reconnecting' },
          { label: 'Workspace', value: thread ? shortWorkspace(thread.cwd) : 'None' },
          { label: 'Model', value: effectiveModel || 'Server default' },
          { label: 'Effort', value: selectedEffort || effectiveModelOption?.defaultReasoningEffort || 'Model default' },
          { label: 'Thread', value: activeTurnId ? 'Working' : typeof runtimeStatus === 'string' ? runtimeStatus : 'Idle' },
          { label: 'Approvals', value: yoloMode ? 'Disabled (YOLO)' : `${selectedPending.length} pending` },
          { label: 'Buffered events', value: String(selectedEvents.length) },
          ...usageLines,
        ])
        return
      }
      case 'yolo': {
        if (!argument) {
          setComposer('/yolo ')
          return
        }
        if (argument !== 'on' && argument !== 'off') {
          setError('Use /yolo on or /yolo off')
          return
        }
        const enabled = argument === 'on'
        setYoloMode(enabled)
        showCommandNotice(enabled ? 'YOLO mode enabled' : 'YOLO mode disabled', [
          { label: 'Approval prompts', value: enabled ? 'Disabled for future turns' : 'Restored for future turns' },
          { label: 'Workspace sandbox', value: 'Still enforced' },
          { label: 'Scope', value: 'Saved on this device until you change it' },
        ])
        return
      }
      case 'model': {
        if (!argument) {
          setComposer('/model ')
          return
        }
        const selected = models.find((model) => model.model === argument || model.id === argument)
        if (!selected) {
          setError(`Unknown model: ${argument}`)
          return
        }
        setSelectedModel(selected.model)
        setSelectedEffort(selected.defaultReasoningEffort ?? null)
        showCommandNotice('Model changed', [
          { label: 'Model', value: selected.displayName || selected.model },
          { label: 'Applied', value: 'Future turns in this conversation' },
          { label: 'Effort', value: selected.defaultReasoningEffort || 'Model default' },
        ])
        return
      }
      case 'effort': {
        if (!argument) {
          setComposer('/effort ')
          return
        }
        if (!effectiveModel) {
          setError('Choose a model before setting reasoning effort')
          return
        }
        const selected = effortOptions.find((entry) => entry.reasoningEffort === argument)
        if (!selected) {
          setError(`Reasoning effort “${argument}” is not available for ${effectiveModel}`)
          return
        }
        setSelectedModel(effectiveModel)
        setSelectedEffort(selected.reasoningEffort)
        showCommandNotice('Reasoning effort changed', [
          { label: 'Model', value: effectiveModel },
          { label: 'Effort', value: selected.reasoningEffort },
          { label: 'Applied', value: 'Future turns in this conversation' },
        ])
        return
      }
      case 'help':
        showCommandNotice('Slash commands', slashCommands.map((command) => ({
          label: command.usage,
          value: command.description,
        })))
        return
      case 'new':
        setComposer('')
        await createThread()
        return
      case 'threads':
        setComposer('')
        setDrawerOpen(true)
        return
      case 'archive':
        if (activeTurnId) {
          setError('Stop the active turn before archiving this conversation')
          return
        }
        setComposer('')
        await archive()
        return
      case 'stop':
        if (!activeTurnId) {
          showCommandNotice('Turn status', [{ label: 'Codex', value: 'No active turn' }])
          return
        }
        setComposer('')
        await interrupt()
        return
      case 'lock':
        setComposer('')
        await logout()
        return
      default:
        setError(`Unknown slash command: /${name}. Try /help.`)
    }
  }

  async function submitInstruction(event: FormEvent) {
    event.preventDefault()
    if (!session || !thread || (!composer.trim() && attachments.length === 0)) return
    const instruction = composer.trim()
    const slashCommand = parseSlashCommand(instruction)
    if (slashCommand) {
      await executeSlashCommand(slashCommand.name, slashCommand.argument)
      return
    }
    if (busy) return
    if (activeTurnId) {
      setError('Your draft is saved here. Send it when this turn finishes, or stop the turn first.')
      return
    }
    setBusy(true)
    setComposer('')
    setError('')
    const sendingThreadId = thread.id
    const sendingImages = attachments
    const sent: SentMessage = {
      text: instruction,
      images: sendingImages.map(image => ({ name: image.file.name, previewUrl: image.previewUrl })),
    }
    setSentMessages(current => ({ ...current, [sendingThreadId]: sent }))
    const uploadedIds: string[] = []
    try {
      for (const [index, image] of sendingImages.entries()) {
        setUploadStatus(`Uploading image ${index + 1} of ${sendingImages.length} · ${image.file.name}`)
        uploadedIds.push((await api.uploadAttachment(image.file, session.csrf)).id)
      }
      setUploadStatus('Starting Codex…')
      const response = await api.startTurn(thread.id, instruction, session.csrf, {
        model: effectiveModel ?? undefined,
        effort: selectedEffort ?? undefined,
        approvalPolicy: yoloMode ? 'never' : 'on-request',
        attachmentIds: uploadedIds,
      })
      setAttachments([])
      setSentMessages(current => ({ ...current, [sendingThreadId]: { ...sent, turnId: response.turn.id } }))
      if (selectedRef.current === sendingThreadId) setActiveTurnId(response.turn.id)
    } catch (requestError) {
      await Promise.allSettled(uploadedIds.map(id => api.deleteAttachment(id, session.csrf)))
      setSentMessages(current => { const next = { ...current }; delete next[sendingThreadId]; return next })
      setComposer(instruction)
      setError(errorMessage(requestError))
    } finally {
      setUploadStatus('')
      setBusy(false)
    }
  }

  function chooseImages(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    addImages(files)
  }

  function addImages(files: File[]) {
    if (busy) return
    if (files.length === 0) return
    const accepted: ComposerImage[] = []
    let message = ''
    for (const original of files) {
      const extension = original.name.split('.').at(-1)?.toLowerCase()
      const inferred = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : ['jpg', 'jpeg'].includes(extension ?? '') ? 'image/jpeg' : ''
      const file = !original.type && inferred ? new File([original], original.name, { type: inferred }) : original
      if (attachments.length + accepted.length >= MAX_COMPOSER_IMAGES) {
        message = `You can attach up to ${MAX_COMPOSER_IMAGES} images per turn.`
        break
      }
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        message = `${file.name}: use JPEG, PNG, or WebP. Export HEIC/HEIF photos as JPEG first.`
        continue
      }
      if (file.size > MAX_COMPOSER_IMAGE_BYTES) {
        message = `${file.name} exceeds the 10 MB limit.`
        continue
      }
      const previewUrl = URL.createObjectURL(file)
      previewUrls.current.add(previewUrl)
      accepted.push({ key: crypto.randomUUID(), file, previewUrl })
    }
    if (accepted.length > 0) setAttachments(current => [...current, ...accepted])
    setError(message)
  }

  function removeImage(key: string) {
    setAttachments(current => current.filter(image => {
      if (image.key !== key) return true
      URL.revokeObjectURL(image.previewUrl)
      previewUrls.current.delete(image.previewUrl)
      return false
    }))
  }

  async function interrupt() {
    if (!session || !thread || !activeTurnId) return
    setBusy(true)
    try {
      await api.interrupt(thread.id, activeTurnId, session.csrf)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  async function archive() {
    if (!session || !thread || busy) return
    setBusy(true)
    try {
      await api.archiveThread(thread.id, session.csrf)
      const remaining = (await refreshThreads()).filter((item) => item.id !== thread.id)
      setThread(null)
      setSelectedId(null)
      selectedRef.current = null
      if (remaining[0]) await openThread(remaining[0])
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    if (!session) return
    if (notificationOperation.current) {
      setError('Wait for notification setup to finish before locking the app.')
      return
    }
    try {
      await api.logout(session.csrf)
    } catch (requestError) {
      setError(`Could not lock the app: ${errorMessage(requestError)}`)
      return
    }
    await clearConversationSnapshot()
    eventCursor.current = 0
    selectedRef.current = null
    setSession(null)
    setThread(null)
    setThreads([])
    setSelectedId(null)
    setActiveTurnId(null)
    setEvents([])
    setTranscripts({})
    setSentMessages({})
    for (const url of previewUrls.current) URL.revokeObjectURL(url)
    previewUrls.current.clear()
    setAttachments([])
    setPending([])
    setModels([])
    setSelectedModel(null)
    setSelectedEffort(null)
    setCommandNotice(null)
  }

  async function installApp() {
    if (!installPrompt) return
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    if (choice.outcome === 'accepted') setInstallPrompt(null)
  }

  async function toggleNotifications() {
    if (!session || notificationOperation.current) return
    notificationOperation.current = true
    setNotificationBusy(true)
    setError('')
    try {
      const enabled = !notificationsEnabled
      if (enabled) await enablePush(session.csrf)
      else await disablePush(session.csrf)
      setNotificationsEnabled(enabled)
      try { localStorage.setItem(NOTIFICATION_PREFERENCE, enabled ? 'enabled' : 'disabled') }
      catch { setError('Notifications changed, but this browser could not save the preference for your next login.') }
      if (enabled) setCommandNotice({
        title: 'Completion notifications enabled',
        lines: [
          { label: 'Alert', value: 'Sent even when this app is closed, while your session is valid' },
          { label: 'Privacy', value: 'Conversation content stays out of the notification' },
        ],
      })
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      notificationOperation.current = false
      setNotificationBusy(false)
    }
  }

  if (authLoading) return <main className="loading-shell"><span className="spinner" /><p>Connecting to Codex Remote…</p></main>
  if (!session) return <Login installPrompt={installPrompt} offline={!online} onInstall={() => void installApp()} onLogin={setSession} />

  return (
    <div className="app-shell">
      <ThreadSidebar
        threads={threads}
        selectedId={selectedId}
        open={drawerOpen}
        busy={busy}
        onClose={() => setDrawerOpen(false)}
        onCreate={() => void createThread()}
        onRefresh={() => void refreshThreads().catch((requestError) => setError(errorMessage(requestError)))}
        onSelect={(target) => void openThread(target).catch((requestError) => setError(errorMessage(requestError)))}
        workspaceLabel={session.workspaces[0]?.label || shortWorkspace(session.workspaces[0]?.path ?? '') || 'Workspace'}
      />

      <main className="workspace-shell">
        <header className="workspace-header">
          <button className="icon-button mobile-only" onClick={() => setDrawerOpen(true)} aria-label="Open conversations">☰</button>
          <div className="workspace-title">
            <h1>{thread ? threadTitle(thread) : 'Codex Remote'}</h1>
            <p>
              {thread ? <>{shortWorkspace(thread.cwd)}{effectiveModel ? ` · ${effectiveModel}` : ''}{selectedEffort ? ` · ${selectedEffort}` : ''}</> : 'Private workspace agent'}
            </p>
          </div>
          <div className={`connection-chip ${connected && online ? 'is-online' : ''} ${!online ? 'is-offline' : ''}`}>
            <span className="connection-dot" />
            {!online ? 'Offline' : connected ? 'Live' : activeTurnId ? 'Running' : 'Syncing'}
          </div>
          <div className="header-actions">
            {yoloMode && <button className="yolo-chip" type="button" onClick={() => {
              setYoloMode(false)
              showCommandNotice('YOLO mode disabled', [
                { label: 'Approval prompts', value: 'Restored for future turns' },
                { label: 'Workspace sandbox', value: 'Still enforced' },
              ])
            }} title="Approval prompts are disabled. Click to restore them.">YOLO</button>}
            {pending.length > 0 && <span className="pending-badge" title={`${pending.length} action${pending.length === 1 ? '' : 's'} needed`}>{pending.length}</span>}
            <button className={`quiet-button notification-button ${notificationsEnabled ? 'is-enabled' : ''}`} type="button" disabled={notificationBusy} onClick={() => void toggleNotifications()} title={notificationsEnabled ? 'Completion notifications are on' : 'Enable completion notifications'} aria-label={notificationsEnabled ? 'Disable completion notifications' : 'Enable completion notifications'}>🔔<span>{notificationBusy ? 'Saving…' : notificationsEnabled ? 'On' : 'Notify'}</span></button>
            {installPrompt && <button className="quiet-button install-button" onClick={() => void installApp()}>Install</button>}
            {thread && <button className="quiet-button archive-button" onClick={() => void archive()} disabled={busy || Boolean(activeTurnId)}>Archive</button>}
            <button className="quiet-button" onClick={() => void logout()}>Lock</button>
          </div>
        </header>

        <nav className="view-tabs" aria-label="Conversation view">
          <button className={tab === 'conversation' ? 'is-active' : ''} onClick={() => setTab('conversation')}>Conversation</button>
          <button className={tab === 'output' ? 'is-active' : ''} onClick={() => setTab('output')}>All output <span>{selectedEvents.length}</span></button>
        </nav>

        <TranscriptViewport key={`${selectedId}-${tab}`} viewKey={`${selectedId}-${tab}`} ready={Boolean(thread)} positions={readingPositions.current}>
          {updateWorker && (
            <div className="update-banner" role="status">
              <div><strong>Update ready</strong><span>A fresher Codex Remote is available.</span></div>
              <button className="primary-button" onClick={() => updateWorker.postMessage({ type: 'SKIP_WAITING' })}>Reload</button>
            </div>
          )}
          {!online && <div className="offline-banner global-offline" role="status">You’re offline. Conversation history remains visible, but new actions need a connection.</div>}
          {error && <div className="error-banner global-error" role="alert"><span>{error}</span><button onClick={() => setError('')}>×</button></div>}
          {yoloSaveError && <p className="error-banner" role="alert">{yoloSaveError}</p>}
          {selectedPending.map((request) => (
            <RequestCard
              key={request.key}
              request={request}
              csrf={session.csrf}
              onResolved={(key) => setPending((current) => current.filter((item) => item.key !== key))}
            />
          ))}

          {!thread && threads.length === 0 && (
            <div className="empty-state">
              <div className="empty-orbit" aria-hidden="true">✦</div>
              <h2>Start your first conversation</h2>
              <p>Codex will load the repository instructions before it begins.</p>
              <button className="primary-button" onClick={() => void createThread()} disabled={busy}>New conversation</button>
            </div>
          )}
          {!thread && threads.length > 0 && <div className="loading-inline"><span className="spinner" /> Loading conversation…</div>}
          {thread && tab === 'conversation' && <Conversation thread={thread} activeTurnId={activeTurnId} items={transcripts[thread.id] ?? []} pendingMessage={sentMessages[thread.id]} yoloMode={yoloMode} onSuggestion={(prompt) => {
            setComposer(prompt)
            requestAnimationFrame(() => composerRef.current?.focus())
          }} />}
          {thread && tab === 'output' && <OutputFeed events={selectedEvents} />}
        </TranscriptViewport>

        {thread && (
          <form className="composer" onSubmit={submitInstruction}
            onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
            onDrop={event => {
              if (!event.dataTransfer.files.length) return
              event.preventDefault()
              addImages([...event.dataTransfer.files])
            }}
            onPaste={event => {
              const images = [...event.clipboardData.files].filter(file => file.type.startsWith('image/'))
              if (!images.length) return
              if (!event.clipboardData.getData('text/plain')) event.preventDefault()
              addImages(images)
            }}>
            <div className="composer-controls" aria-label="Turn settings">
              <button type="button" onClick={() => {
                setComposer('/model ')
                composerRef.current?.focus()
              }}>{effectiveModel || 'Model'} <span aria-hidden="true">⌄</span></button>
              <button type="button" onClick={() => {
                setComposer('/effort ')
                composerRef.current?.focus()
              }}>{selectedEffort || effectiveModelOption?.defaultReasoningEffort || 'Effort'} <span aria-hidden="true">⌄</span></button>
              <button type="button" className="composer-status" disabled={busy} onClick={() => void executeSlashCommand('status', '')}>Usage & status</button>
            </div>
            {commandNotice && <LocalCommandResult notice={commandNotice} onClose={() => setCommandNotice(null)} />}
            <SlashMenu
              activeIndex={slashIndex}
              options={slashOptions}
              onChoose={(option) => {
                setComposer(option.fill)
                requestAnimationFrame(() => composerRef.current?.focus())
              }}
            />
            {attachments.length > 0 && <div className="composer-images" aria-label="Attached images">
              {attachments.map(image => <figure key={image.key}>
                <img src={image.previewUrl} alt={image.file.name} />
                <figcaption title={image.file.name}>{image.file.name} · {(image.file.size / 1024 / 1024).toFixed(1)} MB</figcaption>
                <button type="button" onClick={() => removeImage(image.key)} disabled={busy} aria-label={`Remove ${image.file.name}`}>×</button>
              </figure>)}
            </div>}
            {uploadStatus && <p className="upload-status" role="status"><span className="spinner" />{uploadStatus}</p>}
            {attachments.length > 0 && !busy && <p className="attachment-hint">{attachments.length}/4 images ready · paste or drop more · send with or without a message</p>}
            <div className="composer-surface">
              <input ref={attachmentInputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={chooseImages} />
              <button className="attach-button" type="button" onClick={() => attachmentInputRef.current?.click()} disabled={busy || attachments.length >= MAX_COMPOSER_IMAGES} aria-label="Attach images" title="Attach images">＋</button>
              <label htmlFor="instruction" className="sr-only">Instruction for Codex</label>
              <textarea
                ref={composerRef}
                id="instruction"
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                aria-expanded={slashOptions.length > 0}
                aria-controls={slashOptions.length > 0 ? 'slash-command-menu' : undefined}
                onKeyDown={(event) => {
                  if (slashOptions.length > 0 && event.key === 'ArrowDown') {
                    event.preventDefault()
                    setSlashIndex((current) => (current + 1) % slashOptions.length)
                    return
                  }
                  if (slashOptions.length > 0 && event.key === 'ArrowUp') {
                    event.preventDefault()
                    setSlashIndex((current) => (current - 1 + slashOptions.length) % slashOptions.length)
                    return
                  }
                  if (slashOptions.length > 0 && event.key === 'Tab') {
                    event.preventDefault()
                    setComposer(slashOptions[slashIndex]?.fill ?? composer)
                    return
                  }
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    const selectedOption = slashOptions[slashIndex]
                    if (selectedOption && selectedOption.fill.trim() !== composer.trim()) {
                      event.preventDefault()
                      setComposer(selectedOption.fill)
                      return
                    }
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
                placeholder={activeTurnId ? 'Draft your next message, or type / for commands…' : 'Message Codex…'}
                rows={1}
                maxLength={100_000}
              />
              {activeTurnId ? (
                <button type="button" className="stop-button" onClick={() => void interrupt()} disabled={busy} aria-label="Stop Codex">■</button>
              ) : (
                <button type="submit" className="send-button" disabled={busy || (!composer.trim() && attachments.length === 0)} aria-label="Send instruction">↑</button>
              )}
            </div>
            <div className="composer-meta">
              <span>{activeTurnId ? <><i className="pulse-dot" /> Codex is working</> : 'Type / for commands · Enter to send'}</span>
              {!activeTurnId && (composer.length > 0 || attachments.length > 0) && <span>{attachments.length > 0 ? `${attachments.length} image${attachments.length === 1 ? '' : 's'} · ` : ''}{composer.length.toLocaleString()} / 100,000</span>}
            </div>
          </form>
        )}
      </main>
    </div>
  )
}
