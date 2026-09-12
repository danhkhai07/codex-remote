import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppRecovery } from './AppRecovery'
import { flushScreenState } from './screenState'
import { installPwaZoomLock } from './pwaZoom'
import './styles.css'

const removeZoomLock = installPwaZoomLock()
if (import.meta.hot) import.meta.hot.dispose(removeZoomLock)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRecovery><App /></AppRecovery>
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(__CODEX_REMOTE_BUILD_ID__)}`, { updateViaCache: 'none' }).then((registration) => {
      const announceUpdate = (worker: ServiceWorker | null) => {
        if (!worker || !navigator.serviceWorker.controller) return
        window.dispatchEvent(new CustomEvent('codex-remote:update-ready', { detail: worker }))
      }

      announceUpdate(registration.waiting)
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') announceUpdate(worker)
        })
      })

      window.setInterval(() => void registration.update(), 60 * 60 * 1_000)
    }).catch(() => undefined)

    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return
      refreshing = true
      flushScreenState()
      window.location.reload()
    })
  })
}
