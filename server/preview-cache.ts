import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

type Headers = Record<string, string | string[]>
export const MAX_CACHE_BODY_BYTES = 16 * 1024 * 1024

/** Browser storage only, always revalidated after gateway auth. No proxy cache. */
export function previewCacheable(req: IncomingMessage, path: string, status: number, upstream: IncomingMessage['headers']): boolean {
  let pathname: string
  try { pathname = decodeURIComponent(new URL(path, 'http://preview.invalid').pathname) } catch { return false }
  const policy = String(upstream['cache-control'] ?? '')
  const type = String(upstream['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  const asset = /(?:javascript|ecmascript)$/.test(type) || type === 'text/css'
  // HTML may be dynamic: require an explicit upstream cache/validator signal.
  const html = type === 'text/html' && Boolean(upstream.etag || /(?:^|,)\s*(?:no-cache|max-age|private|public)(?:\s|=|,|$)/i.test(policy))
  return ['GET', 'HEAD'].includes(req.method ?? '') && status === 200 && (asset || html)
    && !/(?:^|\/)(?:api|auth|session|login|logout|events|__codex_preview__)(?:\/|$)/i.test(pathname)
    && !req.headers.authorization && !req.headers.range && !req.headers['if-match'] && !req.headers['if-unmodified-since']
    && !/(?:^|,)\s*no-store(?:\s|,|$)/i.test(policy)
    && !/(?:^|,)\s*no-store(?:\s|,|$)/i.test(String(req.headers['cache-control'] ?? ''))
    && !upstream['set-cookie'] && !upstream['content-encoding']
    && !String(upstream.vary ?? '').split(',').some(field => field.trim() === '*')
}

export function noPreviewCache(headers: Headers): void {
  const noTransform = /(?:^|,)\s*no-transform(?:\s|,|$)/i.test(String(headers['cache-control'] ?? ''))
  headers['cache-control'] = 'no-store' + (noTransform ? ', no-transform' : '')
  delete headers.expires
  delete headers.age
  // Prevent a downstream shared-cache policy overriding Cache-Control.
  delete headers['cdn-cache-control']
  delete headers['surrogate-control']
  delete headers['cloudflare-cdn-cache-control']
}

/** Hash the delivered bytes, including any rewrite, never reuse upstream validators. */
export function validatePreviewBody(req: IncomingMessage, headers: Headers, body: Buffer): boolean {
  const etag = '"preview-' + createHash('sha256').update(body).digest('base64url') + '"'
  noPreviewCache(headers)
  headers['cache-control'] = 'private, no-cache, must-revalidate' + (String(headers['cache-control']).includes('no-transform') ? ', no-transform' : '')
  headers.etag = etag
  delete headers['last-modified']
  const vary = String(headers.vary ?? '').split(',').map(value => value.trim()).filter(Boolean)
  if (!vary.some(value => value.toLowerCase() === 'cookie')) vary.push('Cookie')
  headers.vary = vary.join(', ')
  headers['content-length'] = String(body.length)
  // GET/HEAD If-None-Match uses weak comparison; quoted opaque tags may contain commas.
  const matches = req.headers['if-none-match']?.match(/(?:W\/)?"[^"]*"|\*/g) ?? []
  return matches.some(value => value === '*' || value.replace(/^W\//, '') === etag)
}

export function previewRequestHeaders(headers: Headers): void {
  // A downstream validator describes our representation. Always obtain current
  // bytes, then decide 304 locally; never let upstream return its unrelated 304.
  delete headers['if-none-match']
  delete headers['if-modified-since']
}
