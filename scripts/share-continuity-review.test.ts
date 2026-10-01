import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ServicesStore } from '../server/services.js'
import { PreviewShares } from '../server/preview-shares.js'
import { originPlan, patchSharePorts } from './share-origin-plan.mjs'
const close:Array<()=>void>=[]
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();for(const f of close.splice(0).reverse())f()})
const input={port:5221,name:'Owned fixture',summary:'Only fixture',prLabel:'No PR',path:'/old',directory:'/original',kind:'prototype'}
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'continuity-review-'));close.push(()=>rmSync(root,{recursive:true,force:true}))
 const file=join(root,'services.json'), grants=join(root,'grants.json'), services=new ServicesStore(file,async()=>true)
 const first=services.upsert(input)
 const options={file:grants,services,secret:'fake-review-only-secret',publicOrigin:'https://owner.test',originTemplate:'https://p{port}.preview.test',ports:[5221,5222],blockedPorts:[5174]}
 const shares=new PreviewShares(options);close.push(()=>shares.close());const link=shares.create({port:5221,ttlSeconds:86400}),cap=new URL(link.url!).hash.slice(1)
 return{root,file,grants,services,first,options,shares,link,cap}
}
it('independent: omitted ownership and metadata updates keep exact grant bytes; restart keeps 24h ceiling',async()=>{
 const f=fixture(),before=readFileSync(f.grants,'utf8'),cookie=f.shares.redeem(f.shares.exchange(f.cap).ticket,5221).cookie.split(';')[0]
 const {directory:_directory,kind:_kind,...metadata}=input
 f.services.upsert({...metadata,name:'V2',summary:'changed',branch:'main',path:'/new'})
 expect(f.services.list()[0]).toMatchObject({directory:input.directory,kind:input.kind,registrationId:f.first.registrationId})
 expect(readFileSync(f.grants,'utf8')).toBe(before)
 const services=new ServicesStore(f.file,async()=>true), shares=new PreviewShares({...f.options,services});close.push(()=>shares.close())
 expect((await shares.list()).links[0].url).toBe(f.link.url);expect(shares.access(cookie,5221)?.valid()).toBe(true)
 const now=Date.parse(f.link.createdAt)+86400_000;vi.spyOn(Date,'now').mockReturnValue(now)
 services.upsert({...input,name:'V3'});expect(shares.access(cookie,5221)).toBeNull();expect(()=>shares.exchange(f.cap)).toThrow()
})
it('independent: same-tick re-registration and explicit replace reject stale/forged identity adoption',()=>{
 vi.useFakeTimers({toFake:['Date']})
 const f=fixture(),before=f.first.registrationId
 f.services.remove('port:5221');f.services.upsert({...input,registrationId:before,identity:before})
 expect(f.services.identity(5221)).not.toBe(before)
 const current=f.services.identity(5221)
 expect(()=>f.services.upsert({...input,expectedIdentity:before})).toThrow(/registration changed/)
 expect(f.services.identity(5221)).toBe(current);expect(()=>f.shares.exchange(f.cap)).toThrow()
 f.services.upsert({...input,expectedIdentity:current,replace:true})
 expect(f.services.identity(5221)).not.toBe(current);expect(()=>f.shares.exchange(f.cap)).toThrow()
})
it('independent: legacy missing identity never adopts grants during migration and continuity update',()=>{
 const f=fixture(),bytes=readFileSync(f.grants,'utf8'),stored=JSON.parse(readFileSync(f.file,'utf8'));delete stored.services[0].identity
 writeFileSync(f.file,JSON.stringify(stored));const services=new ServicesStore(f.file,async()=>true)
 const shares=new PreviewShares({...f.options,services});close.push(()=>shares.close())
 services.upsert({...input,expectedIdentity:services.identity(5221),directory:'/same-app-moved'})
 expect(()=>shares.exchange(f.cap)).toThrow();expect(readFileSync(f.grants,'utf8')).toBe(bytes)
})
it('independent: held list after continuity move returns current grant but omits stale service metadata',async()=>{
 const f=fixture();let release!:(v:boolean)=>void
 const services=new ServicesStore(f.file,()=>new Promise(resolve=>{release=resolve})),shares=new PreviewShares({...f.options,services});close.push(()=>shares.close())
 const pending=shares.list();services.upsert({...input,directory:'/moved',expectedIdentity:services.identity(5221)});release(true)
 const snapshot=await pending;expect(snapshot.links[0].url).toBe(f.link.url);expect(snapshot.services).toEqual([])
})
it('independent: exact staged host bytes regenerate and preserve gateway; unregistered expansion fails',()=>{
 const release='/root/.local/state/codex-remote-secure/releases/share-service-continuity-65778437/infra/'
 const plan=JSON.parse(readFileSync(release+'plan.json','utf8')),bootstrap=readFileSync(release+'nginx-bootstrap.conf','utf8')
 const old=bootstrap.split('\n# New hosts: ACME only; never bypass the preview gateway.')[0]
 const registry={version:1,services:plan.added.map((port:number)=>({port,identity:'11111111-1111-4111-8111-111111111111'}))}
 const existing=plan.ports.filter((p:number)=>!plan.added.includes(p)), generated=originPlan(registry,existing,old,plan.added)
 expect(generated.bootstrap).toBe(bootstrap);expect(generated.active).toBe(readFileSync(release+'nginx-active.conf','utf8'))
 expect(generated.certbotArguments).toEqual(plan.certbotArguments)
 expect(()=>originPlan(registry,existing,old,[5223])).toThrow();expect(()=>originPlan(registry,existing,old,[5174])).toThrow()
 const original=Buffer.from('CODEX_REMOTE_PREVIEW_SHARE_PORTS='+existing.join(',')+'\nOTHER="unchanged"\n')
 expect(patchSharePorts(original,existing,plan.ports).toString()).toBe('CODEX_REMOTE_PREVIEW_SHARE_PORTS='+plan.ports.join(',')+'\nOTHER="unchanged"\n')
})
it('independent inverse: documented post-TLS stage captures old cert, not the planned active lineage',()=>{
 const stage=readFileSync('scripts/share-continuity-stage.mjs','utf8')
 const active=readFileSync('/root/.local/state/codex-remote-secure/releases/share-service-continuity-65778437/infra/nginx-active.conf','utf8')
 const selected=stage.match(/cert: mark\(realpathSync\('([^']+)'\)\)/)?.[1]
 const served=active.match(/ssl_certificate ([^;]+);/)?.[1]
 expect(selected).toBe('/etc/letsencrypt/live/codex-preview-ports/fullchain.pem')
 expect(served).toBe('/etc/letsencrypt/live/codex-preview-ports-v2/fullchain.pem')
 expect(selected).not.toBe(served)
 // Preparation defect, not an exploit in the unarmed review-only package.
})
