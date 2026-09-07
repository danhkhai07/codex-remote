import { promises as fs } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { CodexAppServer } from './codex-app-server.js'
import type { RemoteConfig } from './config.js'
import { RemoteController } from './controller.js'
import { createRemoteHttpServer } from './http-app.js'
import { PushService } from './push.js'
import { AttachmentStore } from './attachments.js'

type Response = {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

function fetchLocal(port: number, path: string, options: {
  method?: string
  origin?: string
  cookie?: string
  csrf?: string
  body?: unknown
  rawBody?: Buffer
  contentType?: string
} = {}): Promise<Response> {
  const encoded = options.rawBody ?? (options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body)))
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: '127.0.0.1',
      port,
      path,
      method: options.method ?? 'GET',
      headers: {
        Host: 'remote.example.test',
        ...(options.origin ? { Origin: options.origin } : {}),
        ...(options.cookie ? { Cookie: options.cookie } : {}),
        ...(options.csrf ? { 'X-CSRF-Token': options.csrf } : {}),
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

  it('serves the login shell publicly while protecting APIs and login origin', async () => {
    const distRoot = await fs.mkdtemp(join(tmpdir(), 'codex-remote-http-'))
    await fs.writeFile(join(distRoot, 'index.html'), '<!doctype html><title>Codex Remote</title>')
    await fs.writeFile(join(distRoot, 'icon-192.png'), Buffer.from('png fixture'))
    const config: RemoteConfig = {
      host: '127.0.0.1',
      port: 5173,
      publicOrigin: new URL('https://remote.example.test'),
      password: 'correct horse battery staple',
      sessionSecret: 's'.repeat(48),
      sessionTtlSeconds: 600,
      codexBin: 'unused',
      workspaceRoots: ['/workspace'],
      production: true,
    }
    const controller = new RemoteController(config, new CodexAppServer('unused'))
    const push = new PushService(join(distRoot, 'push-state.json'), config.sessionSecret, config.publicOrigin.origin)
    const attachments = new AttachmentStore(join(distRoot, 'attachments'))
    const server = createRemoteHttpServer(config, controller, distRoot, null, push, attachments)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    cleanups.push(async () => {
      push.stop()
      attachments.stop()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      await fs.rm(distRoot, { recursive: true, force: true })
    })

    const shell = await fetchLocal(port, '/')
    expect(shell).toMatchObject({ status: 200, body: expect.stringContaining('Codex Remote') })
    expect(shell.headers['cache-control']).toBe('no-cache')
    const icon = await fetchLocal(port, '/icon-192.png')
    expect(icon.status).toBe(200)
    expect(icon.headers['content-type']).toBe('image/png')
    expect((await fetchLocal(port, '/api/events')).status).toBe(401)
    expect((await fetchLocal(port, '/api/push/key')).status).toBe(401)
    expect((await fetchLocal(port, '/api/push/subscription', { method: 'POST', body: {} })).status).toBe(401)
    expect((await fetchLocal(port, '/api/attachments', { method: 'POST', rawBody: Buffer.from('image'), contentType: 'image/png' })).status).toBe(401)

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
    const csrf = JSON.parse(login.body).csrf as string
    const options = { cookie, csrf, origin: config.publicOrigin.origin }
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    expect((await fetchLocal(port, '/api/attachments', { ...options, csrf: undefined, method: 'POST', rawBody: png, contentType: 'image/png' })).status).toBe(403)
    expect((await fetchLocal(port, '/api/attachments', { ...options, method: 'POST', rawBody: Buffer.from('not png'), contentType: 'image/png' })).status).toBe(400)
    const uploaded = await fetchLocal(port, '/api/attachments', { ...options, method: 'POST', rawBody: png, contentType: 'image/png' })
    expect(uploaded.status).toBe(201)
    const attachmentId = JSON.parse(uploaded.body).id as string
    expect((await fetchLocal(port, `/api/attachments/${attachmentId}`, { ...options, method: 'DELETE' })).status).toBe(200)
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test',
      keys: { p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') },
    }
    expect(JSON.parse((await fetchLocal(port, '/api/push/key', { cookie })).body).publicKey).toBe(push.publicKey)
    expect((await fetchLocal(port, '/api/push/subscription', { ...options, csrf: undefined, method: 'POST', body: subscription })).status).toBe(403)
    expect((await fetchLocal(port, '/api/push/subscription', { ...options, origin: 'https://evil.test', method: 'POST', body: subscription })).status).toBe(403)
    expect((await fetchLocal(port, '/api/push/subscription', { ...options, method: 'POST', body: { ...subscription, endpoint: 'http://localhost/private' } })).status).toBe(400)
    expect((await fetchLocal(port, '/api/push/subscription', { ...options, method: 'POST', body: subscription })).status).toBe(201)
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
  })
})
