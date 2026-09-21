// Recovery verifier for an already published Working Hours release. Does not
// install/build/restart anything or call a working-hours mutation endpoint.
import {readFileSync,writeFileSync,copyFileSync,renameSync,readdirSync,readlinkSync,existsSync,mkdirSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
export const sha = b => createHash('sha256').update(b).digest('hex')
const fileHash = p => sha(readFileSync(p))
const json = p => JSON.parse(readFileSync(p,'utf8'))
export function check(ok,message){if(!ok)throw Error(message)}
export function same(actual,expected,label){check(JSON.stringify(Object.entries(actual).sort())===JSON.stringify(Object.entries(expected).sort()),`${label} mismatch`)}
export function tree(root,relative='',result={}){
 for(const e of readdirSync(join(root,relative),{withFileTypes:true})){
  const n=join(relative,e.name);check(!e.isSymbolicLink(),'Unexpected artifact symlink')
  if(e.isDirectory())tree(root,n,result);else{check(e.isFile(),'Unexpected artifact type');result[n]=fileHash(join(root,n))}
 }return result
}
// Read the entire response, not just status/headers: a proxy can emit 200 then
// truncate its body. Label the precise failing path without logging credentials.
export async function readVerified(url,expectedHash,fetcher=fetch,headers={}){
 const label=new URL(url).pathname;let r
 try{
  r=await fetcher(url,{headers,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)})
  check(r.ok,`HTTP ${r.status}`)
  const bytes=Buffer.from(await r.arrayBuffer())
  check(!expectedHash||sha(bytes)===expectedHash,'Body SHA256 mismatch')
  return {bytes,evidence:{path:label,status:r.status,bytes:bytes.length,sha256:sha(bytes)}}
 }catch(e){throw Error(`${label}: ${e.message}${e.cause?.code?` (${e.cause.code})`:''}`)}
}
export function verifyHours(state,backup,api,baselineApi){
 check(JSON.stringify(state)===JSON.stringify(backup),'Authoritative state differs from activation backup; review user edits, never restore')
 check(api.revision===backup.revision && api.autoPaused===(backup.autoPaused??false) && JSON.stringify(api.timer)===JSON.stringify(backup.timer),'Loaded pause/revision/timer mismatch')
 for(const [day,h] of Object.entries(baselineApi.totals))check(Number.isFinite(api.totals[day])&&api.totals[day]+1/3600>=h,'Computed total decreased')
 if(api.autoPaused)same(api.totals,baselineApi.totals,'Paused totals')
}
export async function finalizeRecovery(ops){
 const evidence=await ops.verify()
 await ops.services()
 await ops.guard()
 // Preserve original failure and recheck before atomically replacing the marker.
 await ops.complete({...evidence,servicesVerified:true})
 return evidence
}
export async function recover(release,evidenceDirectory,complete=false){
 const meta=json(join(release,'metadata.json')),base=json(join(release,'baseline.json'))
 const main=meta.main,vault=meta.vault,backend={...base.backend,...meta.modules},client={...base.frontend,...meta.client}
 const cmd=(bin,args)=>execFileSync(bin,args,{cwd:main,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:20000}).trim()
 const identity=()=>{const p=Object.fromEntries(cmd('systemctl',['show','codex-remote.service','-p','MainPID','-p','ExecMainStartTimestampMonotonic','-p','ActiveState']).split('\n').map(x=>x.split('=')));check(p.ActiveState==='active'&&Number(p.MainPID)>0,'Gateway inactive');check(readlinkSync(`/proc/${p.MainPID}/cwd`)===main&&fileHash(`/proc/${p.MainPID}/cmdline`)===base.command,'Gateway entry identity mismatch');check(p.MainPID!==base.pid&&BigInt(p.ExecMainStartTimestampMonotonic)>BigInt(base.started),'No fresh replacement gateway');return {pid:p.MainPID,started:p.ExecMainStartTimestampMonotonic}}
 const current=identity(),failed=readFileSync(meta.marker)
 check(json(meta.marker).status==='failed'&&json(meta.marker).phase==='verification','Recovery requires failed verification marker')
 const guard=()=>{
  check(cmd('git',['rev-parse','HEAD'])===meta.commit&&!cmd('git',['status','--porcelain']),'Main source drift')
  const sealed=tree(release);delete sealed['seal.json'];same(sealed,json(join(release,'seal.json')).files,'Original seal')
  same(tree(join(main,'dist-server')),backend,'Complete backend including excluded modules');same(tree(join(main,'dist')),client,'Client including retained assets')
  for(const [p,h] of Object.entries(base.guards))check(fileHash(p)===h,'Configuration/watcher drift')
  check(sha(cmd('systemctl',['cat','codex-remote.service']))===base.unit&&sha(cmd('crontab',['-l']))===base.cron,'Service/cron drift')
  for(const [n,h] of Object.entries(meta.vaultSources))check(fileHash(join(vault,n))===h,'Vault source drift')
  same(identity(),current,'Gateway PID/start');check(readFileSync(meta.marker).equals(failed),'Failure marker changed concurrently')
 }
 guard()
 const {loadConfig}=await import(pathToFileURL(join(main,'dist-server/config.js')).href)
 const {createSession}=await import(pathToFileURL(join(main,'dist-server/auth.js')).href)
 const config=loadConfig();check(meta.origins[0]===`http://${config.host}:${config.port}`&&meta.origins[1]===config.publicOrigin.origin,'Origins drift')
 const session=createSession(config.sessionSecret,300),headers={Cookie:`codex_remote_session=${session.token}`,Origin:config.publicOrigin.origin,'X-CSRF-Token':session.payload.csrf,'Content-Type':'application/json'}
 const api=async path=>JSON.parse((await readVerified(meta.origins[0]+path,null,fetch,headers)).bytes)
 let checked
 const ops={
  guard,
  async verify(){
   const backup=json(join(meta.activation,'backup/working-hours-state.json')),state=json(join(vault,'working-hours-state.json')),beforeHash=fileHash(join(vault,'working-hours-state.json'))
   // Calculate old estimator against the exact activation snapshot in memory;
   // no GET migration or backup state is ever written by this verifier.
   const data=json(join(meta.activation,'backup/data.json')),estimates=Object.fromEntries(data.days.filter(x=>Number.isFinite(x.estimatedHours)).map(x=>[x.date,x.estimatedHours]))
   const totals=Object.fromEntries(Object.entries({...estimates,...backup.totals}).map(([d,h])=>[d,Math.max(0,Math.min(24,h+(backup.totals[d]===undefined?0:Math.max(0,(estimates[d]??0)-(backup.estimateBaselines?.[d]??estimates[d]??0)))))]))
   const hours=await api('/api/working-hours');verifyHours(state,backup,hours,{totals})
   check(fileHash(join(vault,'working-hours-state.json'))===beforeHash,'GET changed state')
   const generated=json(join(vault,'data.json')),rendered=readFileSync(join(vault,'index.html'),'utf8'),embedded=rendered.match(/<script id="work-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1]
   check(embedded&&JSON.stringify(JSON.parse(embedded))===JSON.stringify(generated),'Generated embedded data mismatch')
   check(Array.isArray(generated.activityIntervals)&&generated.autoPaused===hours.autoPaused,'Generator pause/interval schema mismatch')
   check(rendered===readFileSync(join(vault,'dashboard.template.html'),'utf8').replace('__WORK_DATA__',embedded)&&rendered.includes('id="auto-toggle"'),'Generated template identity mismatch')
   const generatorReceipt=json(join(meta.activation,'generator.json'));same(generatorReceipt.sources,meta.vaultSources,'Generator activation receipt')
   const html=readFileSync(join(release,'client/index.html')),assets=[...html.toString().matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(x=>x[1]),checks=[]
   for(const origin of meta.origins){
    const health=JSON.parse((await readVerified(origin+'/api/healthz')).bytes);check(health.status==='ok'&&health.codex==='ready','Health not ready')
    const page=await readVerified(origin+'/?hours-recovery='+meta.commit.slice(0,7),sha(html)),assetChecks=[]
    for(const a of assets)assetChecks.push((await readVerified(origin+a,meta.client[a.slice(1)])).evidence)
    const served=await readVerified(origin+'/api/files/html-preview?'+new URLSearchParams({path:join(vault,'index.html')}),sha(rendered),fetch,headers)
    check(served.bytes.toString().includes('id="auto-toggle"'),'Served dashboard control missing')
    checks.push({origin,health,html:page.evidence,assets:assetChecks,dashboard:served.evidence})
   }
   guard();checked={pidBefore:base.pid,pidAfter:current.pid,startedAfter:current.started,checks,modules:meta.modules,excludedBackendPreserved:true,oldAssetsPreserved:true,generatorVerified:true,statePreserved:true,stateHash:beforeHash,loadedPauseSchema:true,readOnlyHoursVerification:true,noRestartDuringRecovery:true,sourceCommit:meta.commit}
   return checked
  },
  async services(){
   const entry={port:null,path:'/working-hours',name:'Working Hours',summary:'Tổng giờ liên tục sau chỉnh sửa; Tạm dừng/Tiếp tục lưu chung nhiều máy, dừng bộ đếm và không cộng bù thời gian đã tạm dừng. Reload tab cũ để dùng nút mới.',prLabel:'Không có PR · pause '+meta.commit.slice(0,7),prUrl:'',branch:'main',directory:main,kind:'app'}
   const r=await fetch(meta.origins[0]+'/api/services',{method:'PUT',headers,body:JSON.stringify(entry),signal:AbortSignal.timeout(15000)});check(r.ok,'Services PUT failed');const saved=await r.json();check(saved.service?.summary===entry.summary,'Services saved content mismatch')
   const list=await api('/api/services');check(list.services.some(x=>x.path===entry.path&&x.summary===entry.summary&&x.branch==='main'),'Services readback mismatch')
  },
  async complete(evidence){
   mkdirSync(evidenceDirectory,{recursive:true,mode:0o700})
   const original=join(evidenceDirectory,'original-failed-marker.json');if(!existsSync(original))writeFileSync(original,failed,{mode:0o600});else check(readFileSync(original).equals(failed),'Original failure evidence mismatch')
   const final={status:'complete',commit:meta.commit,release,at:new Date().toISOString(),unit:meta.unit,recovered:true,recoveryEvidence:evidenceDirectory,recoveryVerifierSha256:fileHash(fileURLToPath(import.meta.url)),originalFailure:json(original),...evidence}
   const tmp=meta.marker+'.recovery.tmp';guard();writeFileSync(tmp,JSON.stringify(final,null,2)+'\n',{mode:0o600});renameSync(tmp,meta.marker)
   copyFileSync(meta.marker,join(evidenceDirectory,'complete.json'))
  },
 }
 if(complete)return finalizeRecovery(ops)
 return ops.verify()
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,release,evidence]=process.argv.slice(2)
 check(['--check','--complete'].includes(mode)&&release&&evidence,'Usage: --check|--complete RELEASE EVIDENCE_DIRECTORY')
 try{const result=await recover(resolve(release),resolve(evidence),mode==='--complete');console.log(JSON.stringify({status:mode==='--complete'?'complete':'verified-read-only',...result},null,2))}
 catch(e){console.error(e.message);process.exitCode=1}
}
