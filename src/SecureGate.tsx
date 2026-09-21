import { forgetScreenStateMemory } from './screenState'
import { forgetPinnedFilesMemory } from './pinnedFiles'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { lockSecure, onSecureLock, secureFetch, secureLogin, secureSetup, unlockSecure } from './secureApi'
export function SecureGate({ children }: { children: ReactNode }) {
  const submission = useRef(0)
  const [phase, setPhase] = useState<'loading' | 'login' | 'unlock' | 'ready' | 'legacy'>('loading')
  const [value, setValue] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {
    const remove = onSecureLock(() => { const id = ++submission.current; setPhase('unlock'); setValue(''); setBusy(false); setError(''); setTimeout(() => { if (submission.current === id) { forgetScreenStateMemory(); forgetPinnedFilesMemory() } }, 0) })
    return () => { submission.current++; remove(); lockSecure(false, false) }
  }, [])
  useEffect(() => {
    let cancelled = false
    const id = submission.current
    void (async () => {
      const config = await secureSetup()
      if (!cancelled && id === submission.current) setPhase(config.required ? 'unlock' : 'legacy')
    })().catch(() => { if (!cancelled && id === submission.current) setError('Không mở được kết nối bảo mật. Tải lại để thử lại.') })
    return () => { cancelled = true }
  }, [])
  const submit = async (event: FormEvent) => {
    event.preventDefault(); const id = ++submission.current; setBusy(true); setError('')
    const current = () => id === submission.current
    const input = value; setValue('')
    try {
      if (phase === 'login') { await secureLogin(input); if (current()) setPhase('unlock') }
      else { await unlockSecure(input); if (!current()) return; const session = await secureFetch('/api/session'); if (!session.ok) throw Error('Phiên đăng nhập hết hạn'); await session.arrayBuffer(); if (current()) setPhase('ready') }
    } catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : 'Không mở khóa được') }
    finally { if (current()) setBusy(false) }
  }
  if (phase === 'legacy') return children
  if (phase === 'ready') return <><button className="secure-lock-button quiet-button" type="button" onClick={() => lockSecure()}>Khóa</button>{children}</>
  return <main className="login-shell"><form className="login-card" onSubmit={submit}>
    <h1>{phase === 'login' ? 'Đăng nhập Codex Remote' : 'Mở khóa Codex Remote'}</h1>
    {phase === 'loading' ? <p role="status">Đang kiểm tra kết nối bảo mật…</p> : <>
      <label htmlFor={phase === 'login' ? 'login-password' : 'unlock-key'}>{phase === 'login' ? 'Mật khẩu đăng nhập' : 'Khóa mã hóa riêng'}</label>
      <input id={phase === 'login' ? 'login-password' : 'unlock-key'} name={phase === 'login' ? 'login-password' : 'encryption-key'} type="password" autoComplete="current-password" value={value} onChange={event => setValue(event.target.value)} required autoFocus spellCheck={false} disabled={busy} />
      <p>{phase === 'login' ? 'Sau đăng nhập, dùng khóa mã hóa riêng để mở dữ liệu.' : 'Khóa riêng được giữ trong bộ nhớ đến khi khóa hoặc tải lại trang.'}</p>
      <button className="primary-button" disabled={busy}>{busy ? 'Đang kiểm tra…' : phase === 'login' ? 'Đăng nhập' : 'Mở khóa'}</button>
      <button className="quiet-button" type="button" disabled={busy} onClick={() => { setPhase(phase === 'login' ? 'unlock' : 'login'); setValue(''); setError('') }}>{phase === 'login' ? 'Đã đăng nhập · Mở khóa' : 'Đăng nhập lại'}</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </form></main>
}
