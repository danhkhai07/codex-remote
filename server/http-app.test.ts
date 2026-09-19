import { WorkHoursStore } from './work-hours.js'
import { WorkPresence } from './work-presence.js'
import { promises as fs } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexAppServer } from './codex-app-server.js'
import type { RemoteConfig } from './config.js'
import { normalizeThreadName, RemoteController } from './controller.js'
import { createRemoteHttpServer } from './http-app.js'
import { PushService } from './push.js'
import { AttachmentStore } from './attachments.js'
import { PptxPreviewCache } from './pptx-preview.js'

type Response = {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

function fetchLocal(port: number, path: string, options: {
  method?: string
  host?: string
  origin?: string
  cookie?: string
  csrf?: string
  body?: unknown
  rawBody?: Buffer
  contentType?: string
  range?: string
} = {}): Promise<Response> {
  const encoded = options.rawBody ?? (options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body)))
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: '127.0.0.1',
      port,
      path,
      method: options.method ?? 'GET',
      headers: {
        Host: options.host ?? 'remote.example.test',
        ...(options.origin ? { Origin: options.origin } : {}),
        ...(options.cookie ? { Cookie: options.cookie } : {}),
        ...(options.csrf ? { 'X-CSRF-Token': options.csrf } : {}),
        ...(options.range ? { Range: options.range } : {}),
        ...(encoded ? {
          'Content-Type': options.contentType ?? 'application/json',
          'Content-Length': encoded.length,
        } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    req.on('error', reject)
    if (encoded) req.write(encoded)
    req.end()
  })
}

describe('Codex Remote HTTP boundary', () => {
  const cleanups: Array<() => Promise<void>> = []

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
  })

  it('requires a Codex login and CSRF token to launch an isolated localhost preview', async () => {
    const base = await fs.mkdtemp(join(tmpdir(), 'remote-preview-'))
    const config: RemoteConfig = {
      host: '127.0.0.1', port: 5173, publicOrigin: new URL('https://remote.example.test'),
      password: 'correct horse battery staple', sessionSecret: 's'.repeat(48), sessionTtlSeconds: 600,
      codexBin: 'unused', workspaceRoots: [base], production: true,
      previewOriginTemplate: 'https://p{port}.preview.example.test',
    }
    const server = createRemoteHttpServer(config, new RemoteController(config, new CodexAppServer('unused')), base, null)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    cleanups.push(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(base, { recursive: true, force: true }) })
    expect((await fetchLocal(port, '/api/localhost-preview')).status).toBe(401)
    const login = await fetchLocal(port, '/api/session/login', { method: 'POST', origin: config.publicOrigin.origin, body: { password: config.password } })
    const cookie = login.headers['set-cookie']?.[0].split(';', 1)[0]
    const options = { cookie, csrf: JSON.parse(login.body).csrf, origin: config.publicOrigin.origin }
    expect(JSON.parse((await fetchLocal(port, '/api/localhost-preview', options)).body)).toEqual({ enabled: true })
    const body = { port: 3000, path: '/dashboard?q=hello#chart' }
    expect((await fetchLocal(port, '/api/localhost-preview', { ...options, csrf: 'wrong', method: 'POST', body })).status).toBe(403)
    expect((await fetchLocal(port, '/api/localhost-preview', { ...options, origin: 'https://p3000.preview.example.test', method: 'POST', body })).status).toBe(403)
    const launch = await fetchLocal(port, '/api/localhost-preview', { ...options, method: 'POST', body })
    expect(launch.status).toBe(201)
    const result = JSON.parse(launch.body)
    expect(result.viewUrl).toBe('https://p3000.preview.example.test/dashboard?q=hello#chart')
    expect(new URL(result.url).hostname).toBe('p3000.preview.example.test')
    expect((await fetchLocal(port, '/api/localhost-preview', { ...options, method: 'POST', body: { port: 5173 } })).status).toBe(400)
    expect((await fetchLocal(port, '/api/localhost-preview', { ...options, method: 'POST', body: { port: 3000, path: '//evil.test/' } })).status).toBe(400)
    // A Codex session cookie alone never authenticates a preview origin.
    expect((await fetchLocal(port, '/', { cookie, host: 'p3000.preview.example.test' })).status).toBe(401)
    const url = new URL(result.url)
    const enter = await fetchLocal(port, url.pathname + url.search, { host: url.host })
    expect(enter.status).toBe(303)
    expect(enter.headers.location).toBe('/dashboard?q=hello#chart')
    expect(enter.headers['content-security-policy']).toBeUndefined()
  })

  it('uses separate file roots for authenticated browsing and previews outside the workspace', async () => {
    const base = await fs.mkdtemp(join(tmpdir(), 'remote-file-roots-'))
    const workspace = join(base, 'workspace')
    await fs.mkdir(workspace)
    const outside = join(base, 'outside.html')
    await fs.writeFile(outside, '<h1>Outside workspace</h1>')
    const config: RemoteConfig = {
      host: '127.0.0.1', port: 5173, publicOrigin: new URL('https://remote.example.test'),
      password: 'correct horse battery staple', sessionSecret: 's'.repeat(48), sessionTtlSeconds: 600,
      codexBin: 'unused', workspaceRoots: [workspace], fileRoots: ['/'], production: true,
    }
    const server = createRemoteHttpServer(config, new RemoteController(config, new CodexAppServer('unused')), base, null)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    cleanups.push(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(base, { recursive: true, force: true }) })
    expect((await fetchLocal(port, '/api/files/list?path=/')).status).toBe(401)
    const login = await fetchLocal(port, '/api/session/login', { method: 'POST', origin: config.publicOrigin.origin, body: { password: config.password } })
    const cookie = login.headers['set-cookie']?.[0].split(';', 1)[0]
    const listing = await fetchLocal(port, `/api/files/list?path=${encodeURIComponent(base)}`, { cookie })
    expect(listing.status).toBe(200)
    expect(JSON.parse(listing.body).entries.some((entry: { name: string }) => entry.name === 'outside.html')).toBe(true)
    for (const endpoint of ['info', 'content', 'html-preview']) {
      const response = await fetchLocal(port, `/api/files/${endpoint}?path=${encodeURIComponent(outside)}`, { cookie })
      expect(response.status).toBe(200)
    }
    expect((await fetchLocal(port, `/api/files/content?path=${encodeURIComponent(outside)}&download=1`, { cookie })).headers['content-disposition']).toContain('attachment;')
    expect(config.workspaceRoots).toEqual([workspace])
  })

  it('serves the login shell publicly while protecting APIs and login origin', async () => {
    const distRoot = await fs.mkdtemp(join(tmpdir(), 'codex-remote-http-'))
    const workspaceRoot = await fs.mkdtemp(join(tmpdir(), 'codex-remote-workspace-'))
    const outsideRoot = await fs.mkdtemp(join(tmpdir(), 'codex-remote-outside-'))
    await fs.writeFile(join(distRoot, 'index.html'), '<!doctype html><title>Codex Remote</title>')
    await fs.writeFile(join(distRoot, 'icon-192.png'), Buffer.from('png fixture'))
    const textPath = join(workspaceRoot, 'notes.md')
    const pdfPath = join(workspaceRoot, 'report.pdf')
    const binaryPath = join(workspaceRoot, 'archive.bin')
    const docxPath = join(workspaceRoot, 'contract.docx')
    const outsidePath = join(outsideRoot, 'outside.txt')
    await fs.writeFile(textPath, 'first line\nsecond line\n')
    await fs.writeFile(pdfPath, '%PDF-1.4\nfixture')
    await fs.writeFile(binaryPath, Buffer.from([0, 1, 2, 3]))
    await fs.writeFile(docxPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))
    await fs.writeFile(outsidePath, 'private')
    await fs.symlink(outsidePath, join(workspaceRoot, 'escape.txt'))
    const config: RemoteConfig = {
      host: '127.0.0.1',
      port: 5173,
      publicOrigin: new URL('https://remote.example.test'),
      password: 'correct horse battery staple',
      sessionSecret: 's'.repeat(48),
      sessionTtlSeconds: 600,
      codexBin: 'unused',
      workspaceRoots: [workspaceRoot],
      production: true,
    }
    const controller = new RemoteController(config, new CodexAppServer('unused'))
    const push = new PushService(join(distRoot, 'push-state.json'), config.sessionSecret, config.publicOrigin.origin)
    const attachments = new AttachmentStore(join(distRoot, 'attachments'))
    const server = createRemoteHttpServer(config, controller, distRoot, null, push, attachments, new WorkPresence(join(workspaceRoot, 'screen.jsonl')), new WorkHoursStore(join(workspaceRoot, 'hours.json')))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    cleanups.push(async () => {
      push.stop()
      attachments.stop()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      await fs.rm(distRoot, { recursive: true, force: true })
      await fs.rm(workspaceRoot, { recursive: true, force: true })
      await fs.rm(outsideRoot, { recursive: true, force: true })
    })

    const shell = await fetchLocal(port, '/')
    expect(shell).toMatchObject({ status: 200, body: expect.stringContaining('Codex Remote') })
    expect(shell.headers['cache-control']).toBe('no-cache')
    expect(shell.headers['cdn-cache-control']).toBe('no-store')
    expect(shell.headers['content-security-policy']).toContain("frame-src 'self' https: http:")
    const icon = await fetchLocal(port, '/icon-192.png')
    expect(icon.status).toBe(200)
    expect(icon.headers['content-type']).toBe('image/png')
    expect((await fetchLocal(port, '/api/events')).status).toBe(401)
    expect((await fetchLocal(port, '/api/push/key')).status).toBe(401)
    expect((await fetchLocal(port, '/api/push/subscription', { method: 'POST', body: {} })).status).toBe(401)
    expect((await fetchLocal(port, '/api/attachments', { method: 'POST', rawBody: Buffer.from('image'), contentType: 'image/png' })).status).toBe(401)
    expect((await fetchLocal(port, `/api/files/info?path=${encodeURIComponent(textPath)}`)).status).toBe(401)
    expect((await fetchLocal(port, '/api/files/docx-frame')).status).toBe(401)
    expect((await fetchLocal(port, '/api/files/html-preview')).status).toBe(401)
    expect((await fetchLocal(port, '/api/files/pptx-preview')).status).toBe(401)
    expect((await fetchLocal(port, `/api/files/list?path=${encodeURIComponent(workspaceRoot)}`)).status).toBe(401)

    const rejected = await fetchLocal(port, '/api/session/login', {
      method: 'POST',
      origin: 'https://evil.example.test',
      body: { password: config.password },
    })
    expect(rejected.status).toBe(403)

    const login = await fetchLocal(port, '/api/session/login', {
      method: 'POST',
      origin: config.publicOrigin.origin,
      body: { password: config.password },
    })
    expect(login.status).toBe(200)
    expect(login.headers['set-cookie']?.[0]).toContain('Secure')
    const cookie = login.headers['set-cookie']?.[0].split(';', 1)[0]
    expect(cookie).toBeTruthy()
    expect((await fetchLocal(port, '/api/session', { cookie })).status).toBe(200)
    expect(JSON.parse((await fetchLocal(port, '/api/localhost-preview', { cookie })).body)).toEqual({ enabled: true })
    const csrf = JSON.parse(login.body).csrf as string
    const options = { cookie, csrf, origin: config.publicOrigin.origin }
    expect((await fetchLocal(port, '/api/working-hours')).status).toBe(401)
    const initialHours = await fetchLocal(port, '/api/working-hours', options)
    expect(initialHours.status).toBe(200)
    const changeHours = { action: 'replace-totals', expectedRevision: 0, totals: { '2026-01-01': 230 / 60 } }
    expect((await fetchLocal(port, '/api/working-hours', { ...options, method: 'POST', body: changeHours })).status).toBe(200)
    expect((await fetchLocal(port, '/api/working-hours', { ...options, method: 'POST', body: changeHours })).status).toBe(409)
    expect((await fetchLocal(port, '/api/working-hours', { ...options, csrf: 'wrong', method: 'POST', body: changeHours })).status).toBe(403)
    const presenceBody = { clientId: 'test-tab', visible: true, processing: false }
    expect((await fetchLocal(port, '/api/work-presence', { ...options, method: 'POST', body: presenceBody })).status).toBe(200)
    expect((await fetchLocal(port, '/api/work-presence', { ...options, csrf: 'wrong', method: 'POST', body: presenceBody })).status).toBe(403)
    expect((await fetchLocal(port, '/api/work-presence', { ...options, method: 'POST', body: { ...presenceBody, visible: 'yes' } })).status).toBe(400)

    const workspaceSkills = vi.spyOn(controller, 'listWorkspaceSkills').mockResolvedValue({ skills: [], errors: [] })
    expect((await fetchLocal(port, '/api/workspace-skills?workspaceId=0')).status).toBe(401)
    expect(workspaceSkills).not.toHaveBeenCalled()
    expect((await fetchLocal(port, '/api/workspace-skills?workspaceId=0&refresh=1', { cookie })).status).toBe(200)
    expect(workspaceSkills).toHaveBeenCalledWith('0', true)
    const skills = vi.spyOn(controller, 'listSkills').mockResolvedValue({ skills: [], errors: [] })
    expect((await fetchLocal(port, '/api/threads/chat/skills')).status).toBe(401)
    expect(skills).not.toHaveBeenCalled()
    expect((await fetchLocal(port, '/api/threads/chat/skills?refresh=1', { cookie })).status).toBe(200)
    expect(skills).toHaveBeenCalledWith('chat', true)
    const messageIds = vi.spyOn(controller, 'readMessageIds').mockResolvedValue({ ids: ['turn:reply'] })
    expect((await fetchLocal(port, '/api/threads/chat/message-ids')).status).toBe(401)
    expect(messageIds).not.toHaveBeenCalled()
    const messageSummary = await fetchLocal(port, '/api/threads/chat/message-ids', { cookie })
    expect(messageSummary.status).toBe(200)
    expect(JSON.parse(messageSummary.body)).toEqual({ ids: ['turn:reply'] })
    expect(messageIds).toHaveBeenCalledWith('chat')
    expect((await fetchLocal(port, '/api/read-state')).status).toBe(401)
    const loginB = await fetchLocal(port, '/api/session/login', { method: 'POST', origin: config.publicOrigin.origin, body: { password: config.password } })
    const cookieB = loginB.headers['set-cookie']?.[0].split(';', 1)[0]
    messageIds.mockResolvedValue({ ids: ['turn:reply', 'reply:finished'] })
    await fetchLocal(port, '/api/threads/chat/message-ids', { cookie })
    const stateB = JSON.parse((await fetchLocal(port, '/api/read-state', { cookie: cookieB })).body)
    expect(stateB.unread.chat).toEqual(['reply:finished'])
    const access = vi.spyOn(controller, 'assertThreadAccess').mockResolvedValue()
    const receipt = { ids: ['reply:finished'] }
    const readPath = '/api/threads/chat/read-state'
    expect((await fetchLocal(port, readPath, { method: 'POST', body: receipt })).status).toBe(401)
    expect((await fetchLocal(port, readPath, { ...options, csrf: 'bad', method: 'POST', body: receipt })).status).toBe(403)
    expect((await fetchLocal(port, readPath, { ...options, method: 'POST', body: { ids: [null] } })).status).toBe(400)
    messageIds.mockResolvedValue({ ids: ['turn:reply', 'reply:finished', 'reply:newer'] })
    await fetchLocal(port, '/api/threads/chat/message-ids', { cookie: cookieB })
    const marked = await fetchLocal(port, readPath, { ...options, method: 'POST', body: receipt })
    expect(marked.status).toBe(200)
    expect(JSON.parse(marked.body).unread.chat).toEqual(['reply:newer'])
    expect(JSON.parse((await fetchLocal(port, '/api/read-state', { cookie: cookieB })).body).unread.chat).toEqual(['reply:newer'])
    expect(access).toHaveBeenCalledWith('chat')
    access.mockRejectedValueOnce(new Error('Outside workspace roots'))
    expect((await fetchLocal(port, readPath, { ...options, method: 'POST', body: { ids: ['reply:newer'] } })).status).not.toBe(200)

    const rename = vi.spyOn(controller, 'renameThread').mockImplementation(async (_id, name) => ({ name: normalizeThreadName(name) }))
    const renamePath = '/api/threads/rename-target/name'
    expect((await fetchLocal(port, renamePath, { method: 'POST', body: { name: 'New name' } })).status).toBe(401)
    expect((await fetchLocal(port, renamePath, { cookie, method: 'POST', origin: config.publicOrigin.origin, body: { name: 'New name' } })).status).toBe(403)
    expect(rename).not.toHaveBeenCalled()
    expect((await fetchLocal(port, renamePath, { ...options, method: 'POST', body: { name: '  ' } })).status).toBe(400)
    const renamed = await fetchLocal(port, renamePath, { ...options, method: 'POST', body: { name: '  Hội thoại mới  ' } })
    expect(renamed.status).toBe(200)
    expect(JSON.parse(renamed.body)).toEqual({ name: 'Hội thoại mới' })
    expect(rename).toHaveBeenLastCalledWith('rename-target', '  Hội thoại mới  ')
    const listing = await fetchLocal(port, `/api/files/list?path=${encodeURIComponent(workspaceRoot)}`, { cookie })
    expect(listing.status).toBe(200)
    expect(JSON.parse(listing.body).entries).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'notes.md', kind: 'file' })], undefined))
    expect((await fetchLocal(port, `/api/files/list?path=${encodeURIComponent(outsideRoot)}`, { cookie })).status).toBe(403)
    const fileInfo = await fetchLocal(port, `/api/files/info?path=${encodeURIComponent(textPath)}`, { cookie })
    expect(fileInfo.status).toBe(200)
    expect(JSON.parse(fileInfo.body)).toMatchObject({
      name: 'notes.md',
      extension: '.md',
      kind: 'text',
      previewable: true,
      createdAt: expect.any(String),
      modifiedAt: expect.any(String),
    })
    const textFile = await fetchLocal(port, `/api/files/content?path=${encodeURIComponent(textPath)}`, { cookie })
    expect(textFile).toMatchObject({ status: 200, body: 'first line\nsecond line\n' })
    expect(textFile.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(textFile.headers['cache-control']).toBe('private, no-store')
    const ranged = await fetchLocal(port, `/api/files/content?path=${encodeURIComponent(textPath)}`, { cookie, range: 'bytes=0-4' })
    expect(ranged).toMatchObject({ status: 206, body: 'first' })
    expect(ranged.headers['content-range']).toBe(`bytes 0-4/${Buffer.byteLength('first line\nsecond line\n')}`)
    const pdf = await fetchLocal(port, `/api/files/content?path=${encodeURIComponent(pdfPath)}`, { cookie })
    expect(pdf.status).toBe(200)
    expect(pdf.headers['content-type']).toBe('application/pdf')
    expect(pdf.headers['x-frame-options']).toBe('SAMEORIGIN')
    const binaryInfo = JSON.parse((await fetchLocal(port, `/api/files/info?path=${encodeURIComponent(binaryPath)}`, { cookie })).body)
    expect(binaryInfo).toMatchObject({ kind: 'download', previewable: false })
    expect((await fetchLocal(port, `/api/files/content?path=${encodeURIComponent(binaryPath)}`, { cookie })).status).toBe(415)
    const download = await fetchLocal(port, `/api/files/content?path=${encodeURIComponent(binaryPath)}&download=1`, { cookie })
    expect(download.status).toBe(200)
    expect(download.headers['content-disposition']).toContain('attachment;')
    const docxInfo = JSON.parse((await fetchLocal(port, `/api/files/info?path=${encodeURIComponent(docxPath)}`, { cookie })).body)
    expect(docxInfo).toMatchObject({
      extension: '.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      kind: 'docx',
      previewable: true,
    })
    const htmlPath = join(workspaceRoot, 'preview.html')
    const htmlContent = '<!doctype html><style>body{color:red}</style><button onclick="this.textContent=123">Click</button>'
    await fs.writeFile(htmlPath, htmlContent)
    const htmlUrl = `/api/files/html-preview?path=${encodeURIComponent(htmlPath)}`
    const htmlPreview = await fetchLocal(port, htmlUrl, { cookie })
    expect(htmlPreview.status).toBe(200)
    expect(htmlPreview.body).toBe(htmlContent)
    expect(htmlPreview.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(htmlPreview.headers['cache-control']).toBe('private, no-store')
    expect(htmlPreview.headers['content-security-policy']).toContain('sandbox allow-scripts')
    expect(htmlPreview.headers['content-security-policy']).not.toContain('allow-same-origin')
    expect(htmlPreview.headers['content-security-policy']).toContain("connect-src 'none'")
    const rawHtml = await fetchLocal(port, `/api/files/content?path=${encodeURIComponent(htmlPath)}`, { cookie })
    expect(rawHtml.headers['content-type']).toContain('text/plain')
    expect(rawHtml.body).toBe(htmlContent)
    expect((await fetchLocal(port, `/api/files/html-preview?path=${encodeURIComponent(textPath)}`, { cookie })).status).toBe(415)
    expect((await fetchLocal(port, '/api/files/html-preview?path=/etc/passwd', { cookie })).status).toBe(403)
    await fs.truncate(htmlPath, 10 * 1024 * 1024)
    expect((await fetchLocal(port, htmlUrl, { cookie })).status).toBe(200)
    expect((await fetchLocal(port, `/api/files/content?path=${encodeURIComponent(htmlPath)}`, { cookie })).status).toBe(200)
    await fs.truncate(htmlPath, 10 * 1024 * 1024 + 1)
    expect((await fetchLocal(port, htmlUrl, { cookie })).status).toBe(413)
    const docxFrame = await fetchLocal(port, '/api/files/docx-frame', { cookie })
    expect(docxFrame.status).toBe(200)
    expect(docxFrame.headers['content-security-policy']).toContain("default-src 'none'")
    expect(docxFrame.headers['content-security-policy']).toContain('sandbox allow-same-origin')
    expect(docxFrame.headers['content-security-policy']).not.toContain('allow-scripts')
    expect(docxFrame.headers['x-frame-options']).toBe('SAMEORIGIN')
    expect(docxFrame.headers['cache-control']).toBe('private, no-store')
    // Fixed-layout Word pages must not inherit mobile text inflation. Keep
    // native user zoom available as well as the viewer's zoom controls.
    expect(docxFrame.body).toContain('-webkit-text-size-adjust: none')
    expect(docxFrame.body).toContain('text-size-adjust: none')
    expect(docxFrame.body).not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=/)
    const docxContent = await fetchLocal(port, `/api/files/content?path=${encodeURIComponent(docxPath)}`, { cookie })
    expect(docxContent.status).toBe(200)
    expect(docxContent.headers['content-type']).toBe(docxInfo.contentType)
    await fs.truncate(docxPath, 20 * 1024 * 1024 + 1)
    expect(JSON.parse((await fetchLocal(port, `/api/files/info?path=${encodeURIComponent(docxPath)}`, { cookie })).body)).toMatchObject({ kind: 'docx', previewable: false })
    expect((await fetchLocal(port, `/api/files/content?path=${encodeURIComponent(docxPath)}`, { cookie })).status).toBe(415)
    const docxDownload = await fetchLocal(port, `/api/files/content?path=${encodeURIComponent(docxPath)}&download=1`, { cookie })
    expect(docxDownload.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    const pptxPath = join(workspaceRoot, 'slides.pptx')
    await fs.writeFile(pptxPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))
    expect(JSON.parse((await fetchLocal(port, `/api/files/info?path=${encodeURIComponent(pptxPath)}`, { cookie })).body)).toMatchObject({ kind: 'pptx', previewable: true })
    const preview = vi.spyOn(PptxPreviewCache.prototype, 'get').mockResolvedValueOnce(Buffer.from('%PDF-preview'))
    const slides = await fetchLocal(port, `/api/files/pptx-preview?path=${encodeURIComponent(pptxPath)}`, { cookie })
    expect(slides.status).toBe(200)
    expect(slides.headers['content-type']).toBe('application/pdf')
    expect(slides.headers['cache-control']).toBe('private, no-store')
    expect(slides.body).toBe('%PDF-preview')
    preview.mockRestore()
    expect((await fetchLocal(port, `/api/files/pptx-preview?path=${encodeURIComponent(textPath)}`, { cookie })).status).toBe(415)
    expect((await fetchLocal(port, `/api/files/pptx-preview?path=${encodeURIComponent(outsidePath)}`, { cookie })).status).toBe(403)
    expect((await fetchLocal(port, `/api/files/pptx-preview?path=${encodeURIComponent(join(workspaceRoot, 'escape.txt'))}`, { cookie })).status).toBe(403)
    await fs.truncate(pptxPath, 20 * 1024 * 1024 + 1)
    expect((await fetchLocal(port, `/api/files/pptx-preview?path=${encodeURIComponent(pptxPath)}`, { cookie })).status).toBe(413)
    expect(JSON.parse((await fetchLocal(port, `/api/files/info?path=${encodeURIComponent(pptxPath)}`, { cookie })).body)).toMatchObject({ kind: 'pptx', previewable: false })
    const originalPptx = await fetchLocal(port, `/api/files/content?path=${encodeURIComponent(pptxPath)}&download=1`, { cookie })
    expect(originalPptx.status).toBe(200)
    expect(originalPptx.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation')
    expect((await fetchLocal(port, `/api/files/info?path=${encodeURIComponent(outsidePath)}`, { cookie })).status).toBe(403)
    expect((await fetchLocal(port, `/api/files/info?path=${encodeURIComponent(join(workspaceRoot, 'escape.txt'))}`, { cookie })).status).toBe(403)
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    expect((await fetchLocal(port, '/api/attachments', { ...options, csrf: undefined, method: 'POST', rawBody: png, contentType: 'image/png' })).status).toBe(403)
    expect((await fetchLocal(port, '/api/attachments', { ...options, method: 'POST', rawBody: Buffer.from('not png'), contentType: 'image/png' })).status).toBe(400)
    const uploaded = await fetchLocal(port, '/api/attachments', { ...options, method: 'POST', rawBody: png, contentType: 'image/png' })
    expect(uploaded.status).toBe(201)
    const attachmentId = JSON.parse(uploaded.body).id as string
    expect((await fetchLocal(port, `/api/attachments/${attachmentId}`, { ...options, method: 'DELETE' })).status).toBe(200)
    const htmlUpload = await fetchLocal(port, '/api/attachments?name=source.html', { ...options, method: 'POST', rawBody: Buffer.from('<script>window.injected = true</script>'), contentType: 'text/html' })
    expect(htmlUpload.status).toBe(201)
    const fileId = JSON.parse(htmlUpload.body).id
    const startWithFile = vi.spyOn(controller, 'startTurn').mockResolvedValueOnce({ turn: { id: 'uploaded-file-turn' } })
    const fileTurn = await fetchLocal(port, '/api/threads/upload-test/turns', { ...options, method: 'POST', body: { text: '  <b>literal</b>\n ', attachmentIds: [fileId] } })
    expect(fileTurn.status).toBe(202)
    expect(startWithFile).toHaveBeenCalledWith('upload-test', '  <b>literal</b>\n ', undefined, undefined, false, [], [expect.objectContaining({ name: 'source.html', contentType: 'text/html', kind: 'file' })], undefined)
    startWithFile.mockRestore()

    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test',
      keys: { p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') },
    }
    expect(JSON.parse((await fetchLocal(port, '/api/push/key', { cookie })).body).publicKey).toBe(push.publicKey)
    expect((await fetchLocal(port, '/api/push/subscription', { ...options, csrf: undefined, method: 'POST', body: subscription })).status).toBe(403)
    expect((await fetchLocal(port, '/api/push/subscription', { ...options, origin: 'https://evil.test', method: 'POST', body: subscription })).status).toBe(403)
    expect((await fetchLocal(port, '/api/push/subscription', { ...options, method: 'POST', body: { ...subscription, endpoint: 'http://localhost/private' } })).status).toBe(400)
    expect((await fetchLocal(port, '/api/push/subscription', { ...options, method: 'POST', body: subscription })).status).toBe(201)
    expect((await fetchLocal(port, '/api/push/visibility', { ...options, method: 'POST', body: { endpoint: subscription.endpoint, visible: true } })).status).toBe(200)
    expect((await fetchLocal(port, '/api/push/visibility', { ...options, method: 'POST', body: { endpoint: subscription.endpoint, visible: 'yes' } })).status).toBe(400)
    const status = async () => JSON.parse((await fetchLocal(port, '/api/push/status', { ...options, method: 'POST', body: { endpoint: subscription.endpoint } })).body).enabled
    expect(await status()).toBe(true)
    expect((await fetchLocal(port, '/api/push/subscription', { ...options, method: 'DELETE', body: {} })).status).toBe(200)
    expect(await status()).toBe(false)
    await fetchLocal(port, '/api/push/subscription', { ...options, method: 'POST', body: subscription })
    expect((await fetchLocal(port, '/api/session/logout', { ...options, method: 'POST', body: {} })).status).toBe(200)
    expect(await status()).toBe(false)

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const failedLogin = await fetchLocal(port, '/api/session/login', {
        method: 'POST',
        origin: config.publicOrigin.origin,
        body: { password: 'definitely-not-the-password' },
      })
      expect(failedLogin.status).toBe(401)
    }
    const lockedLogin = await fetchLocal(port, '/api/session/login', {
      method: 'POST',
      origin: config.publicOrigin.origin,
      body: { password: config.password },
    })
    expect(lockedLogin.status).toBe(429)
    expect(JSON.parse(lockedLogin.body)).toEqual({ error: 'Too many login attempts. Try again later.' })
  }, 30_000)
})
