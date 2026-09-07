import { api } from './api'

export function pushSupported(): boolean {
  return window.isSecureContext && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window
}

export function applicationServerKey(key: string): Uint8Array<ArrayBuffer> {
  const value = atob(key.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(value, char => char.charCodeAt(0))
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const worker = await navigator.serviceWorker.getRegistration()
  if (!worker?.active) throw new Error('The app is updating. Reload once, then enable notifications again.')
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel()
    const finish = (supported: boolean) => {
      clearTimeout(timer)
      channel.port1.close()
      channel.port2.close()
      if (supported) resolve()
      else reject(new Error('Apply the app update and reload before enabling background notifications.'))
    }
    const timer = setTimeout(() => finish(false), 2000)
    channel.port1.onmessage = event => finish(event.data?.push === true)
    worker.active!.postMessage({ type: 'PUSH_CAPABILITY' }, [channel.port2])
  })
  return worker
}

export async function restorePush(csrf: string): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false
  const worker = await navigator.serviceWorker.getRegistration()
  const subscription = await worker?.pushManager.getSubscription()
  if (!subscription) return false
  await registration()
  // Rebind this device after login; never request permission without a tap.
  const { publicKey } = await api.pushKey()
  const current = subscription.options.applicationServerKey
  if (!current || new Uint8Array(current).join(',') !== applicationServerKey(publicKey).join(',')) return false
  await api.subscribePush(subscription.toJSON(), csrf)
  return true
}

export async function enablePush(csrf: string): Promise<void> {
  if (!pushSupported()) throw new Error('Push notifications need HTTPS and a supported browser. On iPhone, open the installed Home Screen app.')
  // Keep permission directly in the button gesture for mobile browsers.
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Allow notifications for this app in browser settings, then try again.')
  const worker = await registration()
  const { publicKey } = await api.pushKey()
  const key = applicationServerKey(publicKey)
  let subscription = await worker.pushManager.getSubscription()
  const current = subscription?.options.applicationServerKey
  if (subscription && (!current || new Uint8Array(current).join(',') !== key.join(','))) {
    await subscription.unsubscribe()
    subscription = null
  }
  subscription ??= await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  await api.subscribePush(subscription.toJSON(), csrf)
}

export async function disablePush(csrf: string): Promise<void> {
  // Remove server delivery first, so a browser unsubscribe failure cannot leave alerts enabled.
  await api.unsubscribePush(csrf)
}
