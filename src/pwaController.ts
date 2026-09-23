/** First install already has the current page; claiming it must not discard its RAM key. */
export function installControllerReload(worker: ServiceWorkerContainer, reload: () => void) {
  let controlled = Boolean(worker.controller)
  let refreshing = false
  const changed = () => {
    if (!worker.controller) return
    if (!controlled) { controlled = true; return }
    if (refreshing) return
    refreshing = true
    reload()
  }
  worker.addEventListener('controllerchange', changed)
  return () => worker.removeEventListener('controllerchange', changed)
}
