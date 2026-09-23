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
  if (phase === 'legacy' || phase === 'ready') return children
  const login = phase === 'login'
  return <main className="login-shell"><section className="login-card secure-gate" aria-labelledby="secure-gate-title">
    <div className="brand-lockup">
      <div className="brand-mark" aria-hidden="true">&gt;_</div>
      <div><p className="eyebrow">Secure remote access</p><p className="brand-name">Codex Remote</p></div>
    </div>
    <h1 id="secure-gate-title">{login ? 'Chào mừng trở lại.' : 'Mở khóa không gian của bạn.'}</h1>
    <p className="muted">{login ? 'Đăng nhập để tiếp tục cuộc trò chuyện của bạn.' : 'Nhập khóa mã hóa riêng để mở các cuộc trò chuyện trên thiết bị này.'}</p>
    {phase === 'loading' ? <p role="status">Đang kiểm tra kết nối bảo mật…</p> : <form className="login-form" onSubmit={submit} aria-busy={busy}>
      <label htmlFor={login ? 'login-password' : 'unlock-key'}>{login ? 'Mật khẩu đăng nhập' : 'Khóa mã hóa riêng'}</label>
      <input key={phase} id={login ? 'login-password' : 'unlock-key'} name={login ? 'login-password' : 'encryption-key'} type="password" autoComplete="current-password" value={value} onChange={event => setValue(event.target.value)} required autoFocus spellCheck={false} disabled={busy} aria-describedby="secure-gate-help" aria-invalid={error ? true : undefined} />
      <p className="secure-gate-help muted" id="secure-gate-help">{login ? 'Sau đăng nhập, dùng khóa riêng để mở dữ liệu.' : 'Khóa chỉ được giữ trong bộ nhớ đến khi khóa hoặc tải lại trang.'}</p>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <button className="primary-button login-button" type="submit" disabled={busy}>{busy ? 'Đang kiểm tra…' : login ? 'Đăng nhập' : 'Mở khóa'}</button>
      <button className="quiet-button secure-gate-switch" type="button" disabled={busy} onClick={() => { setPhase(login ? 'unlock' : 'login'); setValue(''); setError('') }}>{login ? 'Đã đăng nhập · Mở khóa' : 'Đăng nhập lại'}</button>
    </form>}
    {phase === 'loading' && error && <p className="error-banner" role="alert">{error}</p>}
  </section></main>
}
