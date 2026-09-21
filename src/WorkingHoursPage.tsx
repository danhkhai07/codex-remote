import { SecureHtml } from './SecureFiles'
import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from './api'
import { Login } from './App'
import type { Session } from './types'
import { attachWorkTimerStorage, WORK_TIMER_PATH } from './workTimerStorage'
import './working-hours.css'

export function isWorkingHoursPath(path: string) { return path === '/working-hours' || path === '/working-hours/' }

export function WorkingHoursPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const frame = useRef<HTMLIFrameElement>(null)
  useEffect(() => attachWorkTimerStorage(() => frame.current?.contentWindow ?? null), [])
  useEffect(() => {
    document.title = 'Working hours · Flint Software'
    let disposed = false
    const check = async () => {
      try {
        const result = await api.session()
        if (!disposed) { setSession(result); setError('') }
      } catch (reason) {
        if (disposed) return
        if (reason instanceof ApiError && reason.status === 401) setSession(null)
        else setError('Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.')
      } finally { if (!disposed) setLoading(false) }
    }
    void check()
    const timer = window.setInterval(() => void check(), 60_000)
    const focus = () => { if (document.visibilityState === 'visible') void check() }
    document.addEventListener('visibilitychange', focus)
    return () => { disposed = true; clearInterval(timer); document.removeEventListener('visibilitychange', focus) }
  }, [attempt])
  if (loading) return <main className="login-shell"><p role="status">Đang mở giờ làm việc…</p></main>
  if (!session) return <>
    {error && <div className="working-hours-error" role="alert">{error}<button onClick={() => setAttempt(n => n + 1)}>Thử lại</button></div>}
    <Login installPrompt={null} offline={!navigator.onLine} onInstall={() => undefined} onLogin={setSession} />
  </>
  return <main className="working-hours-shell">
    {error && <p className="working-hours-error" role="alert">{error}</p>}
    <SecureHtml frameRef={frame} key={attempt} title="Flint Software working hours" path={WORK_TIMER_PATH} />
  </main>
}
