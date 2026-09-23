import { constants } from 'node:fs'
import { allowedFilePath, type FileAccess } from './file-policy.js'
import { open, realpath, stat, statfs, type FileHandle } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, extname, isAbsolute, resolve } from 'node:path'

export const MAX_TEXT_PREVIEW_BYTES = 10 * 1024 * 1024
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
  '.env', '.pem', '.key', '.pub', '.c', '.cc', '.cjs', '.conf', '.cpp', '.cs', '.css', '.csv', '.env.example',
  '.fish', '.go', '.graphql', '.h', '.hpp', '.htm', '.html', '.ini', '.java', '.js',
  '.json', '.jsx', '.log', '.lua', '.md', '.markdown', '.mjs', '.properties', '.py',
  '.rb', '.rs', '.scss', '.sh', '.sql', '.svg', '.toml', '.ts', '.tsx', '.txt', '.xml',
  '.yaml', '.yml', '.zsh',
])

const TEXT_FILENAMES = new Set([
  'AGENTS.md', 'CHANGELOG', 'CODEOWNERS', 'Dockerfile', 'LICENSE', 'Makefile',
  'README', 'SECURITY', '.env', '.npmrc', '.netrc', '.gitignore', '.bashrc', '.profile', 'authorized_keys', 'known_hosts',
])

const inspected = new WeakMap<ServerFileInfo, { roots: string[]; mode: FileAccess; dev: number; ino: number }>()
async function policyOpen(path: string, roots: string[], mode: FileAccess): Promise<FileHandle> {
  if (!allowedFilePath(path, roots, mode)) throw new ServerFileError(403, 'File access is not allowed')
  // Do not open devices/FIFOs for metadata. Recheck the actual opened descriptor too.
  if (!(await stat(path)).isFile()) throw new ServerFileError(415, 'Only regular files can be opened')
  let handle: FileHandle
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK) }
  catch (error) {
    if (['ELOOP', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw new ServerFileError(403, 'File access is not allowed')
    throw error
  }
  try {
    // Verify the opened descriptor, not just the earlier pathname: parent
    // directories can be replaced with symlinks between realpath and open.
    const openedPath = await realpath(`/proc/self/fd/${handle.fd}`)
    if (!allowedFilePath(openedPath, roots, mode) || !(await handle.stat()).isFile()) throw new ServerFileError(403, 'File access is not allowed')
    // proc/sys/debug/trace/security/cgroup regular-looking nodes are kernel interfaces,
    // not ordinary files. Reject before the first read, including aliases/symlinks.
    const filesystem = await statfs(`/proc/self/fd/${handle.fd}`)
    if ([0x9fa0, 0x62656572, 0x64626720, 0x74726163, 0x73636673, 0x27e0eb, 0x63677270].includes(filesystem.type)) throw new ServerFileError(415, 'Virtual kernel files cannot be streamed')
    return handle
  } catch (error) { await handle.close(); throw error }
}
export async function openInspectedFile(file: ServerFileInfo): Promise<FileHandle> {
  const policy = inspected.get(file)
  if (!policy) throw new ServerFileError(403, 'File must be inspected before reading')
  let handle: FileHandle | undefined
  try {
    handle = await policyOpen(file.path, policy.roots, policy.mode)
    const metadata = await handle.stat()
    if (metadata.dev !== policy.dev || metadata.ino !== policy.ino || metadata.size !== file.size || metadata.mtime.toISOString() !== file.modifiedAt) {
      throw new ServerFileError(409, 'File changed; open it again')
    }
    return handle
  } catch (error) {
    await handle?.close()
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw new ServerFileError(409, 'File changed; open it again')
    if (['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw new ServerFileError(403, 'File is not readable')
    throw error
  }
}
export async function readInspectedFile(file: ServerFileInfo, limit = MAX_PPTX_PREVIEW_BYTES, live?: () => void): Promise<Buffer> {
  const handle = await openInspectedFile(file)
  try {
    live?.()
    if (file.size > limit) throw new ServerFileError(413, 'File exceeds the buffered preview limit')
    // Read exactly the inspected size: a concurrent append cannot grow memory use.
    const bytes = Buffer.alloc(file.size)
    let offset = 0
    while (offset < bytes.length) {
      live?.()
      const read = await handle.read(bytes, offset, Math.min(64 * 1024, bytes.length - offset), offset)
      live?.()
      if (!read.bytesRead) throw new ServerFileError(409, 'File changed; open it again')
      offset += read.bytesRead
    }
    return bytes
  } finally { await handle.close() }
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
  if (lower === '.env' || lower.startsWith('.env.')) return '.env'
  return extname(lower)
}

export async function inspectServerFile(input: unknown, workspaceRoots: string[], mode: FileAccess = 'restricted'): Promise<ServerFileInfo> {
  if (typeof input !== 'string' || input.length === 0 || input.length > 4096 || !isAbsolute(input)) {
    throw new ServerFileError(400, 'File path must be an absolute path')
  }

  if (!allowedFilePath(input, workspaceRoots, mode)) throw new ServerFileError(403, 'File access is not allowed')
  let path: string
  try {
    path = await realpath(resolve(input))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') throw new ServerFileError(404, 'File not found')
    if (code === 'EACCES') throw new ServerFileError(403, 'File is not readable')
    throw error
  }

  if (!allowedFilePath(path, workspaceRoots, mode)) {
    throw new ServerFileError(403, 'File is outside the configured file roots')
  }

  let metadata
  let leadingBytes: Buffer
  try {
    const handle = await policyOpen(path, workspaceRoots, mode)
    try {
      metadata = await handle.stat()
      const buffer = Buffer.alloc(16)
      const { bytesRead } = await handle.read(buffer, 0, 16, 0)
      leadingBytes = buffer.subarray(0, bytesRead)
    } finally { await handle.close() }
  } catch (error) {
    if (error instanceof ServerFileError) throw error
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') throw new ServerFileError(404, 'File not found')
    if (code === 'EACCES' || code === 'EPERM') throw new ServerFileError(403, 'File is not readable')
    throw error
  }
  const remember = (file: ServerFileInfo) => { inspected.set(file, { roots: [...workspaceRoots], mode, dev: metadata.dev, ino: metadata.ino }); return file }
  const name = basename(path)
  const extension = textExtension(name)
  const detected = binaryKind(extension, leadingBytes)
  const timestamps = {
    createdAt: metadata.birthtime.toISOString(),
    modifiedAt: metadata.mtime.toISOString(),
  }
  if (detected) {
    return remember({
      path,
      name,
      size: metadata.size,
      extension,
      ...detected,
      previewable: detected.kind === 'pptx' ? metadata.size <= MAX_PPTX_PREVIEW_BYTES : detected.kind === 'docx' ? metadata.size <= MAX_DOCX_PREVIEW_BYTES : detected.kind !== 'download',
      ...timestamps,
    })
  }

  const plainLeadingBytes = !leadingBytes.some(byte => byte === 0 || (byte < 32 && ![9, 10, 13].includes(byte)))
  const text = TEXT_EXTENSIONS.has(extension) || TEXT_FILENAMES.has(name)
    || (mode === 'owner-full' && (name.startsWith('.') || !extension) && plainLeadingBytes)
  if (text) {
    return remember({
      path,
      name,
      size: metadata.size,
      extension,
      contentType: 'text/plain; charset=utf-8',
      kind: 'text',
      previewable: metadata.size <= MAX_TEXT_PREVIEW_BYTES,
      ...timestamps,
    })
  }

  return remember({
    path,
    name,
    size: metadata.size,
    extension,
    contentType: 'application/octet-stream',
    kind: 'download',
    previewable: false,
    ...timestamps,
  })
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

export async function serveServerFile(
  req: IncomingMessage,
  res: ServerResponse,
  file: ServerFileInfo,
  download: boolean,
  live?: () => void,
): Promise<void> {
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

  const handle = await openInspectedFile(file)
  try { live?.() } catch (error) { await handle.close(); throw error }
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
    await handle.close()
    res.end()
    return
  }
  const stream = handle.createReadStream({ start, end, autoClose: true })
  stream.on('error', () => res.destroy())
  res.once('close', () => stream.destroy())
  stream.pipe(res)
}
