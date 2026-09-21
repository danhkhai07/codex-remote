import { useEffect, useState, type ReactNode } from 'react'
import { ensurePreviewMigrationReady } from './legacyPreviewWorkers'

/** Do not mount session restoration (including cached snapshots) before cleanup. */
export function PreviewMigrationGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setError('')
    void ensurePreviewMigrationReady(true).then(() => { if (active) setReady(true) }, reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Không hoàn tất kiểm tra preview cũ. Vui lòng thử lại.')
    })
    return () => { active = false }
  }, [attempt])
  if (ready) return children
  return <main className="login-shell"><section className="login-card" aria-labelledby="migration-title">
    <h1 id="migration-title">Chuẩn bị truy cập an toàn</h1>
    {error ? <><p className="error-banner" role="alert">{error}</p><button className="primary-button" onClick={() => setAttempt(value => value + 1)}>Thử lại</button></> : <p role="status">Đang đóng preview cũ và kiểm tra trước khi khôi phục phiên…</p>}
    <p className="muted">Sau bản cập nhật bảo mật, dùng browser profile mới để đăng nhập. Kiểm tra tự động không xác minh được mọi tab hoặc dữ liệu cũ trong trình duyệt.</p>
    <p className="muted">Bản nháp và dữ liệu đã lưu được giữ nguyên.</p>
  </section></main>
}
