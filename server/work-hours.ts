import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export type HoursState = { revision: number; estimateBaselines?: Record<string, number>; totals: Record<string, number>; timer: { startedAt: number; baseline: Record<string, number> } | null }
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
  private estimates(): Record<string, number> {
    const file = join(dirname(this.file), 'data.json')
    const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { days: [] }
    return Object.fromEntries(data.days.filter((row: { estimatedHours?: number }) => Number.isFinite(row.estimatedHours)).map((row: { date: string; estimatedHours: number }) => [row.date, row.estimatedHours]))
  }
  private current(state: HoursState, estimates: Record<string, number>) {
    return Object.fromEntries(Object.entries(state.totals).map(([day, hours]) => [day,
      Math.max(0, Math.min(24, hours + Math.max(0, (estimates[day] ?? 0) - (state.estimateBaselines?.[day] ?? estimates[day] ?? 0))))]))
  }
  read() {
    const state = this.load(), estimates = this.estimates()
    if (!state.estimateBaselines && Object.keys(state.totals).length) {
      state.estimateBaselines = Object.fromEntries(Object.keys(state.totals).map(day => [day, estimates[day] ?? 0]))
      this.commit(state)
    }
    return { ...state, totals: this.current(state, estimates), serverNow: this.clock() }
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
    const estimates = this.estimates()
    state.totals = this.current(state, estimates)
    state.estimateBaselines = Object.fromEntries(Object.keys(state.totals).map(day => [day, estimates[day] ?? 0]))
    if (input.expectedRevision !== state.revision) throw new HoursError(409, 'Giờ đã được thay đổi trên máy khác. Đã tải lại dữ liệu; hãy thử lại.')
    if (input.action === 'start') {
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
    return { ...state, serverNow: now }
  }
}
