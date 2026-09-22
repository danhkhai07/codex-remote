/** Inverse acceptance of the seven independent d88b163 reproductions. */
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it, vi } from 'vitest'
import { SecureApi } from './secure-api'
import { SecureTransport } from './secure-client'
import { SessionRegistry } from './session-registry'
import { createSession } from './auth'
import { randomId } from './secure-wire'
import { ContextVault } from './context-vault'
import { createRemoteHttpServer } from './http-app'
import { RemoteController } from './controller'
import { CodexAppServer } from './codex-app-server'
import type { RemoteConfig } from './config'
const cleanups: Array<() => Promise<unknown> | void> = []
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.resetModules() })
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => {resolve = r}); return {promise, resolve} }
async function fixture(realRouter = false, nativeFixture = false) {
 const root = await mkdtemp(join(tmpdir(), 'secure-independent-')), files = join(root, 'files'), keyFile = join(root, 'owner.json')
 cleanups.push(()=>rm(root,{recursive:true,force:true})); await mkdir(files)
 const material={version:1,app:randomId(),generation:randomId(),key:randomId(32)}
 await writeFile(keyFile,JSON.stringify(material),{mode:0o600})
 const config:RemoteConfig={host:'127.0.0.1',port:0,publicOrigin:new URL('http://localhost'),password:'FAKE review password',sessionSecret:'FAKE independent session '.repeat(3),sessionTtlSeconds:600,codexBin:'UNUSED',production:true,workspaceRoots:[files],fileRoots:[files],secureApiRequired:true,secureKeyFile:keyFile,sessionStateFile:join(root,'sessions.json')}
 const issued=createSession(config.sessionSecret,600,config.password),registry=new SessionRegistry(config.sessionSecret,config.sessionStateFile,config.password)
 const secure=new SecureApi(config,registry,[files]);cleanups.push(()=>secure.close())
 const appServer=nativeFixture?new CodexAppServer(process.execPath,[fileURLToPath(new URL('./fixtures/secure-request-lifetime.mjs',import.meta.url))]):new CodexAppServer('UNUSED'),vault=realRouter?new ContextVault(join(root,'vault')):undefined
 cleanups.push(()=>appServer.stop())
 const controller=new RemoteController(config,appServer,vault)
 let effects=0
 const server:Server=realRouter?createRemoteHttpServer(config,controller,files,null):createServer((req,res)=>{void secure.handle(req,res,async (inside,result)=>{if(inside.method==='POST')effects++;result.setHeader('Content-Type','application/json');result.end(JSON.stringify({canary:'REVIEW ONLY',effects}))})})
 await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));config.port=(server.address() as AddressInfo).port;config.publicOrigin=new URL('http://127.0.0.1:'+config.port)
 cleanups.push(async()=>{server.closeAllConnections();await new Promise<void>(ok=>server.close(()=>ok()))})
 const headers={Origin:config.publicOrigin.origin,Cookie:'codex_remote_session='+issued.token},nativeFetch=globalThis.fetch
 const fetcher:typeof fetch=(path,init)=>nativeFetch(new URL(String(path),config.publicOrigin),{...init,headers:{...headers,...Object.fromEntries(new Headers(init?.headers).entries())}})
 const client=new SecureTransport(fetcher);cleanups.push(()=>client.lock())
 return {config,material,issued,registry,secure,controller,appServer,vault,client,fetcher,effects:()=>effects,keyFile}
}
async function browserModule(f:Awaited<ReturnType<typeof fixture>>) {
 vi.stubGlobal('fetch',f.fetcher);vi.stubGlobal('BroadcastChannel',undefined);vi.resetModules()
 const module=await import('../src/secureApi');cleanups.push(()=>module.lockSecure(false,false));return module
}
it('R1 rejects pending unlock after cross-tab Lock',async()=>{
 const f=await fixture(),api=await browserModule(f),barrier=deferred(),entered=deferred()
 api.installMigrationReady(async()=>{entered.resolve();await barrier.promise})
 const pending=api.unlockSecure(f.material.key);await entered.promise
 api.lockSecure(false,false);expect(api.secureUnlocked()).toBe(false)
 barrier.resolve();await expect(pending).rejects.toThrow(/cancel/i)
 expect(api.secureUnlocked()).toBe(false)
 await expect(api.secureFetch('/api/read')).rejects.toThrow()
})
it('R1 rejects setup-delayed unlock after a newer Lock',async()=>{
 const f=await fixture(),api=await browserModule(f),gate=deferred(),entered=deferred()
 const original=api.secureTransport.setup.bind(api.secureTransport)
 vi.spyOn(api.secureTransport,'setup').mockImplementationOnce(async()=>{entered.resolve();await gate.promise;return original()})
 const pending=api.unlockSecure(f.material.key);await entered.promise;api.lockSecure(false,false);gate.resolve();await expect(pending).rejects.toThrow(/cancel/i)
 expect(api.secureUnlocked()).toBe(false)
})
it('R2 rejects pre-lock pending mutation after a newly unlocked channel',async()=>{
 const f=await fixture(),api=await browserModule(f);await api.unlockSecure(f.material.key)
 const {CipherCache}=await import('../src/secureCache'),gate=deferred(),entered=deferred()
 vi.spyOn(CipherCache.prototype,'identify').mockImplementationOnce(async()=>{entered.resolve();await gate.promise;return randomId()})
 const pending=api.secureFetch('/api/mutation',{method:'POST',body:'{}'});await entered.promise
 api.lockSecure(false,false);await api.unlockSecure(f.material.key);expect(f.effects()).toBe(0)
 gate.resolve();await expect(pending).rejects.toThrow(/cancel/i)
 expect(f.effects()).toBe(0)
 expect(api.secureUnlocked()).toBe(true)
 expect(await (await api.secureFetch('/api/mutation',{method:'POST',body:'{}'})).json()).toMatchObject({effects:1})
})
it.each(['logout','expiry','rotation'] as const)('R3 prevents native side effect after %s invalidates a request stalled in access check',async(reason)=>{
 const f=await fixture(true),gate=deferred(),entered=deferred(),accessDone=deferred();await f.client.unlock(f.material.key)
 vi.spyOn(f.controller,'assertThreadAccess').mockImplementation(async()=>{entered.resolve();await gate.promise;accessDone.resolve()})
 const interrupt=vi.spyOn(f.controller,'interruptTurn').mockImplementation(async()=>({}))
 const pending=f.client.request('/api/threads/FAKE-THREAD/interrupt',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':f.issued.payload.csrf},body:JSON.stringify({turnId:'FAKE-TURN'})}).catch(()=>null)
 await Promise.race([entered.promise,pending.then(async result=>{throw Error('Request did not reach access check: '+(result?await result.response.text():'rejected'))})])
 if(reason==='logout') {
  const logout=await f.client.request('/api/session/logout',{method:'POST',headers:{'x-csrf-token':f.issued.payload.csrf},body:'{}'});expect(await logout.response.json()).toEqual({ok:true})
 } else {
  if(reason==='expiry') vi.spyOn(Date,'now').mockReturnValue(Date.now()+601000)
  else await writeFile(f.keyFile,JSON.stringify({...f.material,generation:randomId(),key:randomId(32)}))
  expect((await f.fetcher('/api/secure/setup')).status).toBe(200) // refresh/prune immediately, no sleep
 }
 await expect(f.client.request('/api/session')).rejects.toMatchObject({status:reason==='rotation'?412:401})
 await pending // Revocation already closed the stalled request before effect begins.
 expect(interrupt).not.toHaveBeenCalled();gate.resolve();await accessDone.promise;await new Promise(resolve=>setImmediate(resolve))
 expect(interrupt).not.toHaveBeenCalled()
})
it('R4 confines all Nginx paths and both starts to non-root filesystem restrictions',async()=>{
 const source=await readFile(new URL('../scripts/nginx-fixture.mjs',import.meta.url),'utf8')
 for (const name of ['client_body_temp_path','proxy_temp_path','fastcgi_temp_path','uwsgi_temp_path','scgi_temp_path']) expect(source).toContain(name)
 for (const rule of ['pid ${root}/nginx.pid','lock_file ${root}/nginx.lock','error_log ${root}/error.log','access_log ${root}/access.log', "['-e', 'stderr'", 'User=nobody', 'ProtectSystem=strict', 'ReadWritePaths=${root}', "'-t', ...nginxArgs"]) expect(source).toContain(rule)
 const fixture=await readFile(new URL('../scripts/secure-proxy-fixture.mjs',import.meta.url),'utf8')
 expect(fixture).toContain('await hostNginxIdentity(), hostBefore')
 expect(fixture).not.toContain('spawn(binary')
})

it.each(['setup', 'proof', 'cache'] as const)('R1 stale %s completion never clears a newer successful unlock', async stage => {
 const f=await fixture(),api=await browserModule(f),gate=deferred(),entered=deferred()
 if(stage==='setup') {
  const original=api.secureTransport.setup.bind(api.secureTransport)
  vi.spyOn(api.secureTransport,'setup').mockImplementationOnce(async()=>{const value=await original();entered.resolve();await gate.promise;return value})
 } else if(stage==='proof') {
  const original=api.secureTransport.fetcher;let hold=true
  vi.spyOn(api.secureTransport,'fetcher').mockImplementation(async(path,init)=>{const value=await original(path,init);if(hold&&String(path).endsWith('/handshake')){hold=false;entered.resolve();await gate.promise}return value})
 } else {
  const {CipherCache}=await import('../src/secureCache')
  vi.spyOn(CipherCache.prototype,'unlock').mockImplementationOnce(async()=>{entered.resolve();await gate.promise})
 }
 const pending=api.unlockSecure(f.material.key);await entered.promise
 api.lockSecure(false,false);await api.unlockSecure(f.material.key)
 gate.resolve();await expect(pending).rejects.toThrow(/cancel|stale/i)
 expect(api.secureUnlocked()).toBe(true)
 expect((await api.secureFetch('/api/read')).ok).toBe(true)
})
it.each(['get', 'body'] as const)('R2 does not refetch after Lock while awaiting cached %s', async stage => {
 const f=await fixture(),api=await browserModule(f);await api.unlockSecure(f.material.key)
 const {CipherCache}=await import('../src/secureCache'),gate=deferred(),entered=deferred()
 const resource=randomId();vi.spyOn(CipherCache.prototype,'identify').mockResolvedValue(resource)
 const first=await api.secureTransport.request('/api/read',{}, {resource});await first.response.arrayBuffer()
 const cached={entry:{},meta:{path:'/api/read',representation:'{}',response:first.meta,expires:Date.now()+60000}}
 vi.spyOn(CipherCache.prototype,'get').mockImplementation(async()=>{if(stage==='get'){entered.resolve();await gate.promise}return cached as never})
 vi.spyOn(CipherCache.prototype,'body').mockImplementation(async()=>{entered.resolve();await gate.promise;throw Error('storage/decryption failed')})
 const spy=vi.spyOn(api.secureTransport,'request')
 const pending=api.secureFetch('/api/read');await entered.promise
 const dispatched=spy.mock.calls.length
 api.lockSecure(false,false);await api.unlockSecure(f.material.key);gate.resolve()
 await expect(pending).rejects.toThrow(/cancel/i)
 expect(spy.mock.calls.length).toBe(dispatched)
 expect(api.secureUnlocked()).toBe(true)
})
it.each(['rename', 'archive', 'resume', 'interrupt', 'turn', 'skills'] as const)('R3 controller %s never dispatches a new native effect after an awaited precondition', async action => {
 const f=await fixture(true),gate=deferred(),entered=deferred();await f.client.unlock(f.material.key)
 const calls:string[]=[]
 vi.spyOn(f.appServer,'request').mockImplementation(async(method)=>{
  calls.push(method)
  if(method==='thread/read'){entered.resolve();await gate.promise;return {thread:{id:'worker',cwd:f.config.workspaceRoots[0],turns:[],status:{type:'idle'}}}}
  return {turn:{id:'FAKE-TURN'}}
 })
 const route=action==='rename'?'/name':action==='turn'?'/turns':action==='skills'?'/skills':('/'+action)
 const method=action==='skills'?'GET':'POST'
 const pending=f.client.request('/api/threads/worker'+route,{method,headers:{'content-type':'application/json','x-csrf-token':f.issued.payload.csrf},...(method==='GET'?{}:{body:JSON.stringify({name:'valid name',text:'FAKE ONLY',turnId:'FAKE-TURN'})})}).catch(()=>null)
 await Promise.race([entered.promise,pending.then(async value=>{throw Error('Did not reach metadata: '+(value?await value.response.text():'closed'))})])
 const logout=await f.client.request('/api/session/logout',{method:'POST',headers:{'x-csrf-token':f.issued.payload.csrf}});await logout.response.arrayBuffer()
 gate.resolve();await pending;await new Promise(resolve=>setImmediate(resolve))
 expect(calls).toEqual(['thread/read'])
})
it('R3 normal live control still dispatches one native interrupt and preserves its result', async()=>{
 const f=await fixture(true);await f.client.unlock(f.material.key)
 const calls:string[]=[]
 vi.spyOn(f.appServer,'request').mockImplementation(async method=>{calls.push(method);return method==='turn/interrupt'?{accepted:true}:{thread:{id:'worker',cwd:f.config.workspaceRoots[0],turns:[],status:{type:'idle'}}}})
 const result=await f.client.request('/api/threads/worker/interrupt',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':f.issued.payload.csrf},body:JSON.stringify({turnId:'FAKE-TURN'})})
 expect(await result.response.json()).toEqual({accepted:true})
 expect(calls).toEqual(['thread/read','thread/resume','turn/interrupt'])
})
it('R3 checks lifetime after context injection before turn/start without undoing accepted injection', async()=>{
 const f=await fixture(true),gate=deferred(),entered=deferred();await f.client.unlock(f.material.key)
 const calls:string[]=[]
 vi.spyOn(f.appServer,'request').mockImplementation(async method=>{calls.push(method);if(method==='thread/inject_items'){entered.resolve();await gate.promise;return {}}return {thread:{id:'worker',cwd:f.config.workspaceRoots[0],turns:[],status:{type:'idle'}}}})
 const pending=f.client.request('/api/threads/worker/turns',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':f.issued.payload.csrf},body:JSON.stringify({text:'FAKE ONLY'})}).catch(()=>null)
 await Promise.race([entered.promise,pending.then(async value=>{throw Error('Did not reach injection: '+(value?await value.response.text():'closed'))})])
 const logout=await f.client.request('/api/session/logout',{method:'POST',headers:{'x-csrf-token':f.issued.payload.csrf}});await logout.response.arrayBuffer()
 gate.resolve();await pending;await new Promise(resolve=>setImmediate(resolve))
 expect(calls).toEqual(['thread/read','thread/resume','thread/inject_items'])
})

it('R3 observes rotation at the native boundary without another request or periodic sweep', async()=>{
 const f=await fixture(true),gate=deferred(),entered=deferred();await f.client.unlock(f.material.key)
 const calls:string[]=[]
 vi.spyOn(f.appServer,'request').mockImplementation(async method=>{calls.push(method);entered.resolve();await gate.promise;return {thread:{id:'worker',cwd:f.config.workspaceRoots[0],status:{type:'idle'},turns:[]}}})
 const pending=f.client.request('/api/threads/worker/name',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':f.issued.payload.csrf},body:JSON.stringify({name:'NO LATE RENAME'})}).catch(()=>null)
 await entered.promise
 await writeFile(f.keyFile,JSON.stringify({...f.material,generation:randomId(),key:randomId(32)}))
 gate.resolve();await pending;await new Promise(resolve=>setImmediate(resolve))
 expect(calls).toEqual(['thread/read'])
})

it.each(['logout','expiry','rotation'] as const)('R3 actual fake-native pipe emits no mutation after %s during startup', async reason=>{
 const f=await fixture(true,true);await f.client.unlock(f.material.key)
 const initializing=once(f.appServer,'notification')
 const pending=f.client.request('/api/threads',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':f.issued.payload.csrf},body:JSON.stringify({workspaceId:'0'})}).catch(()=>null)
 expect((await initializing)[0].method).toBe('fixture/initializing')
 if(reason==='logout') {
  const logout=await f.client.request('/api/session/logout',{method:'POST',headers:{'x-csrf-token':f.issued.payload.csrf}});await logout.response.arrayBuffer()
 } else if(reason==='expiry') vi.spyOn(Date,'now').mockReturnValue(Date.now()+601000)
 else await writeFile(f.keyFile,JSON.stringify({...f.material,generation:randomId(),key:randomId(32)}))
 f.appServer.notify('fixture/release',{})
 await pending
 expect(await f.appServer.request('fixture/effects',{})).toEqual([])
 // A separate explicit native test intent still works; no real model/turn.
 expect(await f.appServer.request('thread/start',{cwd:f.config.workspaceRoots[0]})).toMatchObject({thread:{id:'FAKE-ONLY'}})
 expect(await f.appServer.request('fixture/effects',{})).toEqual(['thread/start'])
})

// Independent b8c781a re-review: the new post-create callback must preserve the
// HTTP request lifetime too, while leaving a legitimately accepted create alone.
it.each(['logout', 'expiry', 'rotation'] as const)('L1 create HTTP post-reply guard skips local adoption after %s', async reason => {
 const f = await fixture(true, true), gate = deferred(), entered = deferred()
 await f.client.unlock(f.material.key)
 const initializing = once(f.appServer, 'notification'), boot = f.appServer.start()
 expect((await initializing)[0].method).toBe('fixture/initializing')
 f.appServer.notify('fixture/release', {}); await boot
 const group = f.vault!.createGroup('Original folder').groups[0]
 const other = f.vault!.createGroup('Newer folder').groups.find(item => item.name === 'Newer folder')!
 const request = f.appServer.request.bind(f.appServer)
 vi.spyOn(f.appServer, 'request').mockImplementation(async (...args) => {
  const result = await request(...args)
  if (args[0] === 'thread/start') { entered.resolve(); await gate.promise }
  return result
 })
 const create = vi.spyOn(f.controller, 'createThread')
 const pending = f.client.request('/api/threads', { method: 'POST',
  headers: { 'content-type': 'application/json', 'x-csrf-token': f.issued.payload.csrf },
  body: JSON.stringify({ workspaceId: '0', groupId: group.id }),
 }).catch(() => null)
 await entered.promise
 const outcome = (create.mock.results[0].value as Promise<unknown>).then(() => null, error => error)
 expect(await request('fixture/effects', {})).toEqual(['thread/start'])
 f.vault!.assignThread('FAKE-ONLY', other.id)
 const record = vi.spyOn(f.vault!, 'recordThread'), assign = vi.spyOn(f.vault!, 'assignThread')
 if (reason === 'logout') {
  const logout = await f.client.request('/api/session/logout', { method: 'POST', headers: { 'x-csrf-token': f.issued.payload.csrf } })
  expect(await logout.response.json()).toEqual({ ok: true })
 } else {
  if (reason === 'expiry') vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 601000)
  else await writeFile(f.keyFile, JSON.stringify({ ...f.material, generation: randomId(), key: randomId(32) }))
  expect((await f.fetcher('/api/secure/setup')).status).toBe(200)
 }
 gate.resolve()
 expect(await outcome).toBeInstanceOf(Error)
 const response = await pending
 if (response) expect(response.response.status).not.toBe(201)
 expect(record).not.toHaveBeenCalled(); expect(assign).not.toHaveBeenCalled()
 expect(f.vault!.groupFor('FAKE-ONLY')?.id).toBe(other.id)
 expect(await request('fixture/effects', {})).toEqual(['thread/start']) // No rollback/replay.
 const rpc = vi.spyOn(f.appServer, 'request').mockRejectedValueOnce(new Error('Cold HTTP create cache'))
 await expect(f.controller.assertThreadAccess('FAKE-ONLY')).rejects.toThrow('Cold HTTP create cache')
 expect(rpc.mock.calls.at(-1)![0]).toBe('thread/read')
})

// Independent re-review controls: accepted effects outlive the browser request.
// The actual stdio-startup cancellation boundary is exercised above; here the
// fake RPC explicitly accepts turn/start before we close the request lifetime.
it.each(['logout', 'lock'] as const)('R3 accepted RPC bookkeeping and background work survive browser %s', async reason => {
 const f = await fixture(true), accepted = deferred(), finish = deferred()
 await f.client.unlock(f.material.key)
 const calls: string[] = [], completed = vi.fn()
 f.controller.onTurnCompleted = completed
 vi.spyOn(f.appServer, 'request').mockImplementation(async (method, params, _timeout, beforeDispatch) => {
  beforeDispatch?.()
  calls.push(method)
  if (method === 'turn/start') { accepted.resolve(); await finish.promise; return { turn: { id: 'ACCEPTED-FAKE-TURN' } } }
  const id = (params as { threadId?: string }).threadId ?? 'FAKE-BACKGROUND'
  return { thread: { id, cwd: f.config.workspaceRoots[0], status: { type: 'idle' }, turns: [] } }
 })
 const pending = f.client.request('/api/threads/worker/turns', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': f.issued.payload.csrf },
  body: JSON.stringify({ text: 'FAKE ACCEPTED JOB ONLY', fullAccess: true }),
 }).catch(() => null)
 await accepted.promise
 if (reason === 'logout') {
  const logout = await f.client.request('/api/session/logout', { method: 'POST', headers: { 'x-csrf-token': f.issued.payload.csrf } })
  expect(await logout.response.json()).toEqual({ ok: true })
 } else f.client.lock()
 await pending
 finish.resolve()
 await new Promise(resolve => setImmediate(resolve))
 // Accepted native turn remains busy: bookkeeping was not skipped by a stale
 // browser guard. No compensating turn/interrupt is sent.
 await expect(f.controller.startTurn('worker', 'must remain busy')).rejects.toThrow(/busy/)
 expect(calls.filter(method => method === 'turn/start')).toHaveLength(1)
 expect(calls).not.toContain('turn/interrupt')
 f.appServer.emit('notification', { method: 'turn/completed', params: { threadId: 'worker', turn: { id: 'ACCEPTED-FAKE-TURN', status: 'completed', items: [] } } })
 expect(completed).toHaveBeenCalledWith('worker', 'ACCEPTED-FAKE-TURN', '')
 // An independent scheduler/native intent has no HTTP lifetime argument. It
 // can continue after the browser lifetime closes, including fullAccess.
 expect(await f.controller.createThread('0', true)).toMatchObject({ thread: { id: 'FAKE-BACKGROUND' } })
 expect(calls.at(-1)).toBe('thread/start')
 expect(calls).not.toContain('turn/interrupt')
})
