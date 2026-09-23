import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it, vi } from 'vitest'
import { createRemoteHttpServer } from './http-app.js'
import { CodexAppServer } from './codex-app-server.js'
import { RemoteController } from './controller.js'
import { SecureTransport } from './secure-client.js'
import { createSession } from './auth.js'
import { randomId } from './secure-wire.js'
import { PptxPreviewCache } from './pptx-preview.js'
import type { RemoteConfig } from './config.js'
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.splice(0).reverse()) await fn() })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'owner-http-')); cleanup.push(() => rm(root, { recursive: true, force: true }))
  const files = join(root, 'files'); await mkdir(files)
  const material = { version: 1, app: randomId(), generation: randomId(), key: randomId(32) }, keyFile = join(root, 'owner-key.json')
  await writeFile(keyFile, JSON.stringify(material), { mode: 0o600 }); await writeFile(join(files, 'index.html'), '<title>APP SHELL</title>')
  const config: RemoteConfig = { host: '127.0.0.1', port: 0, publicOrigin: new URL('http://localhost'), password: 'FAKE owner password', sessionSecret: 'fake-secret'.repeat(5), sessionTtlSeconds: 600, codexBin: 'unused', production: true, workspaceRoots: [files], fileRoots: ['/'], fileAccess: 'owner-full', secureApiRequired: true, secureKeyFile: keyFile, sessionStateFile: join(root, 'sessions.json') }
  const issued = createSession(config.sessionSecret, 600, config.password)
  const controller = new RemoteController(config, new CodexAppServer('unused')) // Never starts native.
  const server = createRemoteHttpServer(config, controller, files, null)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  config.port = (server.address() as AddressInfo).port; config.publicOrigin = new URL('http://127.0.0.1:' + config.port)
  const headers = { Cookie: 'codex_remote_session=' + issued.token, Origin: config.publicOrigin.origin }
  const transport = new SecureTransport(fetch, config.publicOrigin.origin, headers); cleanup.push(async () => transport.lock())
  return { root, files, material, issued, config, headers, transport }
}
it('requires proof for every full-owner Files route; supports encrypted view, HTML, metadata, range and download', async () => {
  const f = await fixture(), path = join(f.root, '.env'), html = join(f.root, 'outside.html'), pptx = join(f.root, 'slides.pptx')
  await writeFile(path, 'FAKE HIDDEN CANARY'); await writeFile(html, '<h1>FAKE HTML</h1>'); await writeFile(pptx, Buffer.from('504b030400000000', 'hex')); await symlink(path, join(f.root, 'alias.txt'))
  const resource = (endpoint: string, file = path) => '/api/files/' + endpoint + '?' + new URLSearchParams({ path: file })
  for (const route of ['roots', 'list', 'info', 'content', 'html-preview', 'pptx-preview']) {
    expect((await fetch(f.config.publicOrigin.origin + resource(route), { headers: f.headers })).status).toBe(403)
    expect((await fetch(f.config.publicOrigin.origin + resource(route))).status).toBe(403)
  }
  expect((await fetch(f.config.publicOrigin.origin + '/api/secure/challenge', { method: 'POST', headers: { Origin: f.config.publicOrigin.origin } })).status).toBe(401)
  await expect(f.transport.unlock(randomId(32))).rejects.toThrow()
  await f.transport.unlock(f.material.key)
  const read = async (url: string, init: RequestInit = {}) => (await f.transport.request(url, init)).response
  expect(await (await read(resource('roots'))).json()).toEqual({ roots: ['/'] })
  expect((await (await read(resource('list', f.root) + '&hidden=1')).json()).entries.some((e: { name: string }) => e.name === '.env')).toBe(true)
  expect(await (await read(resource('info'))).json()).toMatchObject({ kind: 'text', path, size: 18 })
  expect(await (await read(resource('content'))).text()).toBe('FAKE HIDDEN CANARY')
  expect(await (await read(resource('content', join(f.root, 'alias.txt')))).text()).toBe('FAKE HIDDEN CANARY')
  const download = await read(resource('content') + '&download=1'); expect(download.headers.get('content-disposition')).toContain('attachment;'); await download.arrayBuffer()
  const range = await read(resource('content'), { headers: { range: 'bytes=0-3' } }); expect(range.status).toBe(206); expect(await range.text()).toBe('FAKE')
  const head = await read(resource('content'), { method: 'HEAD' }); expect(head.headers.get('content-length')).toBe('18'); expect(await head.text()).toBe('')
  expect(await (await read(resource('html-preview', html))).text()).toContain('FAKE HTML')
  const converter = vi.spyOn(PptxPreviewCache.prototype, 'get').mockResolvedValue(Buffer.from('%PDF-FAKE CONVERSION'))
  expect(await (await read(resource('pptx-preview', pptx))).text()).toBe('%PDF-FAKE CONVERSION'); expect(converter).toHaveBeenCalledOnce()
  // URL opens only the app shell. File bytes remain behind the tunnel.
  const shell = await fetch(f.config.publicOrigin.origin + '/files?' + new URLSearchParams({ path })); expect(await shell.text()).toContain('APP SHELL')
  const logout = await read('/api/session/logout', { method: 'POST', headers: { 'X-CSRF-Token': f.issued.payload.csrf, 'Content-Type': 'application/json' }, body: '{}' }); expect(logout.status).toBe(200)
  await expect(read(resource('content'))).rejects.toThrow()
  expect((await fetch(f.config.publicOrigin.origin + resource('content'), { headers: f.headers })).status).toBe(403)
})
