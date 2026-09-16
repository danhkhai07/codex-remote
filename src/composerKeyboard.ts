/** Touch devices keep the keyboard's Return key for multiline messages. */
export function enterSendsMessage(): boolean {
  if (typeof navigator === 'undefined') return false
  return navigator.maxTouchPoints === 0 &&
    !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) &&
    !(typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches)
}

export function isComposerSubmitKey(event: {
  key: string
  shiftKey: boolean
  nativeEvent: { isComposing: boolean; keyCode: number }
}, enterToSend: boolean): boolean {
  return enterToSend && event.key === 'Enter' && !event.shiftKey &&
    !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229
}
