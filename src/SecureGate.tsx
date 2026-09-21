import { forgetScreenStateMemory } from './screenState'
import { forgetPinnedFilesMemory } from './pinnedFiles'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { awaitMigrationReady, lockSecure, onSecureLock, secureFetch, secureLogin, secureSetup, unlockSecure } from './secureApi'
export function SecureGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<'loading' | 'login' | 'unlock' | 'ready' | 'legacy'>('loading')
  const [value, setValue] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => onSecureLock(() => { setPhase('unlock'); setValue(''); setTimeout(() => { forgetScreenStateMemory(); forgetPinnedFilesMemory() }, 0) }), [])
  useEffect(() => {
    let cancelled = false
    void (async () => {
      await awaitMigrationReady()
      const config = await secureSetup()
      if (!cancelled) setPhase(config.required ? 'unlock' : 'legacy')
    })().catch(() => { if (!cancelled) setError('Không mở được kết nối bảo mật. Tải lại để thử lại.') })
    return () => { cancelled = true }
  }, [])
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    const input = value; setValue('')
    try {
      if (phase === 'login') { await secureLogin(input); setPhase('unlock') }
      else { await unlockSecure(input); const session = await secureFetch('/api/session'); if (!session.ok) throw Error('Phiên đăng nhập hết hạn'); await session.arrayBuffer(); setPhase('ready') }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không mở khóa được') }
    finally { setBusy(false) }
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
