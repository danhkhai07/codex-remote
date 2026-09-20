import { useEffect, useState } from 'react'
import { api } from './api'
import { threadTitle } from './model'
import type { Thread } from './types'
import type { ConversationGroup } from './conversationGroups'
import type { ConversationTask } from '../server/orchestration'

export type TeamSnapshot = {
  groupId: string | null; leaderId: string | null; members: string[]; paused: string[]
  tasks: Array<Omit<ConversationTask, 'settings'>>; pendingResults: number; unconfirmedResults: number
  limits: { concurrent: number; dispatchesLeft: number; wakeupsLeft: number }
}
const statuses: Record<string, string> = { creating: 'Đang tạo convo', queued: 'Đang chờ', starting: 'Đang gửi', running: 'Đang làm', stopping: 'Đang dừng', completed: 'Hoàn tất', failed: 'Có lỗi', cancelled: 'Đã dừng', interrupted: 'Bị ngắt' }
const unfinished = (status: string) => ['creating', 'queued', 'starting', 'running', 'stopping'].includes(status)

export function ConversationTeam({ threadId, group, threads, csrf, enabled, revision, onOpen }: {
  threadId: string; group: ConversationGroup; threads: Thread[]; csrf: string; enabled: boolean; revision: number
  onOpen: (id: string) => void
}) {
  const [team, setTeam] = useState<TeamSnapshot | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!enabled) return
    const abort = new AbortController()
    let loading = false
    const load = async () => {
      if (loading) return
      loading = true
      try { const next = await api.team(threadId, abort.signal); if (!abort.signal.aborted) { setTeam(next); setError('') } }
      catch (reason) { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'Không tải được công việc') }
      finally { loading = false }
    }
    void load()
    const timer = setInterval(() => void load(), 5000)
    return () => { abort.abort(); clearInterval(timer) }
  }, [threadId, enabled, group.leaderEpoch, revision])
  async function action(body: { action: 'release' | 'cancel'; taskId?: string }) {
    if (saving) return
    setSaving(true)
    try { setTeam(await api.teamAction(threadId, body, csrf)); setError('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không lưu được thay đổi') }
    finally { setSaving(false) }
  }
  const title = (id: string) => { const thread = threads.find(thread => thread.id === id); return thread ? threadTitle(thread) : id }
  const pending = team?.tasks.filter(task => unfinished(task.status)).length ?? 0
  const isLeader = group.leaderThreadId === threadId
  const paused = team?.paused.includes(threadId)
  return <details className="conversation-team">
    <summary><span>{isLeader ? '★ Bạn đang ở convo leader' : group.leaderThreadId ? `Leader: ${title(group.leaderThreadId)}` : 'Điều phối đã tắt'}</span>
      <span className="muted">{paused ? 'Bạn đang điều khiển' : pending ? `${pending} việc đang xử lý` : 'Công việc'}</span></summary>
    <div className="conversation-team-body">
      {!isLeader && <p className="muted">Bạn có thể chat trực tiếp ở đây. Khi bạn gửi tin nhắn, convo tạm dừng nhận việc từ leader.</p>}
      {!isLeader && group.leaderThreadId && <button type="button" className="quiet-button" onClick={() => onOpen(group.leaderThreadId!)}>Mở convo leader ↗</button>}
      {paused && <button type="button" className="quiet-button" disabled={!enabled || saving} onClick={() => void action({ action: 'release' })}>Cho leader giao việc trở lại</button>}
      {error && <p role="alert" className="error-banner">{error}</p>}
      {team && <>
        {team.pendingResults > 0 && <p className="muted">{team.pendingResults} kết quả chờ gửi về leader.{team.limits.wakeupsLeft === 0 ? ' Gửi tin nhắn mới cho leader để tiếp tục.' : ''}</p>}
        {team.unconfirmedResults > 0 && <p role="status">Có {team.unconfirmedResults} thông báo chưa xác nhận đã gửi. Xem kết quả từng việc và lịch sử leader trước khi yêu cầu gửi lại.</p>}
        {team.tasks.length === 0 && <p className="muted">Chưa có công việc được giao.</p>}
        <ul className="team-tasks">{[...team.tasks].reverse().map(task => <li key={task.id}>
          <div className="team-task-heading"><strong>{task.title}</strong><span className={`team-task-status is-${task.status}`}>{statuses[task.status]}</span></div>
          <div className="team-task-actions">
            {task.threadId && <button type="button" className="quiet-button" onClick={() => onOpen(task.threadId)}>{title(task.threadId)} ↗</button>}
            {unfinished(task.status) && <button type="button" className="quiet-button" disabled={!enabled || saving} onClick={() => void action({ action: 'cancel', taskId: task.id })}>Dừng việc</button>}
          </div>
          {task.result && <details className="team-task-result"><summary>Kết quả</summary><p>{task.result}</p></details>}
        </li>)}</ul>
      </>}
    </div>
  </details>
}
