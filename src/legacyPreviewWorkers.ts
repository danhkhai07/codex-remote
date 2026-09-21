class PreviewMigrationError extends Error {}

/** Known legacy paths only. This is not an attestation of a previously compromised origin. */
export function isLegacyPreviewUrl(value: string, origin: string): boolean {
  const url = new URL(value, origin)
  return url.origin === origin && (url.pathname === '/preview' || url.pathname.startsWith('/preview/') || url.pathname === '/workboard' || url.pathname.startsWith('/workboard/'))
}

export async function unregisterLegacyPreviewWorkers(workers: Pick<ServiceWorkerContainer, 'getRegistrations'>, origin: string): Promise<void> {
  for (const registration of await workers.getRegistrations()) {
    if (isLegacyPreviewUrl(registration.scope, origin)) await registration.unregister()
  }
  // A resolved unregister(false), or a concurrent registration, is not proof of removal.
  if ((await workers.getRegistrations()).some(registration => isLegacyPreviewUrl(registration.scope, origin))) {
    throw new PreviewMigrationError('Không gỡ được preview cũ. Đóng các tab preview/Workboard cũ rồi thử lại.')
  }
}

export function closeLegacyPreviewFrames(document: Document, origin: string): void {
  for (const frame of document.querySelectorAll('iframe')) {
    let legacy = isLegacyPreviewUrl(frame.src, origin)
    try { legacy ||= isLegacyPreviewUrl(frame.contentWindow?.location.href ?? '', origin) } catch { /* An isolated cross-origin frame is not a legacy admin document. */ }
    if (legacy) { frame.src = 'about:blank'; frame.remove() }
  }
}

/** Delete only response entries at known legacy URLs, preserving drafts, app shell
 * and unrelated caches. Root app workers may also have cached /workboard/. */
export async function removeLegacyPreviewCacheEntries(storage: CacheStorage, origin: string): Promise<void> {
  for (const name of await storage.keys()) {
    const cache = await storage.open(name)
    for (const request of await cache.keys()) {
      if (isLegacyPreviewUrl(request.url, origin)) await cache.delete(request)
    }
    if ((await cache.keys()).some(request => isLegacyPreviewUrl(request.url, origin))) {
      throw new PreviewMigrationError('Không xóa được cache preview cũ. Đóng các tab preview/Workboard cũ rồi thử lại.')
    }
  }
}

function timeout<T>(operation: Promise<T>, ms = 8_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new PreviewMigrationError('Kiểm tra preview cũ quá hạn. Kiểm tra mạng, đóng các tab preview/Workboard cũ rồi thử lại.')), ms)
    operation.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

async function inspectLegacyClients(workers: ServiceWorkerContainer): Promise<number> {
  // Dedicated, non-controlling worker: no fetch handler, no root worker replacement.
  const registration = await workers.register('/migration-check-sw.js', { scope: '/__codex_migration__/', updateViaCache: 'none' })
  const worker = registration.installing ?? registration.waiting ?? registration.active
  if (!worker) throw new PreviewMigrationError('Không mở được kiểm tra preview cũ. Vui lòng thử lại.')
  if (worker.state !== 'activated') await new Promise<void>((resolve, reject) => {
    const changed = () => {
      if (worker.state === 'activated' || worker.state === 'redundant') {
        worker.removeEventListener('statechange', changed)
        if (worker.state === 'activated') resolve()
        else reject(new PreviewMigrationError('Kiểm tra preview cũ bị gián đoạn. Vui lòng thử lại.'))
      }
    }
    worker.addEventListener('statechange', changed)
    changed()
  })
  const channel = new MessageChannel()
  try {
    return await timeout(new Promise<number>((resolve, reject) => {
      channel.port1.onmessage = event => {
        const result = event.data as { type?: string; count?: number }
        if (!result || result.type !== 'LEGACY_CLIENTS_V1' || !Number.isSafeInteger(result.count) || result.count! < 0) {
          reject(new PreviewMigrationError('Không xác minh được kiểm tra preview cũ. Vui lòng thử lại.'))
        } else resolve(result.count!)
      }
      worker.postMessage({ type: 'CHECK_LEGACY_CLIENTS_V1' }, [channel.port2])
    }))
  } finally { channel.port1.close(); channel.port2.close() }
}

export async function cleanupLegacyPreviewEnvironment(): Promise<void> {
  if (typeof window === 'undefined') return // Non-browser tests/SSR have no browser sessions.
  try {
    closeLegacyPreviewFrames(document, location.origin)
    if ('serviceWorker' in navigator) {
      await timeout(unregisterLegacyPreviewWorkers(navigator.serviceWorker, location.origin))
      const count = await timeout(inspectLegacyClients(navigator.serviceWorker))
      if (count) throw new PreviewMigrationError(`Còn ${count} tab hoặc cửa sổ preview/Workboard cũ. Đóng chúng rồi bấm Thử lại. Nếu không tìm thấy, mở Codex bằng browser profile mới.`)
    }
    // No enumeration API is not an integrity claim; the clean-profile rule still applies.
    if ('caches' in window) await timeout(removeLegacyPreviewCacheEntries(caches, location.origin))
  } catch (error) {
    if (error instanceof PreviewMigrationError) throw error
    throw new PreviewMigrationError('Không hoàn tất kiểm tra preview cũ. Đóng các tab preview/Workboard cũ, kiểm tra mạng rồi bấm Thử lại; hoặc dùng browser profile mới.')
  }
}

/** Single-flight barrier shared by initial UI, restore and future unlock flows.
 * Recheck immediately before creating/unlocking credentials; failures never mark ready. */
export function createPreviewMigrationBarrier(cleanup: () => Promise<void>) {
  let ready = false
  let pending: Promise<void> | undefined
  return (recheck = false): Promise<void> => {
    if (pending) return pending
    if (ready && !recheck) return Promise.resolve()
    ready = false
    pending = Promise.resolve().then(cleanup).then(() => { ready = true }).finally(() => { pending = undefined })
    return pending
  }
}

export const ensurePreviewMigrationReady = createPreviewMigrationBarrier(cleanupLegacyPreviewEnvironment)
