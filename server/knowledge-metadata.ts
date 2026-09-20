import { createHash } from 'node:crypto'
import type { KnowledgeMeta } from './knowledge-types.js'

export const revisionOf = (text: string) => createHash('sha256').update(text).digest('hex')
export const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase()
export const wikiTargets = (text: string) => [...text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(match => match[1].replace(/\.md(?=#|$)/, ''))
export const noteBody = (text: string) => text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')

function scalar(text: string) {
  const value = text.trim()
  if (value.startsWith('"')) { try { return String(JSON.parse(value)) } catch { return value.slice(1, -1) } }
  return value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1).replace(/''/g, "'") : value.replace(/\s+#.*$/, '')
}

/** Read the simple scalar/list properties used by the vault without rewriting unknown YAML. */
export function metadata(text: string): KnowledgeMeta {
  const header = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? ''
  const fields: Record<string, string | string[]> = {}
  let active = ''
  for (const line of header.split(/\r?\n/)) {
    const field = line.match(/^([\w-]+):\s*(.*)$/)
    if (field) {
      active = field[1]
      const value = field[2].trim()
      if (value.startsWith('[')) {
        try { fields[active] = JSON.parse(value) as string[] }
        catch { fields[active] = [...value.slice(1, -1).matchAll(/"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,]+/g)].map(match => scalar(match[0])) }
      } else fields[active] = scalar(value)
    } else if (active && /^\s+-\s+/.test(line)) {
      const values = Array.isArray(fields[active]) ? fields[active] as string[] : []
      fields[active] = [...values, scalar(line.replace(/^\s+-\s+/, ''))]
    }
  }
  const str = (key: string) => typeof fields[key] === 'string' ? fields[key] as string : Array.isArray(fields[key]) ? (fields[key] as string[]).join(', ') : ''
  const list = (key: string) => ((Array.isArray(fields[key]) ? fields[key] : fields[key] ? [fields[key]] : []) as unknown[]).filter((value): value is string => typeof value === 'string')
  return { type: str('type'), status: str('status') || 'unclassified', scope: str('scope'), updated: str('updated'), sources: list('sources'), related: list('related'), aliases: list('aliases'), repositories: list('repositories'), decisionKey: str('decision-key'), supersedes: list('supersedes') }
}

export function titleOf(path: string, content: string) {
  return noteBody(content).match(/^#\s+(.+)$/m)?.[1] ?? path.split('/').at(-1)!.replace(/\.md$/, '').replace(/-/g, ' ')
}
