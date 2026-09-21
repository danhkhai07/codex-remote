/** Independent adversarial reproductions against fixed d88b163. These tests
 * intentionally ASSERT THE OBSERVED BUGS; green means reproducible, not secure.
 * Switch the bad-result assertions to denial when validating an integrator fix.
 */
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it, vi } from 'vitest'
import { SecureApi } from './secure-api'
import { SecureTransport } from './secure-client'
import { SessionRegistry } from './session-registry'
import { createSession } from './auth'
import { randomId } from './secure-wire'
import { createRemoteHttpServer } from './http-app'
import { RemoteController } from './controller'
import { CodexAppServer } from './codex-app-server'
import type { RemoteConfig } from './config'
const cleanups: Array<() => Promise<unknown> | void> = []
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.resetModules() })
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => {resolve = r}); return {promise, resolve} }
async function fixture(realRouter = false) {
 const root = await mkdtemp(join(tmpdir(), 'secure-independent-')), files = join(root, 'files'), keyFile = join(root, 'owner.json')
 cleanups.push(()=>rm(root,{recursive:true,force:true})); await mkdir(files)
 const material={version:1,app:randomId(),generation:randomId(),key:randomId(32)}
 await writeFile(keyFile,JSON.stringify(material),{mode:0o600})
 const config:RemoteConfig={host:'127.0.0.1',port:0,publicOrigin:new URL('http://localhost'),password:'FAKE review password',sessionSecret:'FAKE independent session '.repeat(3),sessionTtlSeconds:600,codexBin:'UNUSED',production:true,workspaceRoots:[files],fileRoots:[files],secureApiRequired:true,secureKeyFile:keyFile,sessionStateFile:join(root,'sessions.json')}
 const issued=createSession(config.sessionSecret,600,config.password),registry=new SessionRegistry(config.sessionSecret,config.sessionStateFile,config.password)
 const secure=new SecureApi(config,registry,[files]);cleanups.push(()=>secure.close())
 const controller=new RemoteController(config,new CodexAppServer('UNUSED'))
 let effects=0
 const server:Server=realRouter?createRemoteHttpServer(config,controller,files,null):createServer((req,res)=>{void secure.handle(req,res,async (inside,result)=>{if(inside.method==='POST')effects++;result.setHeader('Content-Type','application/json');result.end(JSON.stringify({canary:'REVIEW ONLY',effects}))})})
 await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));config.port=(server.address() as AddressInfo).port;config.publicOrigin=new URL('http://127.0.0.1:'+config.port)
 cleanups.push(async()=>{server.closeAllConnections();await new Promise<void>(ok=>server.close(()=>ok()))})
 const headers={Origin:config.publicOrigin.origin,Cookie:'codex_remote_session='+issued.token},nativeFetch=globalThis.fetch
 const fetcher:typeof fetch=(path,init)=>nativeFetch(new URL(String(path),config.publicOrigin),{...init,headers:{...headers,...Object.fromEntries(new Headers(init?.headers).entries())}})
 const client=new SecureTransport(fetcher);cleanups.push(()=>client.lock())
 return {config,material,issued,registry,secure,controller,client,fetcher,effects:()=>effects,keyFile}
}
async function browserModule(f:Awaited<ReturnType<typeof fixture>>) {
 vi.stubGlobal('fetch',f.fetcher);vi.stubGlobal('BroadcastChannel',undefined);vi.resetModules()
 const module=await import('../src/secureApi');cleanups.push(()=>module.lockSecure(false,false));return module
}
it('R1 reproduces pending unlock restoring owner/channel after cross-tab Lock',async()=>{
 const f=await fixture(),api=await browserModule(f),barrier=deferred(),entered=deferred()
 api.installMigrationReady(async()=>{entered.resolve();await barrier.promise})
 const pending=api.unlockSecure(f.material.key);await entered.promise
 api.lockSecure(false,false);expect(api.secureUnlocked()).toBe(false)
 barrier.resolve();await pending
 // BUG: lock was crossed without new user intent; private API is accessible.
 expect(api.secureUnlocked()).toBe(true)
 expect(await (await api.secureFetch('/api/read')).json()).toMatchObject({canary:'REVIEW ONLY'})
})
it('R1 reproduces setup-delayed unlock ignoring a newer Lock',async()=>{
 const f=await fixture(),api=await browserModule(f),gate=deferred(),entered=deferred()
 const original=api.secureTransport.setup.bind(api.secureTransport)
 vi.spyOn(api.secureTransport,'setup').mockImplementationOnce(async()=>{entered.resolve();await gate.promise;return original()})
 const pending=api.unlockSecure(f.material.key);await entered.promise;api.lockSecure(false,false);gate.resolve();await pending
 expect(api.secureUnlocked()).toBe(true) // BUG, acceptance must be false/rejected.
})
it('R2 reproduces pre-lock pending mutation dispatched through a newly unlocked channel',async()=>{
 const f=await fixture(),api=await browserModule(f);await api.unlockSecure(f.material.key)
 const {CipherCache}=await import('../src/secureCache'),gate=deferred(),entered=deferred()
 vi.spyOn(CipherCache.prototype,'identify').mockImplementationOnce(async()=>{entered.resolve();await gate.promise;return randomId()})
 const pending=api.secureFetch('/api/mutation',{method:'POST',body:'{}'});await entered.promise
 api.lockSecure(false,false);await api.unlockSecure(f.material.key);expect(f.effects()).toBe(0)
 gate.resolve();expect(await (await pending).json()).toMatchObject({effects:1}) // BUG: stale operation is not cancelled.
 expect(f.effects()).toBe(1)
})
it.each(['logout','expiry','rotation'] as const)('R3 reproduces native side effect after %s invalidates a request stalled in access check',async(reason)=>{
 const f=await fixture(true),gate=deferred(),entered=deferred(),effect=deferred();await f.client.unlock(f.material.key)
 vi.spyOn(f.controller,'assertThreadAccess').mockImplementation(async()=>{entered.resolve();await gate.promise})
 const interrupt=vi.spyOn(f.controller,'interruptTurn').mockImplementation(async()=>{effect.resolve();return {}})
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
 expect(interrupt).not.toHaveBeenCalled();gate.resolve();await effect.promise
 expect(interrupt).toHaveBeenCalledTimes(1) // BUG: effect occurs only AFTER revocation, no real RPC.
})
it('R4 confines all Nginx paths and both starts to non-root filesystem restrictions',async()=>{
 const source=await readFile(new URL('../scripts/nginx-fixture.mjs',import.meta.url),'utf8')
 for (const name of ['client_body_temp_path','proxy_temp_path','fastcgi_temp_path','uwsgi_temp_path','scgi_temp_path']) expect(source).toContain(name)
 for (const rule of ['pid ${root}/nginx.pid','lock_file ${root}/nginx.lock','error_log ${root}/error.log','access_log ${root}/access.log', "['-e', 'stderr'", 'User=nobody', 'ProtectSystem=strict', 'ReadWritePaths=${root}', "'-t', ...nginxArgs"]) expect(source).toContain(rule)
 const fixture=await readFile(new URL('../scripts/secure-proxy-fixture.mjs',import.meta.url),'utf8')
 expect(fixture).toContain('await hostNginxIdentity(), hostBefore')
 expect(fixture).not.toContain('spawn(binary')
})
