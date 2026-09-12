import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownMessage, parseLocalFileReference, stabilizeStreamingMarkdown } from './MarkdownMessage'

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

  it('recognizes absolute server file links and preserves line targets', () => {
    expect(parseLocalFileReference('/root/project/README.md:42')).toEqual({ path: '/root/project/README.md', line: 42 })
    expect(parseLocalFileReference('/root/My%20Project/report.pdf')).toEqual({ path: '/root/My Project/report.pdf' })
    expect(parseLocalFileReference('/root/project/app.ts#L9C2')).toEqual({ path: '/root/project/app.ts', line: 9 })
    expect(parseLocalFileReference('file:///root/My%20Project/app.ts#L9C2')).toEqual({ path: '/root/My Project/app.ts', line: 9 })
    expect(parseLocalFileReference('file://another-host/root/project/app.ts')).toBeNull()
    expect(parseLocalFileReference('https://example.com/file.pdf')).toBeNull()
    expect(parseLocalFileReference('/api/healthz')).toBeNull()

    const html = renderToStaticMarkup(<MarkdownMessage>{'[Readme](/root/project/README.md:42)'}</MarkdownMessage>)
    expect(html).toContain('data-local-file="true"')
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
