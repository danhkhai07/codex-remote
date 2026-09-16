import { createReadStream } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, extname, isAbsolute, resolve, sep } from 'node:path'

export const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024
export const MAX_DOCX_PREVIEW_BYTES = 20 * 1024 * 1024
export const MAX_PPTX_PREVIEW_BYTES = 20 * 1024 * 1024

export type ServerFileKind = 'text' | 'image' | 'pdf' | 'docx' | 'pptx' | 'download'

export type ServerFileInfo = {
  path: string
  name: string
  size: number
  extension: string
  contentType: string
  kind: ServerFileKind
  previewable: boolean
  createdAt: string
  modifiedAt: string
}

export class ServerFileError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cjs', '.conf', '.cpp', '.cs', '.css', '.csv', '.env.example',
  '.fish', '.go', '.graphql', '.h', '.hpp', '.htm', '.html', '.ini', '.java', '.js',
  '.json', '.jsx', '.log', '.lua', '.md', '.markdown', '.mjs', '.properties', '.py',
  '.rb', '.rs', '.scss', '.sh', '.sql', '.svg', '.toml', '.ts', '.tsx', '.txt', '.xml',
  '.yaml', '.yml', '.zsh',
])

const TEXT_FILENAMES = new Set([
  'AGENTS.md', 'CHANGELOG', 'CODEOWNERS', 'Dockerfile', 'LICENSE', 'Makefile',
  'README', 'SECURITY',
])

function insideRoot(path: string, root: string): boolean {
  return root === sep || path === root || path.startsWith(`${root}${sep}`)
}

async function prefix(path: string, length = 16): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

function binaryKind(extension: string, bytes: Buffer): Pick<ServerFileInfo, 'kind' | 'contentType'> | null {
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const webp = bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
  const gif = bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))
  const pdf = bytes.length >= 5 && bytes.toString('ascii', 0, 5) === '%PDF-'
  const zipSignature = bytes.length >= 4 ? bytes.toString('hex', 0, 4) : ''
  const zip = ['504b0304', '504b0506', '504b0708'].includes(zipSignature)
  if (extension === '.png' && png) return { kind: 'image', contentType: 'image/png' }
  if (['.jpg', '.jpeg'].includes(extension) && jpeg) return { kind: 'image', contentType: 'image/jpeg' }
  if (extension === '.webp' && webp) return { kind: 'image', contentType: 'image/webp' }
  if (extension === '.gif' && gif) return { kind: 'image', contentType: 'image/gif' }
  if (extension === '.pdf' && pdf) return { kind: 'pdf', contentType: 'application/pdf' }
  if (extension === '.docx' && zip) return {
    kind: 'docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }
  if (extension === '.pptx' && zip) return {
    kind: 'pptx',
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }
  return null
}

function textExtension(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.env.example')) return '.env.example'
  return extname(lower)
}

export async function inspectServerFile(input: unknown, workspaceRoots: string[]): Promise<ServerFileInfo> {
  if (typeof input !== 'string' || input.length === 0 || input.length > 4096 || !isAbsolute(input)) {
    throw new ServerFileError(400, 'File path must be an absolute path')
  }

  let path: string
  try {
    path = await realpath(resolve(input))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') throw new ServerFileError(404, 'File not found')
    if (code === 'EACCES') throw new ServerFileError(403, 'File is not readable')
    throw error
  }

  if (!workspaceRoots.some(root => insideRoot(path, root))) {
    throw new ServerFileError(403, 'File is outside the configured file roots')
  }

  let metadata
  let leadingBytes: Buffer
  try {
    metadata = await stat(path)
    if (!metadata.isFile()) throw new ServerFileError(400, 'Path is not a regular file')
    leadingBytes = await prefix(path)
  } catch (error) {
    if (error instanceof ServerFileError) throw error
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') throw new ServerFileError(404, 'File not found')
    if (code === 'EACCES' || code === 'EPERM') throw new ServerFileError(403, 'File is not readable')
    throw error
  }
  const name = basename(path)
  const extension = textExtension(name)
  const detected = binaryKind(extension, leadingBytes)
  const timestamps = {
    createdAt: metadata.birthtime.toISOString(),
    modifiedAt: metadata.mtime.toISOString(),
  }
  if (detected) {
    return {
      path,
      name,
      size: metadata.size,
      extension,
      ...detected,
      previewable: detected.kind === 'pptx' ? metadata.size <= MAX_PPTX_PREVIEW_BYTES : detected.kind === 'docx' ? metadata.size <= MAX_DOCX_PREVIEW_BYTES : detected.kind !== 'download',
      ...timestamps,
    }
  }

  const text = TEXT_EXTENSIONS.has(extension) || TEXT_FILENAMES.has(name)
  if (text) {
    return {
      path,
      name,
      size: metadata.size,
      extension,
      contentType: 'text/plain; charset=utf-8',
      kind: 'text',
      previewable: metadata.size <= MAX_TEXT_PREVIEW_BYTES,
      ...timestamps,
    }
  }

  return {
    path,
    name,
    size: metadata.size,
    extension,
    contentType: 'application/octet-stream',
    kind: 'download',
    previewable: false,
    ...timestamps,
  }
}

function encodedFilename(name: string): string {
  return encodeURIComponent(name).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

function disposition(name: string, download: boolean): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_') || 'download'
  return `${download ? 'attachment' : 'inline'}; filename="${fallback}"; filename*=UTF-8''${encodedFilename(name)}`
}

function byteRange(value: string | undefined, size: number): { start: number; end: number } | null {
  if (!value) return null
  const match = value.match(/^bytes=(\d*)-(\d*)$/)
  if (!match || (!match[1] && !match[2]) || size === 0) throw new ServerFileError(416, 'Invalid byte range')
  let start: number
  let end: number
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new ServerFileError(416, 'Invalid byte range')
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
      throw new ServerFileError(416, 'Invalid byte range')
    }
    end = Math.min(end, size - 1)
  }
  return { start, end }
}

export function serveServerFile(
  req: IncomingMessage,
  res: ServerResponse,
  file: ServerFileInfo,
  download: boolean,
): void {
  if (!download && !file.previewable) {
    throw new ServerFileError(file.kind === 'text' ? 413 : 415, file.kind === 'text'
      ? `Text preview is limited to ${MAX_TEXT_PREVIEW_BYTES / 1024 / 1024} MB; download the file instead`
      : 'This file type can only be downloaded')
  }

  let range: { start: number; end: number } | null
  try {
    range = byteRange(req.headers.range, file.size)
  } catch (error) {
    if (error instanceof ServerFileError && error.status === 416) {
      res.setHeader('Content-Range', `bytes */${file.size}`)
    }
    throw error
  }

  const start = range?.start ?? 0
  const end = range?.end ?? Math.max(0, file.size - 1)
  const contentLength = file.size === 0 ? 0 : end - start + 1
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Content-Type', file.contentType)
  res.setHeader('Content-Disposition', disposition(file.name, download))
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Length', contentLength)
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'")
  if (range) {
    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`)
  } else res.statusCode = 200

  if (req.method === 'HEAD' || file.size === 0) {
    res.end()
    return
  }
  createReadStream(file.path, { start, end }).pipe(res)
}
