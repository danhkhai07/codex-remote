import { renderToString } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { useYoloPreference, YOLO_PREFERENCE_KEY } from './useYoloPreference'

function Preference() {
  const [enabled] = useYoloPreference()
  return <span>{enabled ? 'enabled' : 'disabled'}</span>
}
afterEach(() => vi.unstubAllGlobals())
it('restores the saved selection when the app mounts again', () => {
  let value = 'enabled'
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === YOLO_PREFERENCE_KEY ? value : null })
  expect(renderToString(<Preference />)).toContain('enabled')
  expect(renderToString(<Preference />)).toContain('enabled')
  value = 'disabled'
  expect(renderToString(<Preference />)).toContain('disabled')
})
it('does not crash when browser storage is unavailable', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') } })
  expect(renderToString(<Preference />)).toContain('disabled')
})
