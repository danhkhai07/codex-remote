import { Component, type ErrorInfo, type ReactNode } from 'react'
import { flushScreenState, writeScreenState } from './screenState'

export class AppRecovery extends Component<{ children: ReactNode }, { failed: boolean; attempt: number }> {
  state = { failed: false, attempt: 0 }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // Local-only diagnostic: no prompts, credentials, or server telemetry.
    try { sessionStorage.setItem('codex-remote:last-ui-error', JSON.stringify({ at: Date.now(), type: error.name, component: info.componentStack?.slice(0, 1200) })) } catch { /* Optional diagnostic. */ }
  }
  recover = (closePanels = false) => {
    if (closePanels) {
      for (const key of ['file-viewer', 'file-browser', 'link-viewer', 'command-notice']) writeScreenState(key, null)
      writeScreenState('drawer', false)
    }
    flushScreenState()
    this.setState(current => ({ failed: false, attempt: current.attempt + 1 }))
  }
  render() {
    if (this.state.failed) return <main className="loading-shell app-recovery" role="alert">
      <h1>Không mở được giao diện</h1>
      <p>Bạn có thể thử khôi phục mà không đăng xuất hay gửi lại tin nhắn.</p>
      <div className="recovery-actions">
        <button className="primary-button" onClick={() => this.recover()}>Thử khôi phục</button>
        <button className="quiet-button" onClick={() => this.recover(true)}>Đóng các khung xem và thử lại</button>
        <a className="quiet-button" href="/?recover=1" onClick={flushScreenState}>Tải lại app</a>
      </div>
    </main>
    return <div key={this.state.attempt} className="recovery-root">{this.props.children}</div>
  }
}
