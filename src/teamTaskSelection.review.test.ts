import { expect, it } from 'vitest'
import type { ConversationTask } from '../server/orchestration'
import { selectTeamTasks } from './teamTaskSelection'

it('CR2 inverse: 200 old already-delivered unresolved errors leave no history section and swamp current work', () => {
  const now = Date.parse('2026-09-22T12:00:00+07:00')
  const old = new Date(now - 30 * 24 * 60 * 60_000).toISOString()
  const errors: ConversationTask[] = Array.from({ length: 200 }, (_, i) => ({
    id: `old-${i}`, requestId: `old-${i}`, groupId: 'folder', leaderId: 'leader', leaderEpoch: 1,
    threadId: 'worker', title: 'Old reported failure', instruction: '', settings: { fullAccess: false },
    status: 'failed', result: 'Already reported; never marked recovered', createdAt: old, updatedAt: old,
  }))
  // Delivery/ack status is not exposed to this selector, only the task outcome.
  const fresh = { ...errors[0], id: 'new-error', title: 'Fresh failure', updatedAt: new Date(now).toISOString() }
  const active = { ...errors[0], id: 'busy', status: 'running' as const }
  const result = selectTeamTasks([...errors, fresh, active], now)
  expect(result.current).toHaveLength(202)
  expect(result.current).toContain(fresh); expect(result.current).toContain(active)
  expect(result.history).toHaveLength(0)
  expect(errors.every(task => task.resolution === undefined)).toBe(true)
})
