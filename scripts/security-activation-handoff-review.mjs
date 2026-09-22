// Independent owned-fixture controls. Never executes a live mutation helper.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { APP, SOURCE, HOSTS, fileHash, tree } from './secure-release/common.mjs'
import { evidenceErrors } from './secure-release/production.mjs'
const prep='/root/.local/state/codex-remote/security-activation-preparation-0830369e'
const candidate='/root/.local/state/codex-remote/releases/secure-api-80843c0-activation-0830369e'
const runnerSource='7aca8ddb918550a3d565802423965681131e0ac9'
const base=fs.mkdtempSync(path.join(os.tmpdir(),'cr2-activation-handoff-'))
const write=(name,value)=>fs.writeFileSync(name,JSON.stringify(value),{mode:0o600})
const read=name=>JSON.parse(fs.readFileSync(name,'utf8'))
assert.equal(fileHash(prep+'/bind-receipts-handoff.mjs'),'fada8c2d4968180a2db7022db7d6be6eb8f4bfa46497fdc81f9d90f334168a5a')
assert.equal(fileHash(prep+'/canary-handoff.mjs'),'9235b5e4e07e5fd512f8151d77b0b7d9d2728c9ea4b4838a53f1252100910f1a')
const checks=[]
function fixture(name){
 const root=path.join(base,name),release=path.join(root,'release'),evidence=release+'.activation/evidence'
 fs.mkdirSync(evidence,{recursive:true,mode:0o700});fs.mkdirSync(release,{mode:0o700})
 fs.cpSync(candidate+'/runner',release+'/runner',{recursive:true});fs.cpSync(prep+'/receipt-evidence',evidence,{recursive:true})
 const now=new Date().toISOString()
 const profile={choice:'keep-codex-with-fresh-profile',procedure:'FAKE completed profile procedure',freshProfileCreatedAt:now,profileEvidenceId:'FAKE fixture id',oldProfileCredentialsUsed:false,source:'FAKE provenance'}
 const approval={app:APP,source:SOURCE,preparationSource:runnerSource,exactPackageReviewed:true,operator:'FAKE operator',privateSshRetrievalReady:true,existingUserAuthorization:'FAKE authorization source',at:now}
 const network={kind:'fresh-network-observation-not-approval',at:now,hosts:HOSTS,canaryPath:'/.well-known/acme-challenge/FAKE',canaryDigest:'FAKE-digest',originCertificateFingerprint:'FAKE-cert',publicCertificateFingerprints:Object.fromEntries(HOSTS.map(h=>[h,'FAKE-edge']))}
 write(release+'/metadata.json',{app:APP,sourceTarget:SOURCE,runnerSource,activationEligible:true})
 write(release+'/seal.json',{fixture:'not an activation seal'})
 return {root,release,evidence,profile,approval,network}
}
const launch=(file,env,args=[])=>spawnSync(process.execPath,[file,...args],{env:{PATH:process.env.PATH,...env},encoding:'utf8',timeout:20000})
try{
 const invalid={
  'future-profile':f=>{f.profile.freshProfileCreatedAt=new Date(Date.now()+3600000).toISOString()},
  'missing-profile-date':f=>{delete f.profile.freshProfileCreatedAt},
  'missing-profile-source':f=>{f.profile.source=' '},
  'future-operator':f=>{f.approval.at=new Date(Date.now()+3600000).toISOString()},
  'missing-operator-time':f=>{delete f.approval.at},
  'invalid-operator-time':f=>{f.approval.at='not-a-date'},
  'future-network':f=>{f.network.at=new Date(Date.now()+3600000).toISOString()},
  'missing-network-time':f=>{delete f.network.at},
  'wrong-network-hosts':f=>{f.network.hosts=HOSTS.slice(1)},
  'wrong-app':f=>{f.approval.app='wrong-app'},
  'wrong-source':f=>{f.approval.source='wrong-source'},
  'wrong-runner':f=>{f.approval.preparationSource='wrong-runner'},
  'withdrawn-evidence':f=>{fs.unlinkSync(f.evidence+'/r6-review.md')},
 }
 for(const [name,change] of Object.entries(invalid)){
  const f=fixture(name);change(f)
  for(const [name,body] of Object.entries({'profile-readiness.json':f.profile,'operator-readiness.json':f.approval,'fresh-network.json':f.network,'canary.json':{fixture:true}}))write(f.evidence+'/'+name,body)
  const result=launch(prep+'/bind-receipts-handoff.mjs',{CR_RELEASE:f.release,CR_PREP:prep})
  assert.equal(result.status,1,name);assert(!fs.existsSync(f.release+'.activation/evidence.json'));assert(!fs.existsSync(f.release+'.activation/authorization.json'))
  checks.push(name)
 }
 for(const partial of [false,true]){
  const f=fixture(partial?'partial-exclusive-write':'normal-binding-withdrawal')
  for(const [name,body] of Object.entries({'profile-readiness.json':f.profile,'operator-readiness.json':f.approval,'fresh-network.json':f.network,'canary.json':{fixture:true}}))write(f.evidence+'/'+name,body)
  const auth=f.release+'.activation/authorization.json',e=f.release+'.activation/evidence.json'
  if(partial)fs.symlinkSync(path.join(f.root,'absent-target'),auth)
  const result=launch(prep+'/bind-receipts-handoff.mjs',{CR_RELEASE:f.release,CR_PREP:prep})
  assert.equal(result.status,partial?1:0,result.stderr)
  const evidence=read(e),digest=fileHash(e)
  assert.equal(evidence.migration.at,f.approval.at);assert.equal(evidence.migration.freshProfileCreatedAt,f.profile.freshProfileCreatedAt)
  assert.equal(evidence.migration.remainingRisk,'arbitrary-old-profile-not-attestable')
  if(partial){assert(fs.lstatSync(auth).isSymbolicLink());assert(!fs.existsSync(path.join(f.root,'absent-target')))}
  else{const a=read(auth);assert.equal(a.at,f.approval.at);assert.equal(a.evidence,digest);assert.equal(a.seal,fileHash(f.release+'/seal.json'));assert.equal(a.runner,fileHash(f.release+'/runner/production.mjs'));assert.equal(a.source,SOURCE)}
  assert.equal(launch(prep+'/bind-receipts-handoff.mjs',{CR_RELEASE:f.release,CR_PREP:prep}).status,1)
  assert.equal(fileHash(e),digest)
  f.profile.source='Changed after binding';write(f.evidence+'/profile-readiness.json',f.profile)
  assert(evidenceErrors(f.release+'.activation',fileHash(f.release+'/seal.json'),read(e)).includes('evidence-file-drift:migration'))
  checks.push(partial?'partial-write-kept-and-retry-blocked':'binding-hashes-time-withdrawal')
 }
 // Canary fixture seams are explicit: three filesystem roots and network imports
 // relocate to this owned tree. No staged payload, real DNS/TLS or host config changes.
 const original=fs.readFileSync(prep+'/canary-handoff.mjs','utf8')
 const common=pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)),'secure-release/common.mjs')).href
 for(const scenario of ['normal','foreign-lock','active-attempt','changed-token','dns-failure','tls-failure','wrong-body','late-preimage-drift']){
  const f=fixture('canary-'+scenario),challenge=path.join(f.root,'challenge'),nginx=path.join(f.root,'nginx'),lock=path.join(f.root,'deployment.lock')
  fs.mkdirSync(challenge,{mode:0o755});fs.chmodSync(challenge,0o755);fs.mkdirSync(nginx,{mode:0o700})
  write(nginx+'/config',{fixture:true});write(f.release+'/baseline.json',{destinations:{entries:{},parents:{}},nginxFiles:tree(nginx),service:'fixture-gateway',workboard:'fixture-workboard'})
  write(f.release+'/metadata.json',{keyFile:path.join(f.root,'ABSENT-fake-key')})
  fs.writeFileSync(f.release+'/runner/common.mjs',`export * from ${JSON.stringify(common)};\nimport {BASE} from ${JSON.stringify(common)};\nlet reads=0;export const command=(file,args)=>{if(file!=='git')throw Error('unexpected fixture command');if(args[0]==='rev-parse')return ++reads===2&&${JSON.stringify(scenario)}==='late-preimage-drift'?'changed':BASE;if(args[0]==='status')return '';if(args[0]==='ls-remote')return BASE+' refs/heads/main';throw Error('unexpected git command')};\nexport const serviceIdentity=unit=>{if(unit==='codex-remote.service')return 'fixture-gateway';if(unit==='workboard.service')return 'fixture-workboard';throw Error('unexpected unit')};\n`)
  const network=path.join(f.root,'fake-network.mjs')
  fs.writeFileSync(network,`import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import fs from 'node:fs';const hosts=${JSON.stringify(HOSTS)};export const resolve4=async host=>{assert(hosts.includes(host));if(${JSON.stringify(scenario)}==='dns-failure')throw Error('fake DNS failure');return ['192.0.2.1']};export function connect(options,ready){assert(hosts.includes(options.servername));assert(options.host===options.servername||options.host==='103.195.237.172');assert.equal(options.rejectUnauthorized,true);fs.appendFileSync(${JSON.stringify(f.root+'/tls-count')},'1');const s=new EventEmitter();s.setTimeout=()=>s;s.end=()=>s;s.destroy=e=>{s.emit('error',e);return s};s.getPeerCertificate=()=>({fingerprint256:'FAKE-normal-trust-'+(options.host==='103.195.237.172'?'origin':options.servername)});queueMicrotask(()=>${JSON.stringify(scenario)}==='tls-failure'?s.emit('error',Error('fake TLS failure')):ready());return s}\n`)
  let source=original
  const replacements={"'/var/lib/codex-preview-acme/.well-known/acme-challenge'":JSON.stringify(challenge),"'/etc/nginx'":JSON.stringify(nginx),"'/root/.local/state/codex-remote/deployment.lock'":JSON.stringify(lock),"'node:dns/promises'":JSON.stringify(pathToFileURL(network).href),"'node:tls'":JSON.stringify(pathToFileURL(network).href)}
  for(const [before,after] of Object.entries(replacements)){assert.equal(source.split(before).length,2,'fixture seam changed:'+before);source=source.replace(before,after)}
  const helper=path.join(f.root,'canary-fixture.mjs'),preload=path.join(f.root,'preload.mjs')
  fs.writeFileSync(helper,source)
  fs.writeFileSync(preload,`import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';globalThis.fetch=async(url,options)=>{const u=new URL(url);assert(${JSON.stringify(HOSTS)}.includes(u.hostname));assert.equal(u.protocol,'http:');assert.equal(options.redirect,'error');assert(options.signal);assert.match(u.pathname,/^\\/\\.well-known\\/acme-challenge\\/codex-final-[a-f0-9]{32}$/);const b=fs.readFileSync(path.join(${JSON.stringify(challenge)},path.basename(u.pathname)));return new Response(${JSON.stringify(scenario)}==='wrong-body'?'wrong-body':b,{status:200})};\n`)
  const run=mode=>spawnSync(process.execPath,['--import',preload,helper,mode],{env:{PATH:process.env.PATH,CR_RELEASE:f.release},encoding:'utf8',timeout:20000})
  if(scenario==='foreign-lock'){fs.mkdirSync(lock);write(lock+'/owner.json',{fixtureForeign:true});const before=fileHash(lock+'/owner.json');assert.equal(run('create').status,1);assert.equal(fileHash(lock+'/owner.json'),before);assert.deepEqual(fs.readdirSync(challenge),[]);checks.push('canary-'+scenario);continue}
  const creation=run('create'),success=['normal','active-attempt','changed-token'].includes(scenario)
  assert.equal(creation.status,success?0:1,scenario+':'+creation.stderr)
  assert(!fs.existsSync(lock));const owned=read(f.evidence+'/canary.json');assert(owned.path.startsWith(challenge+'/'))
  assert(fs.existsSync(owned.path));assert.equal(fs.statSync(owned.path).mode&0o777,0o644)
  assert.equal(fs.existsSync(f.evidence+'/fresh-network.json'),success)
  if(success){assert.equal(fs.readFileSync(f.root+'/tls-count','utf8').length,14);assert.equal(read(f.evidence+'/fresh-network.json').canaryDigest,owned.sha256)}
  if(scenario==='active-attempt')write(f.release+'.activation/attempt.json',{status:'running'})
  if(scenario==='changed-token')fs.appendFileSync(owned.path,'changed')
  if(['active-attempt','changed-token'].includes(scenario)){
   const before=fileHash(owned.path);assert.equal(run('remove').status,1);assert.equal(fileHash(owned.path),before);assert(!fs.existsSync(f.evidence+'/canary-removed.json'))
  }else{
   assert.equal(run('remove').status,0);assert(!fs.existsSync(owned.path));assert(read(f.evidence+'/canary-removed.json').absent)
   assert(fs.existsSync(f.evidence+'/canary.json'));assert.equal(run('remove').status,1)
  }
  assert(!fs.existsSync(lock));checks.push('canary-'+scenario)
 }
 console.log(JSON.stringify({independentCases:checks.length,checks,productionMutation:false,realNetworkUsed:false,canaryFixtureSeams:'3 owned filesystem roots plus fake DNS/TLS/fetch and command/service adapters; published helper/payload unchanged',bindingHelper:'exact delivered bytes with fixture CR_RELEASE/CR_PREP',observations:'not production readiness'},null,2))
}finally{assert(base.startsWith(os.tmpdir()+'/cr2-activation-handoff-'));fs.rmSync(base,{recursive:true,force:true})}
