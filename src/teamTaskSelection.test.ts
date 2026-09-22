import { expect, it } from 'vitest'
import type { ConversationTask, TaskStatus } from '../server/orchestration'
import { RECENT_TASK_LIMIT, RECENT_TASK_WINDOW_MS, selectTeamTasks } from './teamTaskSelection'

const now = Date.parse('2026-09-22T12:00:00+07:00')
function task(id: string, status: TaskStatus, age = 0, extra: Partial<ConversationTask> = {}): ConversationTask {
  return { id, requestId: id, groupId: 'group', leaderId: 'leader', leaderEpoch: 1, threadId: 'worker', title: id,
    instruction: '', settings: { fullAccess: false }, status, createdAt: new Date(now - 3 * RECENT_TASK_WINDOW_MS).toISOString(),
    updatedAt: new Date(now - age).toISOString(), ...extra }
}
const ids = (tasks: ConversationTask[]) => tasks.map(task => task.id)
const resolved = (age = 0) => ({ summary: 'Verified recovery', evidence: 'Verification reference', resolvedBy: 'leader', leaderEpoch: 1, resolvedAt: new Date(now - age).toISOString() })

it('never caps queued or active work, even when older than all the results', () => {
  const active = (['creating', 'queued', 'starting', 'running', 'stopping'] as const)
    .flatMap(status => Array.from({ length: 4 }, (_, i) => task(`${status}-${i}`, status, 2 * RECENT_TASK_WINDOW_MS)))
  const completed = Array.from({ length: 10 }, (_, i) => task(`done-${i}`, 'completed', i * 1000))
  const result = selectTeamTasks([...active, ...completed], now)
  expect(result.current.filter(item => item.status === 'completed')).toHaveLength(RECENT_TASK_LIMIT)
  expect(result.current.filter(item => item.status !== 'completed')).toHaveLength(20)
  expect(result.history).toHaveLength(7)
})

it('selects up to three newest terminal outcomes within 24 hours, independent of stored order', () => {
  const tasks = [task('old', 'completed', RECENT_TASK_WINDOW_MS + 1), task('newest', 'completed'),
    task('fourth', 'completed', 4000), task('second', 'cancelled', 1000), task('third', 'completed', 2000)]
  const before = JSON.stringify(tasks), result = selectTeamTasks(tasks, now)
  expect(ids(result.current)).toEqual(['newest', 'second', 'third'])
  expect(ids(result.history)).toEqual(['fourth', 'old'])
  expect(JSON.stringify(tasks)).toBe(before)
})

it('ages a completed result out at the 24-hour boundary without changing its status', () => {
  const done = task('boundary', 'completed', RECENT_TASK_WINDOW_MS)
  expect(ids(selectTeamTasks([done], now).current)).toEqual(['boundary'])
  expect(ids(selectTeamTasks([done], now + 1).history)).toEqual(['boundary'])
  expect(done.status).toBe('completed')
})

it('keeps every new and old unresolved failure or interruption visible, even beyond the result limit', () => {
  const errors = Array.from({ length: 20 }, (_, i) => task(`error-${i}`, i % 2 ? 'interrupted' : 'failed', i * RECENT_TASK_WINDOW_MS))
  const done = Array.from({ length: 10 }, (_, i) => task(`done-${i}`, 'completed', i))
  const result = selectTeamTasks([...errors, ...done], now)
  expect(result.current.filter(item => item.status !== 'completed')).toEqual(expect.arrayContaining(errors))
  expect(result.current.filter(item => item.status !== 'completed')).toHaveLength(20)
  expect(result.history.every(item => item.status === 'completed')).toBe(true)
  expect(errors.every(item => !item.resolution)).toBe(true)
})

it('uses recovery time for recent recovered work while keeping the original error and outcome in history', () => {
  const recovered = task('recovered', 'failed', 3 * RECENT_TASK_WINDOW_MS, { result: 'Original failure', resolution: resolved() })
  const stale = task('stale-recovery', 'interrupted', 0, { result: 'Original interruption', resolution: resolved(RECENT_TASK_WINDOW_MS + 1) })
  const result = selectTeamTasks([recovered, stale], now)
  expect(result.current).toEqual([recovered]); expect(result.history).toEqual([stale])
  expect(result.current[0]).toMatchObject({ status: 'failed', result: 'Original failure', resolution: { summary: 'Verified recovery' } })
  expect(selectTeamTasks([recovered], now + RECENT_TASK_WINDOW_MS + 1).history).toEqual([recovered])
})

it('handles old timestamps conservatively and counts each retained task exactly once', () => {
  const tasks = [task('undated-error', 'failed', 0, { createdAt: '', updatedAt: '' }),
    task('invalid-completed', 'completed', 0, { createdAt: '', updatedAt: 'invalid' }),
    task('created-fallback', 'completed', 0, { createdAt: new Date(now).toISOString(), updatedAt: '' }),
    task('ahead', 'completed', -1000)]
  const result = selectTeamTasks(tasks, now)
  expect(ids(result.current)).toEqual(['ahead', 'created-fallback', 'undated-error'])
  expect(ids(result.history)).toEqual(['invalid-completed'])
  expect(new Set([...ids(result.current), ...ids(result.history)]).size).toBe(tasks.length)
  expect(selectTeamTasks([], now)).toEqual({ current: [], history: [] })
})
