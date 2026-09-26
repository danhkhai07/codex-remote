import type { ComponentPropsWithoutRef } from 'react'

type MarkdownTableProps = ComponentPropsWithoutRef<'table'> & { node?: unknown }

type MarkdownNode = { tagName?: unknown; value?: unknown; children?: unknown }

function textContent(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const { value, children } = node as MarkdownNode
  return `${typeof value === 'string' ? value : ''}${Array.isArray(children) ? children.map(textContent).join('') : ''}`
}

function needsReadableColumns(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false
  const { tagName, children } = node as MarkdownNode
  if ((tagName === 'th' || tagName === 'td') && textContent(node).trim().length >= 48) return true
  return Array.isArray(children) && children.some(needsReadableColumns)
}

export function MarkdownTable({ children, node, ...props }: MarkdownTableProps) {
  const className = needsReadableColumns(node) ? 'markdown-table-scroll is-content-wide' : 'markdown-table-scroll'
  return <div className={className}><table {...props}>{children}</table></div>
}
