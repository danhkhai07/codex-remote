// Lock browser-level zoom only inside the installed app. File-viewer zoom buttons
// change their own content scale and are deliberately unaffected.
export function installPwaZoomLock() {
  const standalone = window.matchMedia('(display-mode: standalone)')
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  const originalViewport = viewport?.getAttribute('content') ?? 'width=device-width, initial-scale=1, viewport-fit=cover'
  const root = document.documentElement
  let locked = false
  const preventGesture = (event: Event) => { if (locked && event.cancelable) event.preventDefault() }
  const preventPinch = (event: TouchEvent) => {
    if (event.touches.length > 1) preventGesture(event)
  }
  const preventWheelZoom = (event: WheelEvent) => {
    if (event.ctrlKey) preventGesture(event)
  }
  const preventKeyZoom = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && ['+', '-', '=', '0'].includes(event.key)) preventGesture(event)
  }
  const removeListeners = () => {
    document.removeEventListener('gesturestart', preventGesture)
    document.removeEventListener('gesturechange', preventGesture)
    document.removeEventListener('touchstart', preventPinch)
    document.removeEventListener('touchmove', preventPinch)
    document.removeEventListener('wheel', preventWheelZoom)
    document.removeEventListener('keydown', preventKeyZoom)
  }
  const update = () => {
    locked = standalone.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
    root.classList.toggle('pwa-zoom-locked', locked)
    viewport?.setAttribute('content', locked
      ? 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
      : originalViewport)
    removeListeners()
    if (locked) {
      document.addEventListener('gesturestart', preventGesture, { passive: false })
      document.addEventListener('gesturechange', preventGesture, { passive: false })
      document.addEventListener('touchstart', preventPinch, { passive: false })
      document.addEventListener('touchmove', preventPinch, { passive: false })
      document.addEventListener('wheel', preventWheelZoom, { passive: false })
      document.addEventListener('keydown', preventKeyZoom)
    }
  }
  update()
  standalone.addEventListener('change', update)
  return () => {
    standalone.removeEventListener('change', update)
    removeListeners()
    root.classList.remove('pwa-zoom-locked')
    viewport?.setAttribute('content', originalViewport)
  }
}
