import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export type HoursState = { revision: number; autoPaused?: boolean; pausedAt?: number | null; estimateSince?: number; pauseWindows?: [number, number][]; estimateBaselines?: Record<string, number>; totals: Record<string, number>; timer: { startedAt: number; baseline: Record<string, number> } | null }
export class HoursError extends Error { constructor(readonly status: number, message: string) { super(message) } }
const dayOf = (ms: number) => new Date(ms + 7 * 3600000).toISOString().slice(0, 10)
export function timerTotals(timer: NonNullable<HoursState['timer']>, end: number) {
  const totals: Record<string, number> = {}
  for (let cursor = timer.startedAt; cursor < end;) {
    const day = dayOf(cursor), stop = Math.min(end, Date.parse(`${day}T00:00:00+07:00`) + 86400000)
    totals[day] = Math.min(24, (timer.baseline[day] ?? 0) + (stop - cursor) / 3600000)
    cursor = stop
  }
  return totals
}
export class WorkHoursStore {
  constructor(private file: string, private clock = Date.now) { mkdirSync(dirname(file), { recursive: true }) }
  private load(): HoursState {
    if (!existsSync(this.file)) return { revision: 0, totals: {}, timer: null }
    const state = JSON.parse(readFileSync(this.file, 'utf8')) as HoursState
    if (!Number.isSafeInteger(state.revision) || !state.totals || typeof state.totals !== 'object') throw new Error('Invalid working-hours state')
    return state
  }
  private estimates(state: HoursState): Record<string, number> {
    const file = join(dirname(this.file), 'data.json')
    const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { days: [] }
    // Raw merged intervals let a current state filter even a generator snapshot from
    // before the pause/resume. Never accept old unfiltered counters after a pause.
    if (state.autoPaused) return {}
    if (Array.isArray(data.activityIntervals)) {
      const totals: Record<string, number> = {}
      for (const [start, end] of data.activityIntervals as [number, number][]) {
        for (let cursor = Math.max(start, state.estimateSince ?? start); cursor < end;) {
          const day = dayOf(cursor), stop = Math.min(end, Date.parse(`${day}T00:00:00+07:00`) + 86400000)
          totals[day] = Math.min(24, (totals[day] ?? 0) + (stop - cursor) / 3600000)
          cursor = stop
        }
      }
      return totals
    }
    if (state.estimateSince !== undefined) return {}
    return Object.fromEntries(data.days.filter((row: { estimatedHours?: number }) => Number.isFinite(row.estimatedHours)).map((row: { date: string; estimatedHours: number }) => [row.date, row.estimatedHours]))
  }
  private current(state: HoursState, estimates: Record<string, number>) {
    return Object.fromEntries(Object.entries({ ...estimates, ...state.totals }).map(([day, hours]) => [day,
      Math.max(0, Math.min(24, hours + (state.autoPaused || state.totals[day] === undefined ? 0 : Math.max(0, (estimates[day] ?? 0) - (state.estimateBaselines?.[day] ?? estimates[day] ?? 0)))))]))
  }
  read() {
    const state = this.load(), estimates = this.estimates(state)
    if (!state.estimateBaselines && Object.keys(state.totals).length) {
      state.estimateBaselines = Object.fromEntries(Object.keys(state.totals).map(day => [day, estimates[day] ?? 0]))
      this.commit(state)
    }
    return { ...state, autoPaused: state.autoPaused ?? false, totals: this.current(state, estimates), serverNow: this.clock() }
  }
  private commit(state: HoursState) {
    const temp = `${this.file}.${randomUUID()}.tmp`
    writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
    const fd = openSync(temp, 'r'); try { fsyncSync(fd) } finally { closeSync(fd) }
    if (existsSync(this.file)) writeFileSync(`${this.file}.backup`, readFileSync(this.file), { mode: 0o600 })
    renameSync(temp, this.file)
  }
  change(input: Record<string, unknown>) {
    const state = this.load(), now = this.clock()
    const estimates = this.estimates(state)
    state.totals = this.current(state, estimates)
    state.estimateBaselines = Object.fromEntries(Object.keys(state.totals).map(day => [day, estimates[day] ?? 0]))
    if (input.expectedRevision !== state.revision) throw new HoursError(409, 'Giờ đã được thay đổi trên máy khác. Đã tải lại dữ liệu; hãy thử lại.')
    if (input.action === 'pause') {
      if (state.autoPaused) throw new HoursError(409, 'Ước tính tự động đã tạm dừng. Tải lại dữ liệu rồi thử lại.')
      if (state.timer) Object.assign(state.totals, timerTotals(state.timer, Math.max(state.timer.startedAt, now)))
      state.timer = null
      state.autoPaused = true
      state.pausedAt = now
      state.estimateSince = now
      state.estimateBaselines = Object.fromEntries(Object.keys(state.totals).map(day => [day, 0]))
    } else if (input.action === 'resume') {
      if (!state.autoPaused) throw new HoursError(409, 'Ước tính tự động đang hoạt động. Tải lại dữ liệu rồi thử lại.')
      const resumedAt = Math.max(state.pausedAt ?? now, now)
      state.pauseWindows = [...(state.pauseWindows ?? []), [state.pausedAt ?? now, resumedAt]]
      state.autoPaused = false
      state.pausedAt = null
      // A new estimate epoch excludes delayed logs before resume, including the
      // entire pause window. Existing adjusted totals remain the checkpoint.
      state.estimateSince = resumedAt
      state.estimateBaselines = Object.fromEntries(Object.keys(state.totals).map(day => [day, 0]))
    } else if (input.action === 'start') {
      if (state.autoPaused) throw new HoursError(409, 'Bấm Tiếp tục trước khi bắt đầu bộ đếm.')
      if (state.timer) throw new HoursError(409, 'Đã có một phiên đang chạy. Hãy dùng Dừng trên một trong hai máy.')
      const day = dayOf(now)
      const baseline = state.totals[day] ?? estimates[day] ?? 0
      state.timer = { startedAt: now, baseline: { [day]: baseline } }
    } else if (input.action === 'stop') {
      if (state.timer) Object.assign(state.totals, timerTotals(state.timer, Math.max(state.timer.startedAt, now)))
      for (const day of Object.keys(state.totals)) state.estimateBaselines[day] = estimates[day] ?? 0
      state.timer = null
    } else if (input.action === 'replace-totals') {
      if (state.timer) throw new HoursError(409, 'Dừng phiên đang chạy trước khi sửa tổng giờ.')
      if (!input.totals || typeof input.totals !== 'object' || Array.isArray(input.totals)) throw new HoursError(400, 'Invalid daily totals')
      const totals: Record<string, number> = {}
      for (const [day, hours] of Object.entries(input.totals)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0,10) !== day || day > dayOf(now) || typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0 || hours > 24) throw new HoursError(400, 'Invalid date or hours')
        totals[day] = hours
      }
      state.totals = totals
      state.estimateBaselines = Object.fromEntries(Object.keys(totals).map(day => [day, estimates[day] ?? 0]))
    } else throw new HoursError(400, 'Invalid working-hours action')
    state.revision++
    this.commit(state)
    return { ...state, autoPaused: state.autoPaused ?? false, serverNow: now }
  }
}
