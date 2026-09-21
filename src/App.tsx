import { QuestionRequest } from './QuestionRequest'
import { PendingRequests } from './pendingRequests'
import { useCollaborationMode, type CollaborationMode } from './useCollaborationMode'
import { LocalhostPreview } from './LocalhostPreview'
import { EMPTY_NEW_CONVERSATION, NEW_CONVERSATION_KEY, prepareNewConversation, type NewConversation } from './newConversation'
import { SkillsPicker } from './SkillsPicker'
import type { SkillSelection } from '../server/skills'
import { ChangeEvent, Fragment, FormEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { enterSendsMessage, isComposerSubmitKey } from './composerKeyboard'
import { settingsForModel, useConversationSettings } from './useConversationSettings'
import { useThreadState } from './useThreadState'
import { useUnreadMessages } from './useUnreadMessages'
import { RenameConversation } from './RenameConversation'
import { ConversationActions } from './ConversationActions'
import { ConversationFolders } from './ConversationFolders'
import { ConversationTeam } from './ConversationTeam'
import { conversationGroup } from './conversationGroups'
import { useConversationGroups } from './useConversationGroups'
import { ThreadHistoryCache } from './threadHistoryCache'
import { clearScreenState, flushScreenState, readScreenState, writeScreenState, useScreenState } from './screenState'
import { useInterrupt, turnHasEnded } from './useInterrupt'
import { isPreviewImage } from './attachmentFiles'
import { useDraftImages, type ComposerImage } from './useDraftImages'
import { conversationItems, reconcileTranscript, updateTranscript, type TranscriptItem } from './transcript'
import { api, ApiError } from './api'
import { useYoloPreference } from './useYoloPreference'
import { enablePush, disablePush, reportPushVisibility, restorePush } from './push'
import { MarkdownMessage, type LocalFileReference, type WebLinkReference } from './MarkdownMessage'
import { FileViewer } from './FileViewer'
import { FileBrowser } from './FileBrowser'
import { EventAssembler, shouldKeepEventStream } from './eventStream'
import { scheduleHistorySync } from './historySync'
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
const MAX_COMPOSER_FILES = 4
const MAX_COMPOSER_FILE_BYTES = 25 * 1024 * 1024

type SentMessage = { text: string; turnId?: string; images?: Array<{ name: string; previewUrl: string }>; files?: Array<{ name: string; size: number }> }
const EMPTY_SKILLS: SkillSelection[] = []
const EMPTY_ITEMS: TranscriptItem[] = []

function savedNotificationPreference(): boolean {
  try {
    return 'Notification' in window && Notification.permission === 'granted' && localStorage.getItem(NOTIFICATION_PREFERENCE) === 'enabled'
  } catch {
    return false
  }
}

export function Login({ installPrompt, offline, onInstall, onLogin }: {
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
  activeTurns,
  sending,
  selectedId,
  open,
  busy,
  onClose,
  onCreate,
  onLock,
  onReload,
  notificationsEnabled,
  notificationBusy,
  onToggleNotifications,
  onSelect,
  onRename,
  onArchive,
  canArchive,
  workspaceLabel,
  groups,
  groupsDisabled,
  onOpenContext,
  onOpenVault,
}: {
  threads: Thread[]
  unreadCounts: Record<string, number>
  activeTurns: Record<string, string | null>
  sending: Record<string, boolean>
  selectedId: string | null
  open: boolean
  busy: boolean
  onClose: () => void
  onCreate: (groupId?: string) => void
  onLock: () => void
  onReload: () => void
  notificationsEnabled: boolean
  notificationBusy: boolean
  onToggleNotifications: () => void
  onSelect: (thread: Thread) => void
  onRename: (thread: Thread) => void
  onArchive: (thread: Thread) => void
  canArchive: (thread: Thread) => boolean
  workspaceLabel: string
  groups: ReturnType<typeof useConversationGroups>
  groupsDisabled: boolean
  onOpenContext: (path: string) => void
  onOpenVault: (path: string) => void
}) {
  const [query, setQuery] = useState('')
  const actionsRef = useRef<HTMLDetailsElement>(null)
  const logoRef = useRef<HTMLButtonElement>(null)
  const actionsTrigger = useRef<HTMLElement | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)
  const visibleThreads = useMemo(() => filterThreads(threads, query), [threads, query])

  useEffect(() => {
    actionsRef.current?.removeAttribute('open')
  }, [open, selectedId])

  useEffect(() => {
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !actionsRef.current?.contains(event.target) && !logoRef.current?.contains(event.target)) {
        actionsRef.current?.removeAttribute('open')
      }
    }
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !actionsRef.current?.open) return
      actionsRef.current.removeAttribute('open')
      actionsTrigger.current?.focus()
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
            <button type="button" className="mini-brand" ref={logoRef} aria-label="App menu" title="App menu"
              aria-expanded={actionsOpen} aria-controls="sidebar-actions-menu" onClick={() => {
                const actions = actionsRef.current
                if (!actions) return
                actionsTrigger.current = logoRef.current
                actions.open = !actions.open
                if (actions.open) actions.querySelector('button')?.focus()
              }}>&gt;_</button>
            <div>
              <p className="eyebrow">Codex Remote</p>
              <h2>{workspaceLabel}</h2>
            </div>
          </div>
          <details className="sidebar-actions" ref={actionsRef} onToggle={event => setActionsOpen(event.currentTarget.open)}>
            <summary className="icon-button" aria-label="Settings" title="Settings" onClick={event => { actionsTrigger.current = event.currentTarget }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 3-.5 2.4-2 .9-2.1-.7-2 3.4 1.6 1.7v2.6L2.4 15l2 3.4 2.1-.7 2 .9L9 21h4l.5-2.4 2-.9 2.1.7 2-3.4-1.6-1.7v-2.6L19.6 9l-2-3.4-2.1.7-2-.9L13 3Z" transform="translate(1 0)" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </summary>
            <div className="sidebar-actions-popover" id="sidebar-actions-menu" role="group" aria-label="App actions">
              <button className="quiet-button" type="button" onClick={() => {
                actionsRef.current?.removeAttribute('open')
                onReload()
              }}>Reload app</button>
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
        <button className="primary-button new-thread-button" onClick={() => onCreate()} disabled={busy}>＋ New conversation</button>
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
          <ConversationFolders snapshot={groups.snapshot} error={groups.error} threads={visibleThreads} selectedId={selectedId}
            searching={Boolean(query.trim())} disabled={groupsDisabled} createDisabled={busy} operations={groups}
            onRefresh={() => void groups.refresh()} onCreate={onCreate} onContext={onOpenContext} onVault={onOpenVault}
            renderThread={(thread, onMove) => (
            <div className={`thread-row-entry ${selectedId === thread.id ? 'is-selected' : ''}`} key={thread.id}>
            <button
              className="thread-row"
              onClick={() => onSelect(thread)}
            >
              <span className="thread-row-heading">
                <span className="thread-row-title">{conversationGroup(groups.snapshot, thread.id)?.leaderThreadId === thread.id && <span className="leader-star" title="Leader" aria-label="Leader">★ </span>}{threadTitle(thread)}</span>
                {(sending[thread.id] || activeTurns[thread.id] || object(thread.status).type === 'active') && <span className="spinner thread-working-spinner" role="img" aria-label={sending[thread.id] ? 'Đang gửi yêu cầu' : 'Codex đang làm'} title={sending[thread.id] ? 'Đang gửi yêu cầu' : 'Codex đang làm'} />}
                {(unreadCounts[thread.id] ?? 0) > 0 && <span className="thread-unread-badge" aria-label="Unread completed answer" title="Có câu trả lời hoàn tất chưa đọc">!</span>}
              </span>
              <span className="thread-row-meta">
                {shortWorkspace(thread.cwd)} · {formatTime(thread.updatedAt)}
              </span>
            </button>
            <ConversationActions title={threadTitle(thread)} archiveDisabled={!canArchive(thread)}
              isLeader={conversationGroup(groups.snapshot, thread.id)?.leaderThreadId === thread.id}
              leaderDisabled={groupsDisabled || groups.leaderSaving}
              onLeader={conversationGroup(groups.snapshot, thread.id) ? () => {
                const group = conversationGroup(groups.snapshot, thread.id)!
                void groups.leader(group.id, group.leaderThreadId === thread.id ? null : thread.id)
              } : undefined}
              onRename={() => onRename(thread)} onArchive={() => onArchive(thread)} onMove={onMove} />
            </div>
          )} />
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
  const conversational = item.type === 'userMessage' || item.type === 'agentMessage' || item.type === 'plan'
  const attachmentPreviews = Array.isArray(item.attachmentPreviews)
    ? item.attachmentPreviews.filter((entry): entry is { name: string; previewUrl: string } => Boolean(entry)
      && typeof (entry as { name?: unknown }).name === 'string'
      && typeof (entry as { previewUrl?: unknown }).previewUrl === 'string')
    : []
  const imageCount = Array.isArray(item.content)
    ? item.content.filter(entry => ['image', 'localImage'].includes(String(object(entry).type ?? ''))).length
    : 0

  if (conversational) {
    const orchestrationMessage = item.type === 'userMessage' && text.startsWith('[Codex Remote · ')
    return (
      <article className={`message ${item.type === 'userMessage' ? 'message-user' : 'message-agent'}${orchestrationMessage ? ' message-orchestration' : ''}`}>
        <span className="message-author">{orchestrationMessage ? 'Codex Remote · Điều phối' : itemLabel(item)}</span>
        {text && (item.type === 'userMessage' ? <div className="message-plain-text">{text}</div> : <MarkdownMessage streaming={item.streaming === true} onOpenFile={onOpenFile} onOpenLink={onOpenLink}>{text}</MarkdownMessage>)}
        {Array.isArray(item.attachmentFiles) && <div className="message-files">{item.attachmentFiles.map((file, index) => <span key={index}>▤ {String(object(file).name ?? 'File')}</span>)}</div>}
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
    && (itemText(item) === pendingMessage.text || Boolean(pendingMessage.files?.length))) : -1
  const showPending = Boolean(pendingMessage) && pendingMatch < 0
  const pendingItem = pendingMessage ? {
    type: 'userMessage',
    text: pendingMessage.text,
    attachmentPreviews: pendingMessage.images ?? [],
    attachmentFiles: pendingMessage.files ?? [],
  } : null
  return (
    <section className={`conversation-stream${rows.length === 0 && !pendingMessage && !activeTurnId ? ' is-empty' : ''}`} aria-live="polite">
      {!thread.historyCacheTruncated && rows.some(item => item.historyItemTruncated) && <p className="history-note">Phần đầu nội dung cũ đã được rút gọn để giữ bản xem trong giới hạn 5 MB. Lịch sử gốc vẫn giữ nguyên.</p>}
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

export function RequestCard({ request, csrf, onResolved }: {
  request: PendingRequest
  csrf: string
  onResolved: (key: string) => void
}) {
  return request.method === 'item/tool/requestUserInput'
    ? <QuestionRequest request={request} csrf={csrf} onResolved={onResolved} />
    : <ApprovalRequestCard request={request} csrf={csrf} onResolved={onResolved} />
}

function ApprovalRequestCard({ request, csrf, onResolved }: {
  request: PendingRequest
  csrf: string
  onResolved: (key: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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

  return (
    <article className="request-card">
      <div className="request-kicker">Action needed</div>
      <h3>{request.method === 'item/commandExecution/requestApproval' ? 'Approve command?' : request.method === 'item/fileChange/requestApproval' ? 'Approve file changes?' : request.method === 'item/permissions/requestApproval' ? 'Grant additional permissions?' : 'Codex needs input'}</h3>
      {typeof request.params.reason === 'string' && <p>{request.params.reason}</p>}
      {typeof request.params.command === 'string' && <pre className="command-block"><code>$ {request.params.command}</code></pre>}
      {typeof request.params.cwd === 'string' && <p className="request-path">in {request.params.cwd}</p>}

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
        {!isApproval && !isPermissions && (
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
  const [enterToSend] = useState(enterSendsMessage)
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [threads, setThreads] = useState<Thread[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newConversation, setNewConversation] = useScreenState<NewConversation>('new-conversation', EMPTY_NEW_CONVERSATION)
  const [draftOpen, setDraftOpen] = useScreenState('new-conversation-open', false)
  const draftOpenRef = useRef(draftOpen)
  draftOpenRef.current = draftOpen
  const draftRef = useRef(newConversation)
  draftRef.current = newConversation
  const composerKey = draftOpen ? NEW_CONVERSATION_KEY : selectedId
  const [skillsOpen, setSkillsOpen] = useState(false)
  const closeSkills = useCallback(() => setSkillsOpen(false), [])
  const [selectedSkills, setSelectedSkills, setThreadSkills, clearSkills] = useThreadState<SkillSelection[]>(composerKey, EMPTY_SKILLS, 'draft-skills')
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
  const [attachments, setAttachments, clearAttachments, imagesReady] = useDraftImages(composerKey, previewUrls)
  const [uploadStatus, setUploadStatus, , clearUploadStatus] = useThreadState(composerKey, '')
  const [sendError, setSendError, , clearSendErrors] = useThreadState(composerKey, '')
  const [pending, setPending] = useState<PendingRequest[]>([])
  const pendingRequests = useRef(new PendingRequests())
  const [models, setModels] = useState<ModelOption[]>([])
  const { settings, update: setConversationSettings, migrateLegacy, saveForThread: saveThreadSettings, saveError: settingsSaveError } = useConversationSettings(composerKey)
  const { mode, setMode, saveForThread: saveThreadMode, saveError: modeSaveError } = useCollaborationMode(composerKey)
  const selectedModel = settings?.model ?? null
  const selectedEffort = settings?.effort ?? null
  const [yoloMode, setYoloMode, yoloSaveError] = useYoloPreference()
  const [commandNotice, setCommandNotice] = useScreenState<CommandNotice | null>('command-notice', null)
  const [slashIndex, setSlashIndex] = useState(0)
  const [activeTurnId, , setThreadTurn, clearThreadTurns, activeTurns] = useThreadState<string | null>(selectedId, null)
  const [composer, setComposer, , clearDrafts] = useThreadState(composerKey, '', 'drafts')
  const [drawerOpen, setDrawerOpen] = useScreenState('drawer', false)
  const [connected, setConnected] = useState(false)
  const [cacheReady, setCacheReady] = useState(false)
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== 'hidden')
  const [online, setOnline] = useState(() => navigator.onLine)
  const groups = useConversationGroups(Boolean(session?.csrf && online && pageVisible), session?.csrf)
  const [teamRevision, setTeamRevision] = useState(0)
  const { refresh: refreshGroups, clear: clearGroups } = groups
  const [installPrompt, setInstallPrompt] = useState<PwaInstallPrompt | null>(null)
  const [updateWorker, setUpdateWorker] = useState<ServiceWorker | null>(null)
  const [notificationsEnabled, setNotificationsEnabled] = useState(false)
  const [notificationBusy, setNotificationBusy] = useState(false)
  const [operationBusy, setBusy] = useState(false)
  const [sending, setSending] = useState<Record<string, boolean>>({})
  const busy = operationBusy || !imagesReady || Boolean(composerKey && sending[composerKey])
  const [error, setError] = useState('')
  const [fileViewer, setFileViewer] = useScreenState<LocalFileReference | null>('file-viewer', null)
  const [leaderViewId, setLeaderViewId] = useState<string | null>(null)
  const [fileBrowserPath, setFileBrowserPath] = useScreenState<string | null>('file-browser', null)
  const browserScope = selectedId ?? 'new'
  const [browserTargets, setBrowserTargets] = useState<Record<string, string | null>>(() => window.self === window.top ? readScreenState('browser-targets', {}) : {})
  useEffect(() => { if (window.self === window.top) writeScreenState('browser-targets', browserTargets) }, [browserTargets])
  const localhostPreview = browserTargets[browserScope] ?? null
  const setLocalhostPreview = useCallback((url: string | null) => {
    setBrowserTargets(current => ({ ...current, [browserScope]: url }))
  }, [browserScope, setBrowserTargets])
  const [renamingThread, setRenamingThread] = useState<Thread | null>(null)
  const { counts: unreadCounts, refresh: refreshUnread, clear: clearUnread } = useUnreadMessages(
    threads,
    session && pageVisible && historyReady && thread?.id === selectedId && !drawerOpen &&
      !fileViewer && !fileBrowserPath && localhostPreview === null && !renamingThread ? selectedId : null,
    Boolean(session?.csrf && online && pageVisible && cacheReady),
    session?.csrf,
    thread ? conversationItems(thread, transcripts[thread.id] ?? EMPTY_ITEMS)
      .filter(item => item.type === 'agentMessage' && !item.streaming && item.phase !== 'commentary' && itemText(item).trim())
      .map(item => `reply:${item.turnId}`) : [],
  )
  const closeRename = useCallback(() => setRenamingThread(null), [])
  const applyThreadName = useCallback((id: string, name: string | null) => {
    setThreads(current => current.map(item => item.id === id && item.name !== name ? { ...item, name } : item))
    setThread(current => current?.id === id && current.name !== name ? { ...current, name } : current)
  }, [])
  const selectedRef = useRef<string | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const resizeComposer = useCallback(() => {
    const textarea = composerRef.current
    if (!textarea) return
    textarea.style.overflowY = 'hidden'
    textarea.style.height = 'auto'
    // Leave room for fractional line-height rounding before applying the cap.
    textarea.style.height = `${Math.min(textarea.scrollHeight + 1, 180)}px`
    textarea.style.overflowY = textarea.scrollHeight > textarea.clientHeight ? 'auto' : 'hidden'
  }, [])
  const attachComposer = useCallback((textarea: HTMLTextAreaElement | null) => {
    composerRef.current = textarea
    if (!textarea) return
    resizeComposer()
    let width = textarea.getBoundingClientRect().width
    const observer = new ResizeObserver(() => {
      const nextWidth = textarea.getBoundingClientRect().width
      if (nextWidth === width) return
      width = nextWidth
      resizeComposer()
    })
    observer.observe(textarea)
    return () => {
      observer.disconnect()
      composerRef.current = null
    }
  }, [resizeComposer])
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
  const closeLocalhostPreview = useCallback(() => setLocalhostPreview(null), [setLocalhostPreview])
  const openFile = useCallback((reference: LocalFileReference) => {
    setFileViewer(reference)
  }, [])
  const openLink = useCallback((reference: WebLinkReference) => {
    setFileViewer(null)
    setLocalhostPreview(reference.url)
  }, [setLocalhostPreview])
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
    draftOpenRef.current = false
    setDraftOpen(false)
    setSkillsOpen(false)
    setSelectedId(target.id)
    selectedRef.current = target.id
    if (!preserveVisibleCache) setDrawerOpen(false)
    setError('')
    if (!preserveVisibleCache) setCommandNotice(null)
    setThread(cached ? { ...target, ...cached, name: target.name ?? cached.name } : { ...target, turns: [], historyUnavailable: true })
    setHistoryReady(Boolean(cached))
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
        migrateLegacy(cached.selectedId, cached.thread?.model)
        if (!draftOpenRef.current) {
          setSelectedId(cached.selectedId)
          selectedRef.current = cached.selectedId
          setThread(cached.thread)
          setHistoryReady(Boolean(cached.thread))
        }
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
        setPending(pendingRequests.current.snapshot(pendingResponse))
        setModels(modelResponse.data)
        const preferred = items.find((item) => item.id === cached?.selectedId) ?? items[0]
        if (!draftOpenRef.current && preferred && (!selectedRef.current || selectedRef.current === cached?.selectedId)) await openThread(preferred, session.csrf, preferred.id === cached?.selectedId)
      } catch (requestError) {
        if (!cancelled && !cached) setError(errorMessage(requestError))
      }
    })()
    return () => { cancelled = true }
  }, [session, refreshThreads, openThread, setThreadTurn, migrateLegacy])

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
        setPending(pendingRequests.current.snapshot(requests))
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
    const stop = scheduleHistorySync(connected, () => void sync(), () => void refreshThreads().catch(() => undefined))
    return () => { cancelled = true; stop() }
  }, [pageVisible, online, connected, session, refreshThreads, setThreadTurn])

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
    source.onopen = () => { setConnected(true); void refreshGroups() }
    source.onerror = () => { assembler.reset(); setConnected(false) }
    source.addEventListener('stream-state', message => {
      try {
        const state = JSON.parse((message as MessageEvent<string>).data) as { epoch: string; reset: boolean }
        if (typeof state.epoch !== 'string') return
        if (state.reset || (eventEpoch.current && eventEpoch.current !== state.epoch)) eventCursor.current = 0
        eventEpoch.current = state.epoch
        pendingRequests.current.beginEpoch(state.epoch)
        setPending(pendingRequests.current.values())
        // Replay is bounded; a pending question can be older than the retained events.
        void api.pending().then(snapshot => {
          if (epoch === sessionEpoch.current) setPending(pendingRequests.current.snapshot(snapshot))
        }).catch(() => {})
      } catch { /* Old gateways need not send this handshake. */ }
    })
    const receive = (data: string) => {
      if (epoch !== sessionEpoch.current) return
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
      if (event.type === 'request' || event.type === 'request-resolved') {
        setPending(pendingRequests.current.event(event))
      }
      queued.push(event)
      if (flushTimer === undefined) flushTimer = setTimeout(flush, 50)
    }
    const handleEvent = (event: RemoteEvent) => {
      const method = eventMethod(event)
      if (method === 'conversation-groups/changed') void refreshGroups()
      if (method === 'orchestration/changed') setTeamRevision(value => value + 1)
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
      if (method === 'reply/completed' || method === 'read-state/changed') void refreshUnread()
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
  }, [keepLive, online, cacheReady, session, refreshThreads, setThreadTurn, confirmStop, applyThreadName, refreshUnread, refreshGroups])

  const selectedPending = useMemo(() => pending.filter((request) => {
    const id = request.params.threadId
    return !draftOpen && (!selectedId || typeof id !== 'string' || id === selectedId)
  }), [pending, selectedId, draftOpen])
  const effectiveModel = selectedModel ?? thread?.model ?? models.find((model) => model.isDefault)?.model ?? null
  const effectiveModelOption = models.find((model) => model.model === effectiveModel)
  const effortOptions = effectiveModelOption?.supportedReasoningEfforts ?? []
  const effectiveEffort = selectedEffort ?? effectiveModelOption?.defaultReasoningEffort ?? null
  const latestAnswer = thread ? conversationItems(thread, transcripts[thread.id] ?? EMPTY_ITEMS)
    .filter(item => ['userMessage', 'agentMessage', 'plan'].includes(String(item.type))).at(-1) : undefined
  const planTurnStatus = thread?.turns?.find(turn => turn.id === latestAnswer?.turnId)?.status
    ?? (thread?.latestTurn?.id === latestAnswer?.turnId ? thread?.latestTurn?.status : undefined)
  const planReady = mode === 'plan' && planTurnStatus === 'completed' && !activeTurnId && !busy && latestAnswer && !latestAnswer.streaming &&
    (latestAnswer.type === 'plan' || (latestAnswer.type === 'agentMessage' && itemText(latestAnswer).includes('<proposed_plan>')))
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
    const frame = requestAnimationFrame(resizeComposer)
    return () => cancelAnimationFrame(frame)
  }, [composer, thread?.id, resizeComposer])

  function createThread(groupId?: string) {
    if (!session || busy || sendingLocks.current.has(NEW_CONVERSATION_KEY)) return
    const previous = currentView.current
    if (previous.thread && previous.ready) threadCache.current.remember(previous.thread)
    historyRequest.current?.abort()
    openSequence.current++
    selectedRef.current = null
    setSelectedId(null)
    setThread(null)
    setHistoryReady(false)
    setHistoryLoading(false)
    draftOpenRef.current = true
    setDraftOpen(true)
    if (groupId !== undefined) setNewConversation(current => ({ ...current, groupId }))
    setDrawerOpen(false)
    setSkillsOpen(false)
    setCommandNotice(null)
    setError('')
  }

  function rememberNewThread(created: Thread) {
    const next = { ...draftRef.current, thread: created }
    draftRef.current = next
    setNewConversation(next)
    writeScreenState('new-conversation', next)
    flushScreenState()
  }

  function showCommandNotice(title: string, lines: CommandNotice['lines']) {
    setCommandNotice({ title, lines })
    setComposer('')
    setError('')
  }

  async function executeSlashCommand(name: string, argument: string) {
    switch (name) {
      case 'plan':
        if (activeTurnId || busy) { setError('Wait for the current turn to finish before changing mode. Your draft is kept.'); return }
        if (argument) { await sendInstruction(argument, 'plan'); return }
        setMode('plan')
        showCommandNotice('Plan mode', [{ label: 'Next message', value: 'Codex will investigate and propose a plan before implementation.' },
          { label: 'Switch back', value: 'Use the Plan/Code button or Shift+Tab.' }])
        return
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
          { label: 'Effort', value: effectiveEffort || 'Model default' },
          { label: 'Mode', value: mode === 'plan' ? 'Plan' : 'Code' },
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
        const nextSettings = settingsForModel(selected, effectiveEffort)
        setConversationSettings(nextSettings)
        showCommandNotice('Model changed', [
          { label: 'Model', value: selected.displayName || selected.model },
          { label: 'Applied', value: 'Future turns in this conversation' },
          { label: 'Effort', value: nextSettings.effort || 'Model default' },
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
        setConversationSettings({ model: effectiveModel, effort: selected.reasoningEffort })
        showCommandNotice('Reasoning effort changed', [
          { label: 'Model', value: effectiveModel },
          { label: 'Effort', value: selected.reasoningEffort },
          { label: 'Applied', value: 'Future turns in this conversation' },
        ])
        return
      }
      case 'skills':
        setComposer('')
        setSkillsOpen(true)
        return
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
    if (!session || (!thread && !draftOpen) || (!composer.trim() && attachments.length === 0)) return
    if (!draftOpen && !historyReady) { setSendError('Wait for this conversation to load. Your draft is kept.'); return }
    if (!online || !session.csrf) { setSendError('Reconnecting… Your draft is kept. Send it when the connection returns.'); return }
    const instruction = composer
    const slashCommand = parseSlashCommand(instruction)
    if (slashCommand) {
      await executeSlashCommand(slashCommand.name, slashCommand.argument)
      return
    }
    await sendInstruction(instruction)
  }

  async function sendInstruction(instruction: string, turnMode: CollaborationMode = mode) {
    if (!session || (!thread && !draftOpen) || (!instruction.trim() && attachments.length === 0)) return
    if ((!draftOpen && !historyReady) || !online || !session.csrf) { setSendError('Wait for the conversation to connect. Your draft is kept.'); return }
    if (!composerKey || busy || sendingLocks.current.has(composerKey)) return
    if (draftOpen && newConversation.thread && (activeTurns[newConversation.thread.id] || sendingLocks.current.has(newConversation.thread.id))) { setSendError('This conversation is already starting or working. Wait for it to finish before retrying.'); return }
    if (draftOpen && !newConversation.name.trim()) { setSendError('Give this conversation a name before sending.'); return }
    if (activeTurnId) {
      setError('Your draft is saved here. Send it when this turn finishes, or stop the turn first.')
      return
    }
    setMode(turnMode)
    setCommandNotice(null)
    if (effectiveModel) setConversationSettings({ model: effectiveModel, effort: effectiveEffort })
    const lockKey = composerKey
    sendingLocks.current.add(lockKey)
    setSendError('')
    setSending(current => ({ ...current, [lockKey]: true }))
    if (!draftOpen) setComposer('')
    setError('')
    let sendingThreadId = thread?.id ?? newConversation.thread?.id ?? null
    const reserveNewThread = (created: Thread) => {
      sendingThreadId = created.id
      sendingLocks.current.add(created.id)
      setSending(current => ({ ...current, [created.id]: true }))
    }
    if (draftOpen && newConversation.thread) reserveNewThread(newConversation.thread)
    const epoch = sessionEpoch.current
    const sendingSkills = selectedSkills
    const sendingImages = attachments
    if (!draftOpen) setAttachments([])
    const sent: SentMessage = {
      text: instruction,
      files: sendingImages.filter(image => !isPreviewImage(image.file)).map(image => ({ name: image.file.name, size: image.file.size })),
      images: sendingImages.filter(image => isPreviewImage(image.file)).map(image => ({ name: image.file.name, previewUrl: image.previewUrl })),
    }
    if (sendingThreadId) setSentMessages(current => ({ ...current, [sendingThreadId!]: sent }))
    const uploadedIds: string[] = []
    try {
      for (const [index, image] of sendingImages.entries()) {
        setUploadStatus(`Uploading file ${index + 1} of ${sendingImages.length} · ${image.file.name}`)
        uploadedIds.push((await api.uploadAttachment(image.file, session.csrf)).id)
        if (epoch !== sessionEpoch.current) return
      }
      let target = thread
      if (draftOpen) {
        setUploadStatus('Creating conversation…')
        target = await prepareNewConversation(newConversation, session.workspaces[0]?.id ?? '0', session.csrf, yoloMode, created => {
          if (epoch !== sessionEpoch.current) throw new Error('Session changed')
          reserveNewThread(created)
          rememberNewThread(created)
        })
        if (epoch !== sessionEpoch.current) return
        sendingThreadId = target.id
        saveThreadMode(target.id, turnMode)
        if (effectiveModel) saveThreadSettings(target.id, { model: effectiveModel, effort: effectiveEffort })
        setSentMessages(current => ({ ...current, [target!.id]: sent }))
      }
      if (!target) throw new Error('Conversation is unavailable')
      const targetId = target.id
      setUploadStatus('Starting Codex…')
      const response = await api.startTurn(targetId, instruction, session.csrf, {
        model: effectiveModel ?? undefined,
        effort: effectiveEffort ?? undefined,
        fullAccess: yoloMode,
        collaborationMode: turnMode,
        attachmentIds: uploadedIds,
        skills: sendingSkills,
      })
      if (epoch !== sessionEpoch.current) return
      setThreadSkills(lockKey, current => current.filter(skill => !sendingSkills.some(sent => sent.path === skill.path)))
      if (!completedTurns.current.has(response.turn.id)) {
        setSentMessages(current => ({ ...current, [targetId]: { ...sent, turnId: response.turn.id } }))
        setThreadTurn(targetId, response.turn.id)
      }
      if (draftOpen) {
        setComposer('')
        setAttachments([])
        draftRef.current = EMPTY_NEW_CONVERSATION
        setNewConversation(EMPTY_NEW_CONVERSATION)
        saveThreadMode(NEW_CONVERSATION_KEY, 'default')
        writeScreenState('new-conversation', EMPTY_NEW_CONVERSATION)
        // Navigation during a send must not pull the user away from another conversation.
        if (draftOpenRef.current) {
          draftOpenRef.current = false
          setDraftOpen(false)
          setSkillsOpen(false)
          openSequence.current++
          selectedRef.current = targetId
          setSelectedId(targetId)
          setThread(target)
          setHistoryReady(true)
          setHistoryLoading(false)
        }
        void refreshGroups()
        void refreshThreads().catch(() => undefined)
      }
    } catch (requestError) {
      await Promise.allSettled(uploadedIds.map(id => api.deleteAttachment(id, session.csrf)))
      if (epoch !== sessionEpoch.current) return
      setSentMessages(current => { const next = { ...current }; if (sendingThreadId) delete next[sendingThreadId]; return next })
      if (!draftOpen) setComposer(current => current ? `${instruction}\n${current}` : instruction)
      if (!draftOpen) setAttachments(current => [...sendingImages, ...current])
      setSendError(errorMessage(requestError))
    } finally {
      if (epoch === sessionEpoch.current) {
        setUploadStatus('')
        sendingLocks.current.delete(lockKey)
        if (draftOpen && sendingThreadId) sendingLocks.current.delete(sendingThreadId)
        setSending(current => {
          const next = { ...current }
          delete next[lockKey]
          if (draftOpen && sendingThreadId) delete next[sendingThreadId]
          return next
        })
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
      if (attachments.length + accepted.length >= MAX_COMPOSER_FILES) {
        message = `You can attach up to ${MAX_COMPOSER_FILES} files per turn.`
        break
      }
      if (file.size > MAX_COMPOSER_FILE_BYTES) {
        message = `${file.name} exceeds the 25 MB limit.`
        continue
      }
      const previewUrl = isPreviewImage(file) ? URL.createObjectURL(file) : ''
      if (previewUrl) previewUrls.current.add(previewUrl)
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
    clearGroups()
    clearSkills()
    setSkillsOpen(false)
    draftOpenRef.current = false
    setDraftOpen(false)
    draftRef.current = EMPTY_NEW_CONVERSATION
    setNewConversation(EMPTY_NEW_CONVERSATION)
    setBrowserTargets({})
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
    setFileBrowserPath(null)
    setRenamingThread(null)
    for (const url of previewUrls.current) URL.revokeObjectURL(url)
    previewUrls.current.clear()
    setAttachments([])
    pendingRequests.current = new PendingRequests()
    setPending([])
    setModels([])
    setCommandNotice(null)
  }

  async function installApp() {
    if (!installPrompt) return
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    if (choice.outcome === 'accepted') setInstallPrompt(null)
  }

  function reloadApp() {
    flushScreenState()
    if (updateWorker) updateWorker.postMessage({ type: 'SKIP_WAITING' })
    else window.location.reload()
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
  const selectedGroup = conversationGroup(groups.snapshot, thread?.id)
  const hasTeam = !draftOpen && Boolean(thread && selectedGroup?.leaderThreadId)
  const showLeader = hasTeam && leaderViewId === thread?.id

  return (
    <div className="app-shell">
      <ThreadSidebar
        threads={threads}
        unreadCounts={unreadCounts}
        activeTurns={activeTurns}
        sending={sending}
        selectedId={selectedId}
        open={drawerOpen}
        busy={busy}
        onClose={() => setDrawerOpen(false)}
        onCreate={groupId => void createThread(groupId)}
        onLock={() => void logout()}
        onReload={reloadApp}
        notificationsEnabled={notificationsEnabled}
        notificationBusy={notificationBusy}
        onToggleNotifications={() => void toggleNotifications()}
        onSelect={(target) => void openThread(target).catch((requestError) => setError(errorMessage(requestError)))}
        onRename={setRenamingThread}
        onArchive={target => void archive(target)}
        canArchive={canArchive}
        workspaceLabel={session.workspaces[0]?.label || shortWorkspace(session.workspaces[0]?.path ?? '') || 'Workspace'}
        groups={groups}
        groupsDisabled={!online || !session.csrf}
        onOpenContext={path => { setDrawerOpen(false); openFile({ path }) }}
        onOpenVault={path => { setDrawerOpen(false); setFileBrowserPath(path) }}
      />

      <main className="workspace-shell">
        <header className="workspace-header">
          <button className="icon-button mobile-only" onClick={() => setDrawerOpen(true)} aria-label="Open conversations">☰</button>
          <div className="workspace-title">
            <div className="workspace-title-line">
              <h1>{draftOpen ? 'New conversation' : thread ? threadTitle(thread) : 'Codex Remote'}</h1>
              {!draftOpen && thread && selectedGroup && <button type="button" className={`leader-toggle ${selectedGroup.leaderThreadId === thread.id ? 'is-leader' : ''}`}
                disabled={!online || !session.csrf || groups.leaderSaving} aria-pressed={selectedGroup.leaderThreadId === thread.id}
                aria-label={selectedGroup.leaderThreadId === thread.id ? 'Bỏ vai trò leader' : 'Đặt làm leader'}
                title={selectedGroup.leaderThreadId === thread.id ? 'Leader của folder · bấm để bỏ vai trò' : 'Đặt convo này làm leader của folder'}
                onClick={() => void groups.leader(selectedGroup.id, selectedGroup.leaderThreadId === thread.id ? null : thread.id)}>{selectedGroup.leaderThreadId === thread.id ? '★' : '☆'}</button>}
            </div>
            <p>
              {thread ? <>{shortWorkspace(thread.cwd)}{effectiveModel ? ` · ${effectiveModel}` : ''}{effectiveEffort ? ` · ${effectiveEffort}` : ''}</> : 'Private workspace agent'}
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
          <button type="button" className={!showLeader ? 'is-active' : ''} aria-current={!showLeader ? 'page' : undefined} onClick={() => setLeaderViewId(null)}>Conversation</button>
          <button type="button" onClick={() => setLocalhostPreview('')}>Browser</button>
          {hasTeam && <button type="button" className={showLeader ? 'is-active' : ''} aria-current={showLeader ? 'page' : undefined} onClick={() => setLeaderViewId(thread!.id)}>Leader</button>}
          <button className="files-tab" type="button" disabled={!thread} onClick={() => thread && setFileBrowserPath(thread.cwd)}>Files</button>
        </nav>

        <div className="workspace-notices">
          {groups.leaderError && <p className="error-banner" role="alert">{groups.leaderError}</p>}
          {updateWorker && (
            <div className="update-banner" role="status">
              <div><strong>Update ready</strong><span>A fresher Codex Remote is available.</span></div>
              <button className="primary-button" onClick={reloadApp}>Reload</button>
            </div>
          )}
          {error && <div className="error-banner global-error" role="alert"><span>{error}</span><button onClick={() => setError('')}>×</button></div>}
          {sendError && <div className="error-banner global-error" role="alert"><span>{sendError}</span><button onClick={() => setSendError('')}>×</button></div>}
          {yoloSaveError && <p className="error-banner" role="alert">{yoloSaveError}</p>}
        </div>

        {hasTeam && thread && selectedGroup && <section className="leader-page" aria-label="Leader workspace" hidden={!showLeader}>
          <ConversationTeam key={`${thread.id}:${selectedGroup.id}`} threadId={thread.id} group={selectedGroup} threads={threads}
            csrf={session.csrf} enabled={online && pageVisible && showLeader} revision={teamRevision} onOpen={id => {
              setLeaderViewId(null)
              const target = threads.find(thread => thread.id === id)
              void (target ? openThread(target) : api.thread(id).then(response => openThread(response.thread))).catch(error => setError(errorMessage(error)))
            }} />
        </section>}

        {!showLeader && <TranscriptViewport key={`${selectedId}-conversation`} viewKey={`${selectedId}-conversation`} ready={Boolean(thread) && historyReady} positions={readingPositions.current}>
          {draftOpen && <section className="new-conversation-setup" aria-label="New conversation setup">
            <div className="new-conversation-heading"><h2>A fresh conversation</h2>
              <button type="button" className="quiet-button" disabled={busy} onClick={() => {
                if (threads[0]) void openThread(threads[0]).catch(reason => setError(errorMessage(reason)))
                else { draftOpenRef.current = false; setDraftOpen(false) }
              }}>Cancel</button>
            </div>
            <p>Name it, choose a folder, then send your first message.</p>
            <div className="new-conversation-fields">
              <label htmlFor="new-conversation-name">Conversation name
                <input id="new-conversation-name" form="message-composer" autoFocus required={!parseSlashCommand(composer)} maxLength={200} placeholder="What are you working on?" value={newConversation.name} disabled={busy}
                  onChange={event => setNewConversation(current => ({ ...current, name: event.target.value }))} />
              </label>
              <label htmlFor="new-conversation-folder">Conversation folder
                <select aria-label="Conversation folder" id="new-conversation-folder" value={newConversation.groupId} disabled={busy || !groups.snapshot} onChange={event => setNewConversation(current => ({ ...current, groupId: event.target.value }))}>
                  <option value="">Ungrouped</option>
                  {newConversation.groupId && !groups.snapshot?.groups.some(group => group.id === newConversation.groupId) && <option value={newConversation.groupId}>Folder unavailable — choose another</option>}
                  {groups.snapshot?.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
              </label>
            </div>
            {groups.error && <p role="alert">{groups.error} <button className="quiet-button" type="button" onClick={() => void refreshGroups()}>Retry</button></p>}
            <p className="new-conversation-hint">Created only when you send. Your draft stays on this device.</p>
          </section>}
          {!draftOpen && !thread && threads.length === 0 && (
            <div className="empty-state">
              <div className="empty-orbit" aria-hidden="true">✦</div>
              <h2>Start your first conversation</h2>
              <p>Codex will load the repository instructions before it begins.</p>
              <button className="primary-button" onClick={() => void createThread()} disabled={busy}>New conversation</button>
            </div>
          )}
          {!draftOpen && !thread && threads.length > 0 && <div className="loading-inline"><span className="spinner" /> Loading conversation…</div>}
          {thread && !historyReady && <div className="loading-inline" role="status">
            {historyLoading ? <><span className="spinner" />Loading conversation…</> : <><span>{online ? 'Conversation could not be loaded.' : 'This conversation is not cached on this device yet.'}</span><button type="button" className="quiet-button" disabled={!online} onClick={() => void openThread(thread).catch(reason => setError(errorMessage(reason)))}>Retry</button></>}
          </div>}
          {thread?.historyCacheTruncated && <p className="history-note">{thread.historyTruncation === 'head' ? 'Hội thoại vượt giới hạn 5 MB: phần cũ nhất đã được rút gọn trong bản xem/cache. Lịch sử gốc vẫn giữ nguyên.' : thread.historyTruncation === 'tail' ? 'Hội thoại vượt giới hạn 5 MB: phần cuối đã được rút gọn trong bản xem/cache. Lịch sử gốc vẫn giữ nguyên.' : 'Showing recent cached messages. Full history refreshes when connected.'}</p>}
          {thread && historyReady && <Conversation thread={thread} activeTurnId={activeTurnId} items={transcripts[thread.id] ?? EMPTY_ITEMS} pendingMessage={sentMessages[thread.id]} yoloMode={yoloMode} onOpenFile={openFile} onOpenLink={openLink} onSuggestion={suggestPrompt} />}
        </TranscriptViewport>}

        {selectedPending.length > 0 && <section className="pending-requests" aria-label="Questions and approvals">
          {selectedPending.map((request) => (
            <RequestCard
              key={request.key}
              request={request}
              csrf={session.csrf}
              onResolved={(key) => setPending(pendingRequests.current.dismiss(key))}
            />
          ))}
        </section>}

        {(thread || draftOpen) && (
          <form id="message-composer" className="composer" onSubmit={submitInstruction}
            onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
            onDrop={event => {
              if (!event.dataTransfer.files.length) return
              event.preventDefault()
              addImages([...event.dataTransfer.files])
            }}
            onPaste={event => {
              const images = [...event.clipboardData.files]
              if (event.clipboardData.getData('text/plain')) return
              if (!images.length) return
              if (!event.clipboardData.getData('text/plain')) event.preventDefault()
              addImages(images)
            }}>
            <div className="composer-controls" aria-label="Turn settings">
              <button type="button" className={`composer-mode ${mode === 'plan' ? 'is-plan' : ''}`}
                aria-label="Plan mode" aria-pressed={mode === 'plan'} title="Switch Plan/Code · Shift+Tab" disabled={busy || Boolean(activeTurnId)}
                onClick={() => { setMode(mode === 'plan' ? 'default' : 'plan'); setCommandNotice(null) }}>{mode === 'plan' ? 'Plan' : 'Code'}</button>
              <select
                className="composer-model"
                aria-label="Model for future turns"
                value={effectiveModel ?? ''}
                disabled={(draftOpen && busy) || models.length === 0}
                onChange={(event) => {
                  const selected = models.find((model) => model.model === event.target.value)
                  if (!selected) return
                  setConversationSettings(settingsForModel(selected, effectiveEffort))
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
                value={effectiveEffort ?? ''}
                disabled={(draftOpen && busy) || !effectiveModel || effortOptions.length === 0}
                onChange={(event) => {
                  const selected = effortOptions.find((entry) => entry.reasoningEffort === event.target.value)
                  if (!selected || !effectiveModel) return
                  setConversationSettings({ model: effectiveModel, effort: selected.reasoningEffort })
                  setCommandNotice(null)
                  setError('')
                }}
              >
                {effectiveEffort && !effortOptions.some(option => option.reasoningEffort === effectiveEffort) && <option value={effectiveEffort}>{effectiveEffort} (unavailable)</option>}
                {effortOptions.length === 0 && !effectiveEffort && <option value="">Effort</option>}
                {effortOptions.map((entry) => (
                  <option value={entry.reasoningEffort} key={entry.reasoningEffort}>{entry.reasoningEffort}</option>
                ))}
              </select>
              <button type="button" className="composer-status" disabled={busy} onClick={() => void executeSlashCommand('status', '')}>Usage & status</button>
            </div>
            {skillsOpen && <SkillsPicker key={composerKey} threadId={draftOpen ? undefined : thread?.id} workspaceId={session.workspaces[0]?.id} selected={selectedSkills} onChange={setSelectedSkills} onClose={closeSkills} triggerRef={composerRef} disabled={busy} />}
            {selectedSkills.length > 0 && <div className="selected-skills" aria-label="Selected skills">{selectedSkills.map(skill => <button type="button" key={skill.path} disabled={busy} aria-label={`Remove skill ${skill.name}`} onClick={() => setSelectedSkills(current => current.filter(item => item.path !== skill.path))}>{skill.name} ×</button>)}</div>}
            {planReady && <div className="plan-implementation"><span>Kế hoạch đã sẵn sàng.</span><button type="button" className="primary-button"
              disabled={!online || !historyReady || Boolean(composer.trim()) || attachments.length > 0}
              onClick={() => void sendInstruction('Implement the plan.', 'default')}>Implement plan</button></div>}
            {modeSaveError && <p role="status" className="attachment-hint">{modeSaveError}</p>}
            {settingsSaveError && <p role="status" className="attachment-hint">{settingsSaveError}</p>}
            {commandNotice && <LocalCommandResult notice={commandNotice} onClose={() => setCommandNotice(null)} />}
            <SlashMenu
              activeIndex={slashIndex}
              options={slashOptions}
              onChoose={(option) => {
                setComposer(option.fill)
                requestAnimationFrame(() => composerRef.current?.focus())
              }}
            />
            {attachments.length > 0 && <div className="composer-images" aria-label="Attached files">
              {attachments.map(image => <figure key={image.key}>
                <>{isPreviewImage(image.file) ? <img src={image.previewUrl} alt={image.file.name} /> : <span className="attachment-file-icon" aria-hidden="true">▤</span>}</>
                <figcaption title={image.file.name}>{image.file.name} · {(image.file.size / 1024 / 1024).toFixed(1)} MB</figcaption>
                <button type="button" onClick={() => removeImage(image.key)} disabled={busy} aria-label={`Remove ${image.file.name}`}>×</button>
              </figure>)}
            </div>}
            {uploadStatus && <p className="upload-status" role="status"><span className="spinner" />{uploadStatus}</p>}
            {attachments.length > 0 && !busy && <p className="attachment-hint">{attachments.length}/4 files ready · up to 25 MB each · send with or without a message</p>}
            <div className="composer-surface">
              <input ref={attachmentInputRef} className="sr-only" type="file" multiple onChange={chooseImages} />
              <button className="attach-button" type="button" onClick={() => attachmentInputRef.current?.click()} disabled={busy || attachments.length >= MAX_COMPOSER_FILES} aria-label="Attach files" title="Attach files">＋</button>
              <label htmlFor="instruction" className="sr-only">Instruction for Codex</label>
              <textarea
                ref={attachComposer}
                id="instruction"
                enterKeyHint="enter"
                value={composer}
                readOnly={draftOpen && busy}
                onChange={(event) => setComposer(event.target.value)}
                aria-expanded={slashOptions.length > 0}
                aria-controls={slashOptions.length > 0 ? 'slash-command-menu' : undefined}
                onKeyDown={(event) => {
                  if (event.key === 'Tab' && event.shiftKey) {
                    event.preventDefault()
                    if (!busy && !activeTurnId) { setMode(mode === 'plan' ? 'default' : 'plan'); setCommandNotice(null) }
                    return
                  }
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
                  if (isComposerSubmitKey(event, enterToSend)) {
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
                placeholder={activeTurnId ? 'Draft your next message…' : mode === 'plan' ? 'What should Codex plan?' : 'Message Codex…'}
                rows={1}
                maxLength={100_000}
              />
              {activeTurnId ? (
                <button type="button" className="stop-button" onClick={() => void interrupt()} disabled={stopState?.phase === 'stopping' || !online || !session.csrf} aria-label={stopState?.phase === 'stopping' ? 'Stopping Codex' : stopState?.phase === 'error' ? 'Retry stop' : 'Stop Codex'} aria-busy={stopState?.phase === 'stopping'}>{stopState?.phase === 'stopping' ? <span className="spinner" /> : '■'}</button>
              ) : (
                <button type="submit" className="send-button" disabled={busy || (!draftOpen && !historyReady) || !online || !session.csrf || (!composer.trim() && attachments.length === 0)} aria-label="Send instruction">↑</button>
              )}
            </div>
            <div className="composer-meta">
              <span role="status">{stopState ? stopState.message : activeTurnId ? <><i className="pulse-dot" /> Codex is working</> : enterToSend ? 'Type / for commands · Enter to send' : 'Enter để xuống dòng · Nhấn ↑ để gửi'}</span>
              {!activeTurnId && (composer.length > 0 || attachments.length > 0) && <span>{attachments.length > 0 ? `${attachments.length} file${attachments.length === 1 ? '' : 's'} · ` : ''}{composer.length.toLocaleString()} / 100,000</span>}
            </div>
          </form>
        )}
        {fileBrowserPath && <FileBrowser key={fileBrowserPath} initialPath={fileBrowserPath} covered={Boolean(fileViewer || localhostPreview !== null)} onClose={closeFileBrowser} onOpenFile={openFile} />}
        {fileViewer && <FileViewer key={fileViewer.path} reference={fileViewer} onClose={closeFileViewer} onOpenFile={setFileViewer} onOpenLink={openLink} />}
        {localhostPreview !== null && <LocalhostPreview key={browserScope} scope={browserScope} onNavigate={setLocalhostPreview} csrf={session.csrf} initialUrl={localhostPreview || undefined} onClose={closeLocalhostPreview} />}
        {renamingThread && <RenameConversation key={renamingThread.id} thread={renamingThread} online={online && Boolean(session.csrf)} onSave={renameConversation} onClose={closeRename} />}
      </main>
    </div>
  )
}
