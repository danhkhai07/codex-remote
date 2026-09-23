import { api } from './api'
import { parseBrowserAddress, type BrowserAddress } from './browserAddress'
import { secureIntent } from './secureApi'

export type ReservedBrowserTab = {
  address: BrowserAddress
  tab: Window
}

export function reserveBrowserTab(value: string, origin = window.location.origin): ReservedBrowserTab {
  const address = parseBrowserAddress(value, origin)
  if (!address) throw new Error('Địa chỉ Browser không hợp lệ.')
  // Reserve synchronously while the click/auxclick still carries user activation.
  const tab = window.open('about:blank', '_blank')
  if (!tab) throw new Error('Trình duyệt đã chặn tab mới. Cho phép popup rồi thử lại.')
  tab.opener = null
  return { address, tab }
}

export async function navigateReservedBrowserTab(reservation: ReservedBrowserTab, csrf: string, signal?: AbortSignal): Promise<void> {
  const intent = secureIntent()
  intent.assert()
  try {
    const result = reservation.address.kind === 'localhost'
      ? await api.launchLocalhostPreview(reservation.address.local.port, reservation.address.local.path, csrf, signal)
      : { url: reservation.address.url, viewUrl: reservation.address.url }
    intent.assert()
    const url = new URL(result.url)
    const viewUrl = new URL(result.viewUrl)
    const allowedProtocol = url.protocol === 'https:' || (window.location.protocol === 'http:' && url.protocol === 'http:')
    if (reservation.address.kind === 'localhost' && (!allowedProtocol || url.origin === window.location.origin || viewUrl.origin !== url.origin)) {
      throw new Error('Địa chỉ preview không hợp lệ.')
    }
    if (reservation.tab.closed) throw new Error('Tab preview đã đóng. Hãy mở lại.')
    reservation.tab.location.replace(result.url)
  } catch (error) {
    reservation.tab.close()
    throw error
  }
}
