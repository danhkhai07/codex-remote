/** Remove registrations from the former shared-origin preview paths, preserving
 * the app worker and local drafts. Already open legacy tabs still need closing. */
export async function unregisterLegacyPreviewWorkers(workers: Pick<ServiceWorkerContainer, 'getRegistrations'>, origin: string): Promise<void> {
  for (const registration of await workers.getRegistrations()) {
    const scope = new URL(registration.scope)
    if (scope.origin === origin && (scope.pathname.startsWith('/preview/') || scope.pathname.startsWith('/workboard/'))) await registration.unregister()
  }
}
