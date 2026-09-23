import { fileViewerReference, fileViewerUrl, regularLinkClick } from './fileViewerLink'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export type LocalFileReference = { path: string; line?: number }
export type WebLinkReference = { url: string; label?: string }

export function parseLocalFileReference(href: string | undefined): LocalFileReference | null {
  if (!href) return null
  const viewer = fileViewerReference(href)
  if (viewer) return viewer
  let value: string
  try {
    if (href.startsWith('file://')) {
      const url = new URL(href)
      if (url.hostname && url.hostname !== 'localhost') return null
      value = `${decodeURIComponent(url.pathname)}${decodeURIComponent(url.hash)}`
    } else value = decodeURIComponent(href)
  } catch {
    return null
  }
  if (!value.startsWith('/') || value.startsWith('/api/')) return null

  let line: number | undefined
  const hash = value.match(/#L(\d+)(?:C\d+)?$/i)
  if (hash) {
    line = Number(hash[1])
    value = value.slice(0, -hash[0].length)
  } else {
    const suffix = value.match(/:(\d+)(?::\d+)?$/)
    if (suffix) {
      line = Number(suffix[1])
      value = value.slice(0, -suffix[0].length)
    }
  }
  return { path: value, ...(line && line > 0 ? { line } : {}) }
}

function countUnescaped(value: string, token: string): number {
  let count = 0
  for (let index = 0; index <= value.length - token.length; index += 1) {
    if (value.slice(index, index + token.length) !== token) continue
    let escapes = 0
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) escapes += 1
    if (escapes % 2 === 0) count += 1
    index += token.length - 1
  }
  return count
}

export function stabilizeStreamingMarkdown(value: string): string {
  let stable = value
  const fences = countUnescaped(stable, '```')
  if (fences % 2 === 1) return `${stable.replace(/\s*$/, '')}\n\n\`\`\``

  const inlineTicks = countUnescaped(stable, '`')
  if (inlineTicks % 2 === 1) stable += '`'

  const boldMarkers = countUnescaped(stable, '**')
  if (boldMarkers % 2 === 1) stable += '**'
  return stable
}

export function MarkdownMessage({ children, streaming = false, onOpenFile, onOpenLink }: {
  children: string
  streaming?: boolean
  onOpenFile?: (reference: LocalFileReference) => void
  onOpenLink?: (reference: WebLinkReference) => void
}) {
  return (
    <div className={`message-markdown ${streaming ? 'is-streaming' : ''}`} aria-busy={streaming || undefined}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children: linkChildren, href, title }) => {
            const internalPage = Boolean(href && /^\/(?:knowledge|services|working-hours|workboard|preview)(?:[/?#]|$)/.test(href))
            const external = href?.startsWith('http://') || href?.startsWith('https://')
            const localFile = internalPage ? null : parseLocalFileReference(href)
            const label = typeof linkChildren === 'string' ? linkChildren : undefined
            return (
              <a
                href={localFile ? fileViewerUrl(localFile) : href}
                title={title}
                target={external ? '_blank' : undefined}
                rel={external ? 'noreferrer' : undefined}
                data-local-file={localFile ? 'true' : undefined}
                onClick={localFile && onOpenFile
                  ? (event) => {
                    if (!regularLinkClick(event)) return
                    event.preventDefault()
                    onOpenFile(localFile)
                  }
                  : (external || internalPage) && href && onOpenLink
                    ? (event) => {
                      event.preventDefault()
                      onOpenLink({ url: href, label })
                    }
                    : undefined}
              >
                {linkChildren}
              </a>
            )
          },
        }}
      >
        {streaming ? stabilizeStreamingMarkdown(children) : children}
      </ReactMarkdown>
    </div>
  )
}
