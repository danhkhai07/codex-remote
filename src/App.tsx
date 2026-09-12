import { ChangeEvent, Fragment, FormEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useThreadState } from './useThreadState'
import { useUnreadMessages } from './useUnreadMessages'
import { RenameConversation } from './RenameConversation'
import { ConversationActions } from './ConversationActions'
import { ThreadHistoryCache } from './threadHistoryCache'
import { clearScreenState, flushScreenState, useScreenState } from './screenState'
import { useInterrupt, turnHasEnded } from './useInterrupt'
import { useDraftImages, type ComposerImage } from './useDraftImages'
import { conversationItems, reconcileTranscript, updateTranscript, type TranscriptItem } from './transcript'
import { api, ApiError } from './api'
import { useYoloPreference } from './useYoloPreference'
import { enablePush, disablePush, reportPushVisibility, restorePush } from './push'
import { MarkdownMessage, type LocalFileReference, type WebLinkReference } from './MarkdownMessage'
import { FileViewer } from './FileViewer'
import { FileBrowser } from './FileBrowser'
import { LinkViewer } from './LinkViewer'
import { EventAssembler, shouldKeepEventStream } from './eventStream'
import { TranscriptViewport, type ReadingPosition } from './TranscriptViewport'
import { matchingSlashCommands, parseSlashCommand, slashCommands } from './slashCommands'
import { clearConversationSnapshot, loadConversationSnapshot, saveConversationSnapshot } from './deviceCache'
import {
  commandText,
  commandSummary,
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

type SentMessage = { text: string; turnId?: string; images?: Array<{ name: string; previewUrl: string }> }
const EMPTY_ITEMS: TranscriptItem[] = []

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
  unreadCounts,
  selectedId,
  open,
  busy,
  onClose,
  onCreate,
  onLock,
  notificationsEnabled,
  notificationBusy,
  onToggleNotifications,
  onSelect,
  onRename,
  onArchive,
  canArchive,
  workspaceLabel,
}: {
  threads: Thread[]
  unreadCounts: Record<string, number>
  selectedId: string | null
  open: boolean
  busy: boolean
  onClose: () => void
  onCreate: () => void
  onLock: () => void
  notificationsEnabled: boolean
  notificationBusy: boolean
  onToggleNotifications: () => void
  onSelect: (thread: Thread) => void
  onRename: (thread: Thread) => void
  onArchive: (thread: Thread) => void
  canArchive: (thread: Thread) => boolean
  workspaceLabel: string
}) {
  const [query, setQuery] = useState('')
  const actionsRef = useRef<HTMLDetailsElement>(null)
  const visibleThreads = useMemo(() => filterThreads(threads, query), [threads, query])

  useEffect(() => {
    actionsRef.current?.removeAttribute('open')
  }, [open, selectedId])

  useEffect(() => {
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !actionsRef.current?.contains(event.target)) {
        actionsRef.current?.removeAttribute('open')
      }
    }
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !actionsRef.current?.open) return
      actionsRef.current.removeAttribute('open')
      actionsRef.current.querySelector('summary')?.focus()
      event.preventDefault()
    }
    document.addEventListener('pointerdown', dismissOutside)
    document.addEventListener('keydown', dismissEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside)
      document.removeEventListener('keydown', dismissEscape)
    }
  }, [])

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
          <details className="sidebar-actions" ref={actionsRef}>
            <summary className="icon-button" aria-label="Settings" title="Settings">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 3-.5 2.4-2 .9-2.1-.7-2 3.4 1.6 1.7v2.6L2.4 15l2 3.4 2.1-.7 2 .9L9 21h4l.5-2.4 2-.9 2.1.7 2-3.4-1.6-1.7v-2.6L19.6 9l-2-3.4-2.1.7-2-.9L13 3Z" transform="translate(1 0)" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </summary>
            <div className="sidebar-actions-popover">
              <button
                className={`quiet-button notification-button ${notificationsEnabled ? 'is-enabled' : ''}`}
                type="button"
                disabled={notificationBusy}
                onClick={onToggleNotifications}
                aria-label={notificationsEnabled ? 'Disable completion notifications' : 'Enable completion notifications'}
                aria-pressed={notificationsEnabled}
                aria-busy={notificationBusy}
              >
                <span>Notifications</span>
                <span className="notification-state">{notificationBusy ? 'Saving…' : notificationsEnabled ? 'On' : 'Off'}</span>
              </button>
              <button className="quiet-button" type="button" onClick={() => {
                actionsRef.current?.removeAttribute('open')
                onLock()
              }}>Lock app</button>
            </div>
          </details>
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
            <div className={`thread-row-entry ${selectedId === thread.id ? 'is-selected' : ''}`} key={thread.id}>
            <button
              className="thread-row"
              onClick={() => onSelect(thread)}
            >
              <span className="thread-row-heading">
                <span className="thread-row-title">{threadTitle(thread)}</span>
                {(unreadCounts[thread.id] ?? 0) > 0 && <span className="thread-unread-badge" aria-label={`${unreadCounts[thread.id]} unread messages`}>{unreadCounts[thread.id] > 99 ? '99+' : unreadCounts[thread.id]}</span>}
              </span>
              <span className="thread-row-meta">
                {shortWorkspace(thread.cwd)} · {formatTime(thread.updatedAt)}
              </span>
            </button>
            <ConversationActions title={threadTitle(thread)} archiveDisabled={!canArchive(thread)}
              onRename={() => onRename(thread)} onArchive={() => onArchive(thread)} />
            </div>
          ))}
        </div>
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

const HistoryItem = memo(function HistoryItem({ item, onOpenFile, onOpenLink }: {
  item: ThreadItem
  onOpenFile?: (reference: LocalFileReference) => void
  onOpenLink?: (reference: WebLinkReference) => void
}) {
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
        {text && <MarkdownMessage streaming={item.type === 'agentMessage' && item.streaming === true} onOpenFile={onOpenFile} onOpenLink={onOpenLink}>{text}</MarkdownMessage>}
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
}, (previous, next) => previous.onOpenFile === next.onOpenFile && previous.onOpenLink === next.onOpenLink
  && Object.keys(previous.item).length === Object.keys(next.item).length
  && Object.keys(previous.item).every(key => Object.is(previous.item[key], next.item[key])))

const starterPrompts = [
  'Summarize the current repository state',
  'Find the most important issue to fix next',
  'Review the latest changes',
]

export const Conversation = memo(function Conversation({ thread, activeTurnId, items, pendingMessage, yoloMode, onSuggestion, onOpenFile, onOpenLink }: {
  thread: Thread
  activeTurnId: string | null
  items: TranscriptItem[]
  pendingMessage?: SentMessage
  yoloMode: boolean
  onSuggestion: (prompt: string) => void
  onOpenFile?: (reference: LocalFileReference) => void
  onOpenLink?: (reference: WebLinkReference) => void
}) {
  const rows = useMemo(() => conversationItems(thread, items), [thread, items])
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
      {!thread.historyCacheTruncated && rows.some(item => item.historyItemTruncated) && <p className="history-note">Phần cuối nội dung đã được rút gọn để giữ bản xem trong giới hạn 5 MB. Lịch sử gốc vẫn giữ nguyên.</p>}
      {rows.length === 0 && !pendingMessage && !activeTurnId && (
        <div className="empty-state">
          <h2>What should Codex work on?</h2>
          <p>Working in <strong>{shortWorkspace(thread.cwd)}</strong>. {yoloMode ? 'Full VPS host access is enabled.' : 'Commands run automatically inside the workspace sandbox.'}</p>
          <div className="starter-prompts">
            {starterPrompts.map(prompt => <button className="starter-prompt" key={prompt} onClick={() => onSuggestion(prompt)}>{prompt}</button>)}
          </div>
        </div>
      )}
      {rows.map((item, index) => (
        <Fragment key={item.id ? `${item.turnId}-${item.id}` : `${item.turnId}-${index}`}>
          {showPending && pendingMessage?.turnId === item.turnId && (index === 0 || rows[index - 1].turnId !== item.turnId) &&
            <HistoryItem item={pendingItem!} onOpenFile={onOpenFile} onOpenLink={onOpenLink} />}
          <HistoryItem item={index === pendingMatch ? pendingItem! : item} onOpenFile={onOpenFile} onOpenLink={onOpenLink} />
        </Fragment>
      ))}
      {showPending && !rows.some(item => item.turnId === pendingMessage?.turnId) &&
        <HistoryItem item={pendingItem!} onOpenFile={onOpenFile} onOpenLink={onOpenLink} />}
      {(activeTurnId || (showPending && !pendingMessage?.turnId)) &&
        <div className="working-line"><span className="pulse-dot" />{activeTurnId ? 'Codex is working' : 'Sending…'}</div>}
    </section>
  )
})

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
  const [historyReady, setHistoryReady] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const threadCache = useRef(new ThreadHistoryCache())
  const currentView = useRef({ thread, ready: historyReady })
  currentView.current = { thread, ready: historyReady }
  const historyRequest = useRef<AbortController | null>(null)
  const cacheHydrated = useRef(false)
  const [transcripts, setTranscripts] = useState<Record<string, TranscriptItem[]>>({})
  const [sentMessages, setSentMessages] = useState<Record<string, SentMessage>>({})
  const previewUrls = useRef(new Set<string>())
  const [attachments, setAttachments, clearAttachments, imagesReady] = useDraftImages(selectedId, previewUrls)
  const [uploadStatus, setUploadStatus, , clearUploadStatus] = useThreadState(selectedId, '')
  const [sendError, setSendError, , clearSendErrors] = useThreadState(selectedId, '')
  const [pending, setPending] = useState<PendingRequest[]>([])
  const [models, setModels] = useState<ModelOption[]>([])
  const [selectedModel, setSelectedModel] = useScreenState<string | null>('model', null)
  const [selectedEffort, setSelectedEffort] = useScreenState<string | null>('effort', null)
  const [yoloMode, setYoloMode, yoloSaveError] = useYoloPreference()
  const [commandNotice, setCommandNotice] = useScreenState<CommandNotice | null>('command-notice', null)
  const [slashIndex, setSlashIndex] = useState(0)
  const [activeTurnId, , setThreadTurn, clearThreadTurns, activeTurns] = useThreadState<string | null>(selectedId, null)
  const [composer, setComposer, , clearDrafts] = useThreadState(selectedId, '', 'drafts')
  const [drawerOpen, setDrawerOpen] = useScreenState('drawer', false)
  const [connected, setConnected] = useState(false)
  const [cacheReady, setCacheReady] = useState(false)
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== 'hidden')
  const [online, setOnline] = useState(() => navigator.onLine)
  const [installPrompt, setInstallPrompt] = useState<PwaInstallPrompt | null>(null)
  const [updateWorker, setUpdateWorker] = useState<ServiceWorker | null>(null)
  const [notificationsEnabled, setNotificationsEnabled] = useState(false)
  const [notificationBusy, setNotificationBusy] = useState(false)
  const [operationBusy, setBusy] = useState(false)
  const [sending, setSending] = useState<Record<string, boolean>>({})
  const busy = operationBusy || !imagesReady || Boolean(selectedId && sending[selectedId])
  const [error, setError] = useState('')
  const [fileViewer, setFileViewer] = useScreenState<LocalFileReference | null>('file-viewer', null)
  const [fileBrowserPath, setFileBrowserPath] = useScreenState<string | null>('file-browser', null)
  const [linkViewer, setLinkViewer] = useScreenState<WebLinkReference | null>('link-viewer', null)
  const [renamingThread, setRenamingThread] = useState<Thread | null>(null)
  const { counts: unreadCounts, observe: observeUnread, clear: clearUnread } = useUnreadMessages(
    threads,
    session && pageVisible && historyReady && thread?.id === selectedId && !drawerOpen &&
      !fileViewer && !fileBrowserPath && !linkViewer && !renamingThread ? selectedId : null,
    Boolean(session?.csrf && online && pageVisible && cacheReady),
  )
  const closeRename = useCallback(() => setRenamingThread(null), [])
  const applyThreadName = useCallback((id: string, name: string | null) => {
    setThreads(current => current.map(item => item.id === id && item.name !== name ? { ...item, name } : item))
    setThread(current => current?.id === id && current.name !== name ? { ...current, name } : current)
  }, [])
  const selectedRef = useRef<string | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const attachmentInputRef = useRef<HTMLInputElement | null>(null)
  const readingPositions = useRef(new Map<string, ReadingPosition>())
  const notificationOperation = useRef(false)
  const eventCursor = useRef(0)
  const eventEpoch = useRef('')
  const openSequence = useRef(0)
  const turnVersions = useRef(new Map<string, number>())
  const completedTurns = useRef(new Set<string>())
  const sendingLocks = useRef(new Set<string>())
  const sessionEpoch = useRef(0)
  const confirmStopped = useCallback((id: string, turnId: string) => {
    completedTurns.current.add(turnId)
    setThreadTurn(id, current => current === turnId ? null : current)
    setSentMessages(current => {
      if (current[id]?.turnId !== turnId) return current
      for (const image of current[id].images ?? []) {
        URL.revokeObjectURL(image.previewUrl)
        previewUrls.current.delete(image.previewUrl)
      }
      const next = { ...current }; delete next[id]; return next
    })
  }, [setThreadTurn])
  const { states: stopStates, stop: stopTurn, confirm: confirmStop } = useInterrupt(session?.csrf, confirmStopped)
  const stopState = selectedId && stopStates[selectedId]?.turnId === activeTurnId ? stopStates[selectedId] : undefined
  const closeFileViewer = useCallback(() => setFileViewer(null), [])
  const closeFileBrowser = useCallback(() => setFileBrowserPath(null), [])
  const closeLinkViewer = useCallback(() => setLinkViewer(null), [])
  const openFile = useCallback((reference: LocalFileReference) => {
    setLinkViewer(null)
    setFileViewer(reference)
  }, [])
  const openLink = useCallback((reference: WebLinkReference) => {
    setFileViewer(null)
    setLinkViewer(reference)
  }, [])
  const suggestPrompt = useCallback((prompt: string) => {
    setComposer(prompt)
    requestAnimationFrame(() => composerRef.current?.focus())
  }, [setComposer])

  useEffect(() => () => {
    for (const url of previewUrls.current) URL.revokeObjectURL(url)
    previewUrls.current.clear()
  }, [])

  useEffect(() => {
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | undefined
    setNotificationsEnabled(false)
    if (!session?.csrf) return
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
      } catch {
        // Restoration retries on focus/online; a transient failure must not
        // replace the current screen or imply the subscription was removed.
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
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | undefined
    let checking = false
    let authenticated = false
    const check = async () => {
      if (cancelled || checking || authenticated) return
      checking = true
      try {
        const verified = await api.session(AbortSignal.timeout(8_000))
        if (!cancelled) { authenticated = true; setSession(verified); setAuthLoading(false) }
      } catch (requestError) {
        if (cancelled) return
        if (requestError instanceof ApiError && requestError.status === 401) {
          setSession(null)
          setAuthLoading(false)
        } else {
          // A connection failure is not a logout. Never retry user instructions.
          retry = setTimeout(() => void check(), 3_000)
        }
      } finally { checking = false }
    }
    void loadConversationSnapshot().then(cached => {
      if (cancelled) return
      if (cached?.session && cached.session.expiresAt * 1_000 > Date.now()) {
        setSession({ ...cached.session, csrf: '' })
        setAuthLoading(false)
      }
      void check()
    })
    const reconnect = () => { clearTimeout(retry); void check() }
    window.addEventListener('online', reconnect)
    return () => { cancelled = true; clearTimeout(retry); window.removeEventListener('online', reconnect) }
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

  useEffect(() => {
    if (!session?.csrf || !notificationsEnabled) return
    const report = () => void reportPushVisibility(session.csrf, pageVisible).catch(() => undefined)
    report()
    if (!pageVisible) return
    const heartbeat = window.setInterval(report, 15_000)
    return () => window.clearInterval(heartbeat)
  }, [notificationsEnabled, pageVisible, session])

  const refreshThreads = useCallback(async () => {
    const response = await api.threads()
    setThreads(response.data)
    return response.data
  }, [])

  useEffect(() => {
    if (thread && historyReady) threadCache.current.remember(thread)
  }, [thread, historyReady])

  useEffect(() => () => historyRequest.current?.abort(), [])

  const openThread = useCallback(async (target: Thread, csrf = session?.csrf, preserveVisibleCache = false) => {
    const previous = currentView.current
    if (previous.thread && previous.ready) threadCache.current.remember(previous.thread)
    const cached = threadCache.current.get(target.id)
    const sequence = ++openSequence.current
    const epoch = sessionEpoch.current
    const version = turnVersions.current.get(target.id)
    historyRequest.current?.abort()
    const request = new AbortController()
    historyRequest.current = request
    setSelectedId(target.id)
    selectedRef.current = target.id
    if (!preserveVisibleCache) setDrawerOpen(false)
    setError('')
    if (!preserveVisibleCache) setCommandNotice(null)
    setThread(cached ? { ...target, ...cached, name: target.name ?? cached.name } : { ...target, turns: [], historyUnavailable: true })
    setHistoryReady(Boolean(cached))
    if (!preserveVisibleCache) {
      setSelectedModel(cached?.model ?? target.model ?? null)
      setSelectedEffort(null)
    }
    if (!csrf || !navigator.onLine) { setHistoryLoading(false); return }
    setHistoryLoading(true)
    // Resuming subscribes the runtime, but must never block painting history.
    void api.resumeThread(target.id, csrf).catch(() => undefined)
    try {
      const history = await api.thread(target.id, AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]))
      if (request.signal.aborted || sequence !== openSequence.current || selectedRef.current !== target.id || epoch !== sessionEpoch.current) return
      threadCache.current.remember(history.thread)
      setThread((current) => history.thread.historyUnavailable && cached && current?.id === target.id
        ? { ...current, ...history.thread, turns: current.turns }
        : history.thread)
      setHistoryReady(true)
      setTranscripts(current => {
        const before = current[target.id] ?? EMPTY_ITEMS
        const after = reconcileTranscript(before, history.thread)
        return before === after ? current : { ...current, [target.id]: after }
      })
      if (!history.thread.historyUnavailable && version === turnVersions.current.get(target.id)) {
        const running = history.thread.latestTurn?.status === 'inProgress' ? history.thread.latestTurn : [...(history.thread.turns ?? [])].reverse().find((turn) => turn.status === 'inProgress')
        setThreadTurn(target.id, running?.id ?? null)
      }
    } catch (requestError) {
      if (!request.signal.aborted && sequence === openSequence.current && selectedRef.current === target.id && !cached) throw requestError
    } finally {
      if (sequence === openSequence.current && epoch === sessionEpoch.current) setHistoryLoading(false)
    }
  }, [session?.csrf, setThreadTurn])

  useEffect(() => {
    if (!session) {
      setCacheReady(false)
      return
    }
    let cancelled = false
    void (async () => {
      const cached = await loadConversationSnapshot()
      if (cancelled) return
      if (cached && !cacheHydrated.current) {
        threadCache.current.restore(cached.histories)
        if (cached.thread) threadCache.current.remember(cached.thread)
        setThreads(cached.threads)
        setSelectedId(cached.selectedId)
        selectedRef.current = cached.selectedId
        setThread(cached.thread)
        setHistoryReady(Boolean(cached.thread))
        setTranscripts(cached.transcripts)
        setThreadTurn(cached.selectedId, cached.activeTurnId)
        eventCursor.current = cached.lastEventId
        eventEpoch.current = cached.eventEpoch ?? ''
      }
      cacheHydrated.current = true
      setCacheReady(true)

      if (!session.csrf) return

      try {
        const [items, pendingResponse, modelResponse] = await Promise.all([refreshThreads(), api.pending(), api.models()])
        if (cancelled) return
        setPending(pendingResponse.data)
        setModels(modelResponse.data)
        const preferred = items.find((item) => item.id === cached?.selectedId) ?? items[0]
        if (preferred && (!selectedRef.current || selectedRef.current === cached?.selectedId)) await openThread(preferred, session.csrf, preferred.id === cached?.selectedId)
      } catch (requestError) {
        if (!cancelled && !cached) setError(errorMessage(requestError))
      }
    })()
    return () => { cancelled = true }
  }, [session, refreshThreads, openThread, setThreadTurn])

  useEffect(() => {
    if (!session || !cacheReady || !historyReady || (thread && thread.id !== selectedId)) return
    const save = () => {
      void saveConversationSnapshot({
        threads,
        selectedId,
        thread,
        histories: threadCache.current.snapshot(),
        transcripts,
        activeTurnId,
        lastEventId: eventCursor.current,
        eventEpoch: eventEpoch.current,
        session: { expiresAt: session.expiresAt, workspaces: session.workspaces },
      })
    }
    const timer = setTimeout(save, 150)
    const hidden = () => { if (document.visibilityState === 'hidden') save() }
    window.addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [activeTurnId, cacheReady, historyReady, selectedId, session, thread, threads, transcripts])

  useEffect(() => {
    if (!session?.csrf || !pageVisible || !online) return
    let cancelled = false
    let syncing = false
    let optionsLoaded = false
    const sync = async () => {
      if (syncing || cancelled) return
      syncing = true
      const id = selectedRef.current
      const sequence = openSequence.current
      const version = id ? turnVersions.current.get(id) : undefined
      void refreshThreads().catch(() => undefined)
      if (!optionsLoaded) void Promise.all([api.pending(), api.models()]).then(([requests, modelList]) => {
        if (cancelled) return
        setPending(requests.data)
        setModels(modelList.data)
        optionsLoaded = true
      }).catch(() => undefined)
      if (!id) { syncing = false; return }
      try {
        const response = await api.thread(id, AbortSignal.timeout(8_000))
        if (cancelled || sequence !== openSequence.current || selectedRef.current !== id || version !== turnVersions.current.get(id)) return
        threadCache.current.remember(response.thread)
        setThread(current => current?.id !== id ? current : response.thread.historyUnavailable
          ? { ...current, ...response.thread, turns: current.turns } : response.thread)
        setHistoryReady(true)
        setTranscripts(current => {
          const before = current[id] ?? EMPTY_ITEMS
          const after = reconcileTranscript(before, response.thread)
          return before === after ? current : { ...current, [id]: after }
        })
        if (!response.thread.historyUnavailable) {
          const running = response.thread.latestTurn?.status === 'inProgress' ? response.thread.latestTurn : [...(response.thread.turns ?? [])].reverse().find(turn => turn.status === 'inProgress')
          if (running) setThreadTurn(id, running.id)
          else setThreadTurn(id, current => current && !turnHasEnded(response.thread, current) ? current : null)
        }
      } catch { /* Reconnect is background work; don't replace the screen. */ }
      finally { syncing = false }
    }
    void sync()
    const retry = setInterval(() => void sync(), 15_000)
    return () => { cancelled = true; clearInterval(retry) }
  }, [pageVisible, online, session, refreshThreads, setThreadTurn])

  const keepLive = shouldKeepEventStream(pageVisible, activeTurnId)

  useEffect(() => {
    if (!session?.csrf || !cacheReady || !keepLive || !online) {
      setConnected(false)
      return
    }
    const source = new EventSource(`/api/events?${new URLSearchParams({ after: String(eventCursor.current), epoch: eventEpoch.current })}`)
    const assembler = new EventAssembler()
    const epoch = sessionEpoch.current
    let queued: RemoteEvent[] = []
    let flushTimer: ReturnType<typeof setTimeout> | undefined
    const flush = () => {
      flushTimer = undefined
      const batch = queued
      queued = []
      if (!batch.length || epoch !== sessionEpoch.current) return
      setTranscripts(current => {
        let next = current
        for (const event of batch) {
          if (event.replayed) continue
          const id = eventThreadId(event)
          if (!id) continue
          const before = next[id] ?? EMPTY_ITEMS
          const after = updateTranscript(before, event)
          if (before === after) continue
          if (next === current) next = { ...current }
          next[id] = after
        }
        return next
      })
      for (const event of batch) handleEvent(event)
    }
    source.onopen = () => setConnected(true)
    source.onerror = () => { assembler.reset(); setConnected(false) }
    source.addEventListener('stream-state', message => {
      try {
        const state = JSON.parse((message as MessageEvent<string>).data) as { epoch: string; reset: boolean }
        if (typeof state.epoch !== 'string') return
        if (state.reset || (eventEpoch.current && eventEpoch.current !== state.epoch)) eventCursor.current = 0
        eventEpoch.current = state.epoch
      } catch { /* Old gateways need not send this handshake. */ }
    })
    const receive = (data: string) => {
      let event: RemoteEvent
      try {
        event = JSON.parse(data) as RemoteEvent
      } catch {
        return
      }
      if (!Number.isSafeInteger(event.id)) return
      if (event.replayed && event.id < eventCursor.current && !eventEpoch.current) eventCursor.current = 0
      if (event.id <= eventCursor.current) return
      eventCursor.current = event.id
      queued.push(event)
      if (flushTimer === undefined) flushTimer = setTimeout(flush, 50)
    }
    const handleEvent = (event: RemoteEvent) => {
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
      if (method === 'thread/name/updated' && eventThread && (typeof params.threadName === 'string' || params.threadName === null)) {
        applyThreadName(eventThread, params.threadName)
      }
      if (event.replayed && event.type === 'codex') {
        // Recover runtime status even when Codex cannot return persisted turns,
        // but never append overlapping backlog deltas or trigger a refresh storm.
        const turnId = object(params.turn).id ?? params.turnId
        if (eventThread && typeof turnId === 'string') {
          if (method === 'turn/completed') confirmStop(eventThread, turnId)
          else if (!completedTurns.current.has(turnId)) setThreadTurn(eventThread, current => current ?? turnId)
        }
        return
      }
      if (method === 'item/completed' && eventThread && typeof params.turnId === 'string') {
        const item = object(params.item)
        if (item.type === 'agentMessage' && typeof item.id === 'string' && typeof item.text === 'string' && item.text.trim()) {
          observeUnread(eventThread, [`${params.turnId}:${item.id}`])
        }
      }
      if (eventThread && ['turn/started', 'turn/completed'].includes(method)) {
        turnVersions.current.set(eventThread, (turnVersions.current.get(eventThread) ?? 0) + 1)
      }
      if (method === 'turn/started' && eventThread) {
        const turn = object(params.turn)
        if (typeof turn.id === 'string') setThreadTurn(eventThread, turn.id)
      }
      if (method === 'turn/completed') {
        const completed = object(params.turn).id
        if (typeof completed === 'string') completedTurns.current.add(completed)
        if (eventThread && typeof completed === 'string') confirmStop(eventThread, completed)
        if (eventThread) setSentMessages(current => {
          const sent = current[eventThread]
          if (!sent) return current
          if (sent.turnId && sent.turnId !== completed) return current
          for (const image of sent.images ?? []) {
            URL.revokeObjectURL(image.previewUrl)
            previewUrls.current.delete(image.previewUrl)
          }
          const next = { ...current }
          delete next[eventThread]
          return next
        })
        if (eventThread === selectedRef.current) {
          setTimeout(() => {
            const id = eventThread
            if (id && selectedRef.current === id) api.thread(id).then((response) => setThread((current) => (
              selectedRef.current !== id || current?.id !== id ? current : response.thread.historyUnavailable
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
      clearTimeout(flushTimer)
      flush()
      source.close()
      setConnected(false)
    }
  }, [keepLive, online, cacheReady, session, refreshThreads, setThreadTurn, confirmStop, applyThreadName, observeUnread])

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
        { key: 'yolo-on', label: 'on', description: 'Grant future turns full VPS host access', fill: '/yolo on', badge: yoloMode ? 'Active' : undefined },
        { key: 'yolo-off', label: 'off', description: 'Return future turns to the workspace sandbox', fill: '/yolo off', badge: yoloMode ? undefined : 'Active' },
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
    const frame = requestAnimationFrame(() => {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`
    })
    return () => cancelAnimationFrame(frame)
  }, [composer, thread?.id])

  async function createThread() {
    if (!session || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await api.createThread(session.workspaces[0]?.id ?? '0', session.csrf, yoloMode)
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
          { label: 'Connection', value: !online ? 'Offline' : connected ? 'Live' : activeTurnId ? 'Running' : pageVisible ? 'Syncing' : 'Sleeping' },
          { label: 'Workspace', value: thread ? shortWorkspace(thread.cwd) : 'None' },
          { label: 'Model', value: effectiveModel || 'Server default' },
          { label: 'Effort', value: selectedEffort || effectiveModelOption?.defaultReasoningEffort || 'Model default' },
          { label: 'Thread', value: activeTurnId ? 'Working' : typeof runtimeStatus === 'string' ? runtimeStatus : 'Idle' },
          { label: 'Approvals', value: 'Disabled' },
          { label: 'Sandbox', value: yoloMode ? 'Host access (YOLO)' : 'Workspace only' },
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
          { label: 'Approval prompts', value: 'Always disabled' },
          { label: 'Next turn sandbox', value: enabled ? 'Full VPS host access' : 'Workspace only' },
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
    if (!historyReady) { setSendError('Wait for this conversation to load. Your draft is kept.'); return }
    if (!online || !session.csrf) { setSendError('Reconnecting… Your draft is kept. Send it when the connection returns.'); return }
    const instruction = composer.trim()
    const slashCommand = parseSlashCommand(instruction)
    if (slashCommand) {
      await executeSlashCommand(slashCommand.name, slashCommand.argument)
      return
    }
    if (busy || sendingLocks.current.has(thread.id)) return
    if (activeTurnId) {
      setError('Your draft is saved here. Send it when this turn finishes, or stop the turn first.')
      return
    }
    sendingLocks.current.add(thread.id)
    setSendError('')
    setSending(current => ({ ...current, [thread.id]: true }))
    setComposer('')
    setError('')
    const sendingThreadId = thread.id
    const epoch = sessionEpoch.current
    const sendingImages = attachments
    setAttachments([])
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
        if (epoch !== sessionEpoch.current) return
      }
      setUploadStatus('Starting Codex…')
      const response = await api.startTurn(thread.id, instruction, session.csrf, {
        model: effectiveModel ?? undefined,
        effort: selectedEffort ?? undefined,
        fullAccess: yoloMode,
        attachmentIds: uploadedIds,
      })
      if (epoch !== sessionEpoch.current) return
      if (!completedTurns.current.has(response.turn.id)) {
        setSentMessages(current => ({ ...current, [sendingThreadId]: { ...sent, turnId: response.turn.id } }))
        setThreadTurn(sendingThreadId, response.turn.id)
      }
    } catch (requestError) {
      await Promise.allSettled(uploadedIds.map(id => api.deleteAttachment(id, session.csrf)))
      if (epoch !== sessionEpoch.current) return
      setSentMessages(current => { const next = { ...current }; delete next[sendingThreadId]; return next })
      setComposer(current => current ? `${instruction}\n${current}` : instruction)
      setAttachments(current => [...sendingImages, ...current])
      setSendError(errorMessage(requestError))
    } finally {
      if (epoch === sessionEpoch.current) {
        setUploadStatus('')
        sendingLocks.current.delete(sendingThreadId)
        setSending(current => { const next = { ...current }; delete next[sendingThreadId]; return next })
      }
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
    if (!thread || !activeTurnId) return
    await stopTurn(thread.id, activeTurnId)
  }

  function canArchive(target: Thread) {
    return Boolean(session?.csrf) && online && !busy && !sending[target.id] && !activeTurns[target.id] && object(target.status).type !== 'active'
  }

  async function archive(target = thread) {
    if (!session || !target || !canArchive(target)) return
    setBusy(true)
    try {
      await api.archiveThread(target.id, session.csrf)
      threadCache.current.delete(target.id)
      const remaining = (await refreshThreads()).filter((item) => item.id !== target.id)
      if (selectedRef.current !== target.id) return
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

  async function renameConversation(id: string, name: string) {
    if (!session?.csrf || !online) throw new Error('Reconnect before saving the conversation name')
    const epoch = sessionEpoch.current
    const response = await api.renameThread(id, name, session.csrf)
    if (epoch !== sessionEpoch.current) return
    applyThreadName(id, response.name)
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
    historyRequest.current?.abort()
    threadCache.current.clear()
    cacheHydrated.current = false
    setHistoryReady(false)
    setHistoryLoading(false)
    clearUnread()
    clearScreenState()
    sessionEpoch.current += 1
    sendingLocks.current.clear()
    completedTurns.current.clear()
    turnVersions.current.clear()
    setSending({})
    eventCursor.current = 0
    eventEpoch.current = ''
    selectedRef.current = null
    setSession(null)
    setThread(null)
    setThreads([])
    setSelectedId(null)
    openSequence.current += 1
    clearThreadTurns()
    clearDrafts()
    clearAttachments()
    clearUploadStatus()
    clearSendErrors()
    setTranscripts({})
    setSentMessages({})
    setFileViewer(null)
    setLinkViewer(null)
    setFileBrowserPath(null)
    setRenamingThread(null)
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
          { label: 'Alert', value: 'Shown only when no Codex Remote window is visible' },
          { label: 'Preview', value: 'Shows the first line of the completed response' },
        ],
      })
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      notificationOperation.current = false
      setNotificationBusy(false)
    }
  }

  if (authLoading) return <main className="loading-shell"><span className="spinner" /><p>{online ? 'Reconnecting to Codex Remote…' : 'Offline — waiting for connection…'}</p></main>
  if (!session) return <Login installPrompt={installPrompt} offline={!online} onInstall={() => void installApp()} onLogin={setSession} />

  return (
    <div className="app-shell">
      <ThreadSidebar
        threads={threads}
        unreadCounts={unreadCounts}
        selectedId={selectedId}
        open={drawerOpen}
        busy={busy}
        onClose={() => setDrawerOpen(false)}
        onCreate={() => void createThread()}
        onLock={() => void logout()}
        notificationsEnabled={notificationsEnabled}
        notificationBusy={notificationBusy}
        onToggleNotifications={() => void toggleNotifications()}
        onSelect={(target) => void openThread(target).catch((requestError) => setError(errorMessage(requestError)))}
        onRename={setRenamingThread}
        onArchive={target => void archive(target)}
        canArchive={canArchive}
        workspaceLabel={session.workspaces[0]?.label || shortWorkspace(session.workspaces[0]?.path ?? '') || 'Workspace'}
      />

      <main className="workspace-shell">
        <header className="workspace-header">
          <button className="icon-button mobile-only" onClick={() => setDrawerOpen(true)} aria-label="Open conversations">☰</button>
          <div className="workspace-title">
            <div className="workspace-title-line">
              <h1>{thread ? threadTitle(thread) : 'Codex Remote'}</h1>
            </div>
            <p>
              {thread ? <>{shortWorkspace(thread.cwd)}{effectiveModel ? ` · ${effectiveModel}` : ''}{selectedEffort ? ` · ${selectedEffort}` : ''}</> : 'Private workspace agent'}
            </p>
          </div>
          {yoloMode && <button className="yolo-chip" type="button" onClick={() => {
            setYoloMode(false)
            showCommandNotice('YOLO mode disabled', [
              { label: 'Approval prompts', value: 'Always disabled' },
              { label: 'Next turn sandbox', value: 'Workspace only' },
            ])
          }} title="Full VPS host access is enabled. Click to return future turns to the workspace sandbox.">YOLO</button>}
          <div className="header-actions">
            <div className={`connection-chip ${connected && online ? 'is-online' : ''} ${!online ? 'is-offline' : ''}`}>
              <span className="connection-dot" />
              {!online ? 'Offline' : connected ? 'Live' : activeTurnId ? 'Running' : 'Syncing'}
            </div>
            {pending.length > 0 && <span className="pending-badge" title={`${pending.length} action${pending.length === 1 ? '' : 's'} needed`}>{pending.length}</span>}
            {installPrompt && <button className="quiet-button install-button" onClick={() => void installApp()}>Install</button>}
          </div>
        </header>

        <nav className="view-tabs" aria-label="Conversation view">
          <span className="conversation-view-label">Conversation</span>
          <button className="files-tab" type="button" disabled={!thread} onClick={() => thread && setFileBrowserPath(thread.cwd)}>Files</button>
        </nav>

        <TranscriptViewport key={`${selectedId}-conversation`} viewKey={`${selectedId}-conversation`} ready={Boolean(thread) && historyReady} positions={readingPositions.current}>
          {updateWorker && (
            <div className="update-banner" role="status">
              <div><strong>Update ready</strong><span>A fresher Codex Remote is available.</span></div>
              <button className="primary-button" onClick={() => { flushScreenState(); updateWorker.postMessage({ type: 'SKIP_WAITING' }) }}>Reload</button>
            </div>
          )}
          {error && <div className="error-banner global-error" role="alert"><span>{error}</span><button onClick={() => setError('')}>×</button></div>}
          {sendError && <div className="error-banner global-error" role="alert"><span>{sendError}</span><button onClick={() => setSendError('')}>×</button></div>}
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
          {thread && !historyReady && <div className="loading-inline" role="status">
            {historyLoading ? <><span className="spinner" />Loading conversation…</> : <><span>{online ? 'Conversation could not be loaded.' : 'This conversation is not cached on this device yet.'}</span><button type="button" className="quiet-button" disabled={!online} onClick={() => void openThread(thread).catch(reason => setError(errorMessage(reason)))}>Retry</button></>}
          </div>}
          {thread?.historyCacheTruncated && <p className="history-note">{thread.historyTruncation === 'tail' ? 'Hội thoại vượt giới hạn 5 MB: phần cuối đã được rút gọn trong bản xem/cache. Lịch sử gốc vẫn giữ nguyên.' : 'Showing recent cached messages. Full history refreshes when connected.'}</p>}
          {thread && historyReady && <Conversation thread={thread} activeTurnId={activeTurnId} items={transcripts[thread.id] ?? EMPTY_ITEMS} pendingMessage={sentMessages[thread.id]} yoloMode={yoloMode} onOpenFile={openFile} onOpenLink={openLink} onSuggestion={suggestPrompt} />}
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
              <select
                className="composer-model"
                aria-label="Model for future turns"
                value={effectiveModel ?? ''}
                disabled={models.length === 0}
                onChange={(event) => {
                  const selected = models.find((model) => model.model === event.target.value)
                  if (!selected) return
                  setSelectedModel(selected.model)
                  setSelectedEffort(selected.defaultReasoningEffort ?? null)
                  setCommandNotice(null)
                  setError('')
                }}
              >
                {!effectiveModel && <option value="">Model</option>}
                {effectiveModel && !models.some((model) => model.model === effectiveModel) && (
                  <option value={effectiveModel}>{effectiveModel}</option>
                )}
                {models.map((model) => (
                  <option value={model.model} key={model.id}>{model.displayName || model.model}</option>
                ))}
              </select>
              <select
                className="composer-effort"
                aria-label="Reasoning effort for future turns"
                value={selectedEffort || effectiveModelOption?.defaultReasoningEffort || ''}
                disabled={!effectiveModel || effortOptions.length === 0}
                onChange={(event) => {
                  const selected = effortOptions.find((entry) => entry.reasoningEffort === event.target.value)
                  if (!selected || !effectiveModel) return
                  setSelectedModel(effectiveModel)
                  setSelectedEffort(selected.reasoningEffort)
                  setCommandNotice(null)
                  setError('')
                }}
              >
                {effortOptions.length === 0 && <option value="">Effort</option>}
                {effortOptions.map((entry) => (
                  <option value={entry.reasoningEffort} key={entry.reasoningEffort}>{entry.reasoningEffort}</option>
                ))}
              </select>
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
                placeholder={activeTurnId ? 'Draft your next message…' : 'Message Codex…'}
                rows={1}
                maxLength={100_000}
              />
              {activeTurnId ? (
                <button type="button" className="stop-button" onClick={() => void interrupt()} disabled={stopState?.phase === 'stopping' || !online || !session.csrf} aria-label={stopState?.phase === 'stopping' ? 'Stopping Codex' : stopState?.phase === 'error' ? 'Retry stop' : 'Stop Codex'} aria-busy={stopState?.phase === 'stopping'}>{stopState?.phase === 'stopping' ? <span className="spinner" /> : '■'}</button>
              ) : (
                <button type="submit" className="send-button" disabled={busy || !historyReady || !online || !session.csrf || (!composer.trim() && attachments.length === 0)} aria-label="Send instruction">↑</button>
              )}
            </div>
            <div className="composer-meta">
              <span role="status">{stopState ? stopState.message : activeTurnId ? <><i className="pulse-dot" /> Codex is working</> : 'Type / for commands · Enter to send'}</span>
              {!activeTurnId && (composer.length > 0 || attachments.length > 0) && <span>{attachments.length > 0 ? `${attachments.length} image${attachments.length === 1 ? '' : 's'} · ` : ''}{composer.length.toLocaleString()} / 100,000</span>}
            </div>
          </form>
        )}
        {fileBrowserPath && <FileBrowser key={fileBrowserPath} initialPath={fileBrowserPath} covered={Boolean(fileViewer || linkViewer)} onClose={closeFileBrowser} onOpenFile={openFile} />}
        {fileViewer && <FileViewer key={fileViewer.path} reference={fileViewer} onClose={closeFileViewer} onOpenFile={setFileViewer} onOpenLink={(reference) => {
          setFileViewer(null)
          setLinkViewer(reference)
        }} />}
        {linkViewer && <LinkViewer reference={linkViewer} onClose={closeLinkViewer} />}
        {renamingThread && <RenameConversation key={renamingThread.id} thread={renamingThread} online={online && Boolean(session.csrf)} onSave={renameConversation} onClose={closeRename} />}
      </main>
    </div>
  )
}
