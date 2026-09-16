import { api } from './api'
export const WORK_TIMER_PATH = '/root/VAULTS/Flint-Software/Working-Hours/index.html'
export const WORK_TIMER_CHANNEL = 'flint-work-timer-storage'
/** Only a fixed dashboard frame can access the authenticated shared hours API. */
export function attachWorkTimerStorage(frame: () => Window | null) {
  const handle = async (event: MessageEvent) => {
    if (!frame() || event.source !== frame() || event.origin !== 'null') return
    const input = event.data
    if (!input || input.channel !== WORK_TIMER_CHANNEL || typeof input.id !== 'string' || input.id.length > 80) return
    const reply = (result: object) => (event.source as Window).postMessage({ channel: WORK_TIMER_CHANNEL, id: input.id, ...result }, '*')
    try {
      let result
      if (input.action === 'get') result = await api.workHours()
      else if (input.action === 'command' && ['start', 'stop', 'replace-totals'].includes(input.command)) {
        const session = await api.session()
        result = await api.changeWorkHours({ action: input.command, expectedRevision: input.expectedRevision, ...(input.command === 'replace-totals' ? { totals: input.totals } : {}) }, session.csrf)
      } else { reply({ error: 'Invalid working-hours request' }); return }
      reply({ shared: true, revision: result.revision, serverNow: result.serverNow, values: {
        'flint-software-working-hours-overrides-v1': JSON.stringify(result.totals),
        'flint-software-working-hours-timer-v1': JSON.stringify(result.timer),
      } })
    } catch (error) { reply({ error: error instanceof Error ? error.message : 'Không kết nối được dữ liệu chung. Hãy thử lại.' }) }
  }
  window.addEventListener('message', handle)
  return () => window.removeEventListener('message', handle)
}
