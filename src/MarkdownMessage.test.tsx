import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownMessage, stabilizeStreamingMarkdown } from './MarkdownMessage'

describe('MarkdownMessage', () => {
  it('renders GitHub-flavored Markdown and safe external links', () => {
    const html = renderToStaticMarkup(
      <MarkdownMessage>{'**Done**\n\n| File | Status |\n| --- | --- |\n| app.ts | ✅ |\n\n[Docs](https://example.com)'}</MarkdownMessage>,
    )

    expect(html).toContain('<strong>Done</strong>')
    expect(html).toContain('<table>')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noreferrer"')
  })

  it('does not render raw HTML from conversation content', () => {
    const html = renderToStaticMarkup(
      <MarkdownMessage>{'<script>alert(1)</script><strong>unsafe</strong>'}</MarkdownMessage>,
    )

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<strong>unsafe</strong>')
  })

  it('stabilizes incomplete formatting while a message streams', () => {
    expect(stabilizeStreamingMarkdown('**Working')).toBe('**Working**')
    expect(stabilizeStreamingMarkdown('Use `npm run')).toBe('Use `npm run`')
    expect(stabilizeStreamingMarkdown('```ts\nconst ready = true')).toBe('```ts\nconst ready = true\n\n```')

    const html = renderToStaticMarkup(<MarkdownMessage streaming>{'**Working'}</MarkdownMessage>)
    expect(html).toContain('<strong>Working</strong>')
    expect(html).toContain('aria-busy="true"')
  })
})
