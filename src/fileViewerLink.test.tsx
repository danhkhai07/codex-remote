import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownMessage, parseLocalFileReference } from './MarkdownMessage'
import { fileViewerReference, fileViewerUrl, regularLinkClick } from './fileViewerLink'
it('preserves exact paths/line numbers through an owner-unlocked app URL', () => {
  const file = { path: '/root/.local/My report #1?%.env', line: 42 }
  expect(fileViewerReference(fileViewerUrl(file))).toEqual(file)
  expect(parseLocalFileReference(fileViewerUrl(file))).toEqual(file)
  expect(fileViewerReference('/files?path=relative')).toBeNull()
  expect(fileViewerReference('/files?path=%2Ftmp%2F%00')).toBeNull()
  expect(fileViewerReference('https://other.test/files?path=/etc/hosts')).toBeNull()
  const html = renderToStaticMarkup(<MarkdownMessage>{'[Local](/root/.env:42)'}</MarkdownMessage>)
  expect(html).toContain('href="/files?path=%2Froot%2F.env&amp;line=42"')
})
it('intercepts ordinary clicks only; modified/middle clicks retain native new-tab behavior', () => {
  const regular = { button: 0, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }
  expect(regularLinkClick(regular)).toBe(true)
  for (const key of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey']) expect(regularLinkClick({ ...regular, [key]: true })).toBe(false)
  expect(regularLinkClick({ ...regular, button: 1 })).toBe(false)
})
