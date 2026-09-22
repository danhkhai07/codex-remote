import { expect, it } from 'vitest'
import type { ConversationTask } from '../server/orchestration'
import { selectTeamTasks } from './teamTaskSelection'

it('L3: 200 old known-delivered errors live in history while new, uncertain and busy tasks stay current', () => {
  const now = Date.parse('2026-09-22T12:00:00+07:00')
  const old = new Date(now - 30 * 24 * 60 * 60_000).toISOString()
  const errors: ConversationTask[] = Array.from({ length: 200 }, (_, i) => ({
    id: `old-${i}`, requestId: `old-${i}`, groupId: 'folder', leaderId: 'leader', leaderEpoch: 1,
    threadId: 'worker', title: 'Old reported failure', instruction: '', settings: { fullAccess: false },
    status: 'failed', result: 'Already reported; never marked recovered', createdAt: old, updatedAt: old,
    resultDelivery: 'delivered', dispatchPending: false,
  }))
  // A native receipt is not recovery or a human acknowledgement.
  const fresh = { ...errors[0], id: 'new-error', title: 'Fresh failure', updatedAt: new Date(now).toISOString() }
  const active = { ...errors[0], id: 'busy', status: 'running' as const }
  const uncertain = (['pending', 'sending', 'review', 'unknown', undefined] as const).map((resultDelivery, i) => ({ ...errors[0], id: `uncertain-${i}`, resultDelivery }))
  const result = selectTeamTasks([...errors, fresh, active, ...uncertain], now)
  expect(result.current).toHaveLength(7)
  expect(result.current).toContain(fresh); expect(result.current).toContain(active)
  expect(result.current).toEqual(expect.arrayContaining(uncertain))
  expect(result.history).toHaveLength(200)
  expect(errors.every(task => task.resolution === undefined)).toBe(true)
})
