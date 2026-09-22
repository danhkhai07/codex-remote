import { promises as fs } from 'node:fs'
import { request, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it, vi } from 'vitest'
import { loadConfig, type RemoteConfig } from './config.js'
import { CodexAppServer } from './codex-app-server.js'
import { RemoteController } from './controller.js'
import { ContextVault } from './context-vault.js'
import { createRemoteHttpServer } from './http-app.js'
import { PptxPreviewCache } from './pptx-preview.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'legacy-files-'))
  cleanup.push(() => fs.rm(root, { recursive: true, force: true }))
  const project = join(root, 'project'), vault = join(root, 'vault'), privateRoot = join(root, 'private')
  await Promise.all([project, privateRoot].map(path => fs.mkdir(path)))
  const config: RemoteConfig = { host: '127.0.0.1', port: 5173, publicOrigin: new URL('http://localhost'), password: 'FAKE legacy password', sessionSecret: 'fake-session-secret'.repeat(3), sessionTtlSeconds: 600, production: true, workspaceRoots: [root], fileRoots: [project], codexBin: 'unused' }
  const native = new CodexAppServer('unused')
  const rpc = vi.spyOn(native, 'request').mockRejectedValue(new Error('No native RPC in Files fixture'))
  const server: Server = createRemoteHttpServer(config, new RemoteController(config, native, new ContextVault(vault)), project, null)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  config.port = (server.address() as AddressInfo).port; config.publicOrigin = new URL('http://127.0.0.1:' + config.port)
  const call = (path: string, options: RequestInit = {}) => fetch(config.publicOrigin.origin + path, { ...options, headers: { Origin: config.publicOrigin.origin, 'Content-Type': 'application/json', ...options.headers } })
  const login = await call('/api/session/login', { method: 'POST', body: JSON.stringify({ password: config.password }) })
  expect(login.status).toBe(200)
  const cookie = login.headers.get('set-cookie')!.split(';')[0], session = await login.json()
  return { root, project, vault, privateRoot, config, rpc, cookie, session, call, file: (route: string, path: string, extra = '') => call(`/api/files/${route}?path=${encodeURIComponent(path)}${extra}`, { headers: { Cookie: cookie } }) }
}

it('blocks new-instance keys/credentials and private Vault paths without changing legacy login or native settings', async () => {
  const f = await fixture()
  const paths = [
    join(f.privateRoot, 'secure-owner', 'owner-key.json'),
    join(f.project, '.local', 'state', 'codex-remote-remote', 'owner-key.json'),
    join(f.project, '.codex', 'auth.json'), join(f.project, 'remote-runtime', '.env'),
    join(f.project, '.ssh', 'id_ed25519'), join(f.vault, '.state', 'Orchestration.json'),
    join(f.vault, 'Conversations', 'worker', '.orchestration', 'request.json'),
    join(f.vault, 'Shared', '.orchestration', 'context-key.json'),
  ]
  for (const path of paths) { await fs.mkdir(join(path, '..'), { recursive: true }); await fs.writeFile(path, 'FAKE PRIVATE CANARY', { mode: 0o600 }) }
  await fs.symlink(paths[0], join(f.project, 'alias.json'))
  const attacks = [...paths, join(f.project, 'alias.json'), f.project + '/../private/secure-owner/owner-key.json', f.project + '/remote-runtime/../remote-runtime/.env', '/proc/self/environ', '/etc/shadow']
  for (const path of attacks) for (const route of ['info', 'content', 'html-preview', 'pptx-preview']) {
    const response = await f.file(route, path)
    expect(response.status, `${route} ${path}`).toBe(403)
    expect(await response.text()).not.toContain('CANARY')
  }
  expect((await f.file('content', encodeURIComponent(paths[0]))).status).toBe(400)
  for (const path of [f.project, f.vault, join(f.vault, 'Conversations', 'worker')]) {
    const listing = await (await f.file('list', path, '&hidden=1')).json()
    expect(listing.entries.some((entry: { name: string }) => ['.state', '.orchestration', '.local', '.codex', '.ssh'].includes(entry.name))).toBe(false)
  }
  expect((await f.call('/api/session', { headers: { Cookie: f.cookie } })).status).toBe(200)
  expect(f.session).toHaveProperty('csrf'); expect(f.session.workspaces[0].path).toBe(f.root)
  expect(f.rpc).not.toHaveBeenCalled()
})

it('preserves Files JSON, HTML sandbox, PDF/PPTX and download/range/HEAD behavior', async () => {
  const f = await fixture(), html = join(f.project, 'page.html'), text = join(f.project, 'notes.md'), pdf = join(f.project, 'report.pdf'), pptx = join(f.project, 'slides.pptx')
  await fs.writeFile(html, '<h1>Fixture</h1>'); await fs.writeFile(text, 'hello world')
  await fs.writeFile(pdf, '%PDF-fake'); await fs.writeFile(pptx, Buffer.from([0x50, 0x4b, 3, 4, 1, 2]))
  const info = await (await f.file('info', text)).json()
  expect(info).toMatchObject({ path: text, name: 'notes.md', kind: 'text', size: 11, previewable: true })
  expect(Object.keys(info).sort()).toEqual(['contentType', 'createdAt', 'extension', 'kind', 'modifiedAt', 'name', 'path', 'previewable', 'size'])
  const frame = await f.file('html-preview', html)
  expect(frame.status).toBe(200); expect(frame.headers.get('content-security-policy')).toContain('sandbox allow-scripts')
  expect(await frame.text()).toBe('<h1>Fixture</h1>')
  expect((await f.file('content', text, '&download=1')).headers.get('content-disposition')).toContain('attachment;')
  const ranged = await f.call('/api/files/content?path=' + encodeURIComponent(text), { headers: { Cookie: f.cookie, Range: 'bytes=0-4' } })
  expect(ranged.status).toBe(206); expect(await ranged.text()).toBe('hello')
  const head = await f.call('/api/files/content?path=' + encodeURIComponent(pdf), { method: 'HEAD', headers: { Cookie: f.cookie } })
  expect(head.status).toBe(200); expect(head.headers.get('content-type')).toBe('application/pdf'); expect(await head.text()).toBe('')
  const preview = vi.spyOn(PptxPreviewCache.prototype, 'get').mockResolvedValue(Buffer.from('%PDF-converted fixture'))
  const converted = await f.file('pptx-preview', pptx)
  expect(converted.status).toBe(200); expect(converted.headers.get('content-type')).toBe('application/pdf')
  expect(await converted.text()).toBe('%PDF-converted fixture'); expect(preview).toHaveBeenCalledOnce()
  expect(f.rpc).not.toHaveBeenCalled()
})

it('returns JSON failures from awaited async reads and stays usable after an aborted download', async () => {
  const f = await fixture(), path = join(f.project, 'large.bin')
  await fs.writeFile(path, Buffer.alloc(2 * 1024 * 1024, 1))
  for (const [route, file, status] of [['content', join(f.project, 'missing'), 404], ['content', path, 415], ['html-preview', path, 415]] as const) {
    const response = await f.file(route, file); expect(response.status).toBe(status); expect(await response.json()).toHaveProperty('error')
  }
  const badRange = await f.call('/api/files/content?path=' + encodeURIComponent(path) + '&download=1', { headers: { Cookie: f.cookie, Range: 'bytes=9999999-' } })
  expect(badRange.status).toBe(416); expect(await badRange.json()).toHaveProperty('error')
  await new Promise<void>((resolve, reject) => {
    const req = request(f.config.publicOrigin.origin + '/api/files/content?path=' + encodeURIComponent(path) + '&download=1', { headers: { Cookie: f.cookie } }, res => {
      expect(res.statusCode).toBe(200); res.once('data', () => { req.destroy(); resolve() })
    }); req.on('error', error => { if (!req.destroyed) reject(error) }); req.end()
  })
  expect((await f.file('info', path)).status).toBe(200)
  expect(f.rpc).not.toHaveBeenCalled()
})

it('rejects a configured root alias resolving to a system/home root', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'legacy-config-')); cleanup.push(() => fs.rm(root, { recursive: true, force: true }))
  await fs.symlink('/root', join(root, 'home-alias'))
  expect(() => loadConfig({ CODEX_REMOTE_PASSWORD: 'FAKE long enough password', CODEX_REMOTE_SESSION_SECRET: 'x'.repeat(48), CODEX_REMOTE_PUBLIC_ORIGIN: 'https://legacy.test', CODEX_REMOTE_WORKSPACE_ROOTS: '/root', CODEX_REMOTE_FILE_ROOTS: join(root, 'home-alias') })).toThrow('explicit project/data')
})
