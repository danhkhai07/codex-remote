import type { ConversationTask, TaskStatus } from '../server/orchestration'

// Display choices, not scheduling limits or a change to the durable task history.
export const RECENT_TASK_WINDOW_MS = 24 * 60 * 60_000
export const RECENT_TASK_LIMIT = 3
type DisplayTask = Pick<ConversationTask, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'resolution' | 'dispatchPending' | 'resultDelivery'>
export const isUnfinishedTask = (status: TaskStatus) => ['creating', 'queued', 'starting', 'running', 'stopping'].includes(status)
const activityTime = (task: DisplayTask) => {
  for (const value of [task.resolution?.resolvedAt, task.updatedAt, task.createdAt]) {
    const time = Date.parse(value ?? '')
    if (Number.isFinite(time)) return time
  }
  return 0
}

const needsAttention = (task: DisplayTask, now: number) => task.dispatchPending === true
  || (['failed', 'interrupted'].includes(task.status) && (task.resultDelivery !== 'delivered'
    || (!task.resolution && (!activityTime(task) || activityTime(task) >= now - RECENT_TASK_WINDOW_MS))))

/** Only old, known-delivered errors can leave the default view; delivery is not recovery. */
export function selectTeamTasks<T extends DisplayTask>(tasks: readonly T[], now = Date.now()) {
  const ordered = tasks.map((task, index) => ({ task, index, time: activityTime(task) }))
    .sort((a, b) => b.time - a.time || b.index - a.index).map(({ task }) => task)
  const recent = new Set(ordered.filter(task => !isUnfinishedTask(task.status) && !needsAttention(task, now)
    && activityTime(task) >= now - RECENT_TASK_WINDOW_MS).slice(0, RECENT_TASK_LIMIT).map(task => task.id))
  const current: T[] = [], history: T[] = []
  for (const task of ordered) {
    (isUnfinishedTask(task.status) || needsAttention(task, now) || recent.has(task.id) ? current : history).push(task)
  }
  return { current, history }
}
