import { afterEach, describe, expect, it, vi } from 'vitest'
import { enterSendsMessage, isComposerSubmitKey } from './composerKeyboard'
afterEach(() => vi.unstubAllGlobals())

describe('composer Return key', () => {
  it.each([
    ['iPhone', 5, false, false],
    ['Android', 0, false, false],
    ['Macintosh', 5, false, false], // iPad desktop mode, including with a mouse.
    ['desktop', 0, true, false],
    ['desktop', 0, false, true],
  ])('selects Enter behavior for %s, touch points %i, coarse pointer %s', (userAgent, maxTouchPoints, coarse, expected) => {
    vi.stubGlobal('navigator', { userAgent, maxTouchPoints })
    vi.stubGlobal('window', { matchMedia: () => ({ matches: coarse }) })
    expect(enterSendsMessage()).toBe(expected)
  })
  it('allows mobile Return, desktop Shift+Enter and IME confirmation without submitting', () => {
    const enter = { key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false, keyCode: 13 } }
    expect(isComposerSubmitKey(enter, false)).toBe(false)
    expect(isComposerSubmitKey(enter, true)).toBe(true)
    expect(isComposerSubmitKey({ ...enter, shiftKey: true }, true)).toBe(false)
    expect(isComposerSubmitKey({ ...enter, nativeEvent: { isComposing: true, keyCode: 13 } }, true)).toBe(false)
    expect(isComposerSubmitKey({ ...enter, nativeEvent: { isComposing: false, keyCode: 229 } }, true)).toBe(false)
  })
})
