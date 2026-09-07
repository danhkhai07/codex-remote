import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

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

export function MarkdownMessage({ children, streaming = false }: { children: string; streaming?: boolean }) {
  return (
    <div className={`message-markdown ${streaming ? 'is-streaming' : ''}`} aria-busy={streaming || undefined}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children: linkChildren, href, title }) => {
            const external = href?.startsWith('http://') || href?.startsWith('https://')
            return (
              <a
                href={href}
                title={title}
                target={external ? '_blank' : undefined}
                rel={external ? 'noreferrer' : undefined}
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
