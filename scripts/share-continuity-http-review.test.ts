// Independent controls; setup reused from candidate, fake owned services only.
import { createServer, request, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { type AddressInfo, type Socket } from 'node:net'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createRemoteHttpServer } from '../server/http-app.js'
import { RemoteController } from '../server/controller.js'
import { CodexAppServer } from '../server/codex-app-server.js'
import { ServicesStore } from '../server/services.js'
import { SecureTransport } from '../server/secure-client.js'
import { randomId } from '../server/secure-wire.js'
import { createSession } from '../server/auth.js'
import { SHARE_COOKIE, type PreviewShare } from '../server/preview-shares.js'
import { SHARE_EXCHANGE } from '../server/preview-share-page.js'
import type { RemoteConfig } from '../server/config.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function listen(server: Server) {
  const sockets = new Set<Socket>(); server.on('connection', s => { sockets.add(s); s.once('close', () => sockets.delete(s)) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>(resolve => { for (const s of sockets) s.destroy(); server.close(() => resolve()) }))
  return (server.address() as AddressInfo).port
}
type Response = { status: number; headers: IncomingMessage['headers']; body: string }
function raw(port: number, host: string, path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: { host, ...options.headers } }, res => {
      let body = ''; res.on('data', chunk => { body += chunk }); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body })); res.on('error', reject)
    }); req.on('error', reject); req.end(options.body)
  })
}
async function fixture(handler: (req: IncomingMessage, res: ServerResponse) => void = (req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ headers: req.headers, path: req.url })) }, probe: () => Promise<boolean> = async () => true) {
  const root = mkdtempSync(join(tmpdir(), 'share-http-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  const files = join(root, 'files'); mkdirSync(files)
  const key = { version: 1, app: randomId(), generation: randomId(), key: randomId(32) }, file = join(root, 'key.json')
  writeFileSync(file, JSON.stringify(key), { mode: 0o600 })
  const upstream = createServer(handler), appPort = await listen(upstream)
  const services = new ServicesStore(join(root, 'services.json'), probe)
  services.upsert({ port: appPort, name: 'Fixture', summary: 'Fake service only', prLabel: 'no PR', path: '/app?q=1#part' })
  const config: RemoteConfig = { host: '127.0.0.1', port: 0, publicOrigin: new URL('https://owner.test'),
    password: 'FAKE share fixture password', sessionSecret: 'fake-secret'.repeat(5), sessionTtlSeconds: 600, codexBin: 'unused', production: true,
    workspaceRoots: [files], fileRoots: [files], secureApiRequired: true, secureKeyFile: file, sessionStateFile: join(root, 'sessions.json'),
    previewOriginTemplate: 'https://p{port}.preview.test', previewSharePorts: [appPort] }
  const issued = createSession(config.sessionSecret, 600, config.password), ownerCookie = '__Host-codex_remote_session=' + issued.token
  const controller = new RemoteController(config, new CodexAppServer('unused'))
  const server = createRemoteHttpServer(config, controller, files, null, undefined, undefined, undefined, undefined, undefined, services)
  const gateway = await listen(server); config.port = gateway
  const host = `p${appPort}.preview.test`
  const transportFetch: typeof fetch = (url, init) => fetch(`http://127.0.0.1:${gateway}${new URL(String(url)).pathname}`, {
    ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), host: 'owner.test' },
  })
  const transport = new SecureTransport(transportFetch, 'https://owner.test', { Cookie: ownerCookie, Origin: 'https://owner.test' }); cleanup.push(() => transport.lock())
  await transport.unlock(key.key)
  const api = async (path: string, method = 'GET', body?: unknown) => (await transport.request(path, { method,
    headers: { 'content-type': 'application/json', 'x-csrf-token': issued.payload.csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })).response
  const create = async (ttlSeconds = 3600) => { const response = await api('/api/preview-shares', 'POST', { port: appPort, ttlSeconds }); expect(response.status).toBe(201); return (await response.json()).link as PreviewShare }
  const exchange = async (link: PreviewShare) => raw(gateway, 'owner.test', SHARE_EXCHANGE, { method: 'POST', headers: { origin: 'https://owner.test', 'content-type': 'application/json' }, body: JSON.stringify({ token: new URL(link.url!).hash.slice(1) }) })
  const open = async (supplied?: PreviewShare) => {
    const link = supplied ?? await create()
    const receipt = await exchange(link); expect(receipt.status).toBe(200)
    const handoff = JSON.parse(receipt.body), url = new URL(handoff.url)
    const result = await raw(gateway, host, url.pathname, { method: 'POST', headers: { origin: 'https://owner.test', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ticket: handoff.ticket }).toString() })
    expect(result.status).toBe(303)
    return { link, receipt, result, cookie: result.headers['set-cookie']!.find(c => c.startsWith(SHARE_COOKIE + '='))!.split(';')[0] }
  }
  return { root, api, create, open, exchange, services, transport, transportFetch, ownerCookie, config, issued, upstream, server, gateway, appPort, host,
    fetch: (path = '/', cookie = '', headers: Record<string, string> = {}) => raw(gateway, host, path, { headers: { cookie, ...headers } }) }
}

it('independent: active HTTP survives metadata update but replacement cuts old cookie and handoff', async () => {
  let held!: ServerResponse, ready!: () => void
  const waiting = new Promise<void>(resolve => { ready = resolve })
  const f = await fixture((_req,res)=>{res.writeHead(200, {'content-type':'text/event-stream'});res.write('ready\n');held=res;ready()})
  const opened=await f.open(), before=f.services.list()[0]
  const handoff=JSON.parse((await f.exchange(opened.link)).body)
  let body='', status=0, updateSeen!:()=>void
  const progressed=new Promise<void>(resolve=>{updateSeen=resolve})
  const ended=new Promise<void>((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port:f.gateway,path:'/events',headers:{host:f.host,cookie:opened.cookie}},res=>{
      status=res.statusCode!;res.on('data',chunk=>{body+=chunk;if(body.includes('after-update'))updateSeen()});res.on('error',()=>{});res.once('close',resolve)
    });req.on('error',reject);req.setTimeout(3000,()=>req.destroy(Error('Independent stream timeout')));req.end()
  })
  await waiting
  f.services.upsert({...before,name:'Renamed same app',path:'/new-start',branch:'new-branch',directory:'/moved-worktree',expectedIdentity:before.registrationId})
  expect(f.services.identity(f.appPort)).toBe(before.registrationId);held.write('after-update\n');await progressed
  expect(status).toBe(200);expect((await (await f.api('/api/preview-shares')).json()).links[0].url).toBe(opened.link.url)
  f.services.upsert({...f.services.list()[0],replace:true});await ended
  expect(body).toContain('after-update');expect((await f.fetch('/',opened.cookie)).status).toBe(401)
  const denied=await raw(f.gateway,f.host,'/__codex_preview__/share-redeem',{method:'POST',headers:{origin:'https://owner.test','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({ticket:handoff.ticket}).toString()})
  expect(denied.status).toBe(401)
})
it('independent: revoke plus metadata update during a held list never re-emits a revoked URL', async()=>{
  let finish!:(value:boolean)=>void, entered!:()=>void
  const ready=new Promise<void>(resolve=>{entered=resolve})
  const f=await fixture(undefined,()=>{entered();return new Promise(resolve=>{finish=resolve})}),opened=await f.open()
  const pending=f.api('/api/preview-shares');await ready
  f.services.upsert({...f.services.list()[0],summary:'concurrent metadata'})
  expect((await f.api('/api/preview-shares/'+opened.link.id,'DELETE')).status).toBe(200)
  finish(true);const listed=await(await pending).json()
  expect(listed.links[0].status).toBe('revoked');expect(listed.links[0].url).toBeUndefined()
  expect((await f.fetch('/',opened.cookie)).status).toBe(401)
})
it('independent: new isolated host does not admit owner API or another port credential',async()=>{
  const f=await fixture(),opened=await f.open()
  expect((await raw(f.gateway,f.host,'/api/preview-shares')).status).toBe(401)
  expect((await raw(f.gateway,'owner.test','/api/preview-shares',{headers:{cookie:opened.cookie}})).status).toBe(403)
  expect((await raw(f.gateway,`p${f.appPort===5999?5998:5999}.preview.test`,'/',{headers:{cookie:opened.cookie}})).status).toBe(401)
  expect((await raw(f.gateway,f.host,'/',{headers:{cookie:opened.cookie,origin:'https://evil.test'}})).status).toBe(403)
})
