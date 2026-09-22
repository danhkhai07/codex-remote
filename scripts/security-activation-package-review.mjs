// Exact unsealed package verification. Read-only live observations; no seal or receipt writes.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { processStart } from './secure-release/key-state.mjs'
import { fileHash, tree, json, same, record, hash, command, serviceIdentity, APP, SOURCE, HOURS, MAIN } from './secure-release/common.mjs'
const prep='/root/.local/state/codex-remote/security-activation-preparation-0830369e'
const release='/root/.local/state/codex-remote/releases/secure-api-80843c0-activation-0830369e'
const author='/root/WORKTREES/cr-security-activation-release'
const candidate='e9a21aacf8a51b040371871be5027e09eaebf345'
const digest='79cb9abe68b1a223e868d44930e200db4b8dee739e0f7c26f77a6aca0898ee9d'
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trimEnd()
assert.equal(git('-C',author,'rev-parse','HEAD'),candidate)
assert.equal(git('-C',author,'status','--porcelain'),'')
assert.equal(fileHash(prep+'/delivery-manifest.json'),digest)
const manifest=json(prep+'/delivery-manifest.json')
assert.equal(manifest.deliveryHead,candidate);assert.equal(manifest.application,APP);assert.equal(manifest.sourceTarget,SOURCE)
for(const [name,entry] of Object.entries(manifest.files)){
 assert(!name.startsWith('/')&&!name.split('/').includes('..'))
 assert.equal(fs.lstatSync(path.join(prep,name)).isFile(),true)
 assert.equal(fileHash(path.join(prep,name)),entry.sha256,name)
 assert.equal(fs.statSync(path.join(prep,name)).size,entry.bytes,name)
}
assert.equal(fileHash(prep+'/package-tree.json'),manifest.packageTreeSha256)
assert.equal(fileHash(release+'/baseline.json'),manifest.baselineSha256)
assert.equal(fileHash(release+'/inventory.json'),manifest.inventorySha256)
const before=tree(release);same(before,json(prep+'/package-tree.json'),'package-tree-drift')
let privateFiles=0
for(const [name,record] of Object.entries(before))if(record.sha256){assert.equal(fs.lstatSync(path.join(release,name)).nlink,1,'shared hardlink:'+name);privateFiles++}
assert(!fs.existsSync(release+'/seal.json'));assert(!fs.existsSync(release+'.activation'))
assert(!fs.existsSync(json(release+'/metadata.json').keyFile))
assert.equal(fs.statSync(release).mode&0o777,0o700)
assert.equal(fs.readFileSync(prep+'/runbook.md','utf8'),fs.readFileSync(author+'/docs/security/security-activation-package-2026-09-22.md','utf8'))
for(const [name,entry] of Object.entries(json(prep+'/evidence-sources.json')))assert.equal(fileHash(entry.source),entry.sha256,name)
const checked=JSON.parse(execFileSync(process.execPath,[prep+'/check-package.mjs','--verify-only'],{encoding:'utf8',maxBuffer:2*1024*1024}))
assert.equal(checked.backend,46);assert.equal(checked.client,33);assert.equal(checked.r6Helpers,12)
assert.equal(checked.mapSources,114);assert.equal(checked.moduleGraph,14);assert.equal(checked.hours,HOURS)
const baseline=json(release+'/baseline.json')
for(const [name,value] of Object.entries(baseline.source))same(record(path.join(MAIN,name)),value,'source baseline drift:'+name)
for(const [unit,digest] of Object.entries(baseline.unitHashes))assert.equal(hash(command('systemctl',['cat',unit])),digest,'effective unit drift:'+unit)
same(record('/etc/systemd/system/workboard.service.d').absent?{}:tree('/etc/systemd/system/workboard.service.d'),baseline.workboardDropins,'workboard dropins drift')
for(const [name,value] of Object.entries(baseline.nginxTempDirectories))same({...record(name),ino:fs.lstatSync(name).ino},value,'Nginx temp metadata drift')
assert.equal(processStart(baseline.oldProcess.pid),baseline.oldProcess.start)
assert.equal(fileHash('/proc/'+baseline.oldProcess.pid+'/cmdline'),baseline.processCommand)
assert.equal(fs.realpathSync('/proc/'+baseline.oldProcess.pid+'/cwd'),baseline.processCwd)
for(const [kind,digest] of Object.entries(baseline.remote))assert.equal(hash(command('git',['remote','get-url',...(kind==='push'?['--push']:[]),'origin'])),digest)
assert.equal(serviceIdentity('codex-remote.service'),baseline.service)
assert.equal(serviceIdentity('workboard.service'),baseline.workboard);assert.equal(serviceIdentity('nginx.service'),baseline.nginx)
const unsealed=spawnSync(process.execPath,[release+'/runner/runner.mjs','--check'],{encoding:'utf8'})
assert.equal(unsealed.status,1);assert.match(unsealed.stderr,/ENOENT.*seal.json/s);assert.equal(unsealed.stdout,'')
const fixture=spawnSync(process.execPath,[prep+'/handoff-fixture.mjs'],{encoding:'utf8'})
assert.equal(fixture.status,0,fixture.stderr);const receiptTests=JSON.parse(fixture.stdout);assert.equal(receiptTests.receiptHandoffCases,8)
same(tree(release),before,'review-mutated-package');assert.equal(fileHash(prep+'/delivery-manifest.json'),digest)
assert(!fs.existsSync(release+'.activation'));assert(!fs.existsSync(json(release+'/metadata.json').keyFile))
console.log(JSON.stringify({candidate,deliveryManifest:digest,packageTree:manifest.packageTreeSha256,baseline:manifest.baselineSha256,
 helperHashes:Object.fromEntries(['check-package.mjs','canary-handoff.mjs','bind-receipts-handoff.mjs','handoff-fixture.mjs'].map(name=>[name,manifest.files[name].sha256])),
 manifestFiles:Object.keys(manifest.files).length,sourceAndEffectiveUnitBaselineMatch:true,processLifetimeMatches:true,nginxTempMetadataUntouched:true,regularFilesWithoutHardlinks:privateFiles,packageCheck:checked,receiptTests,
 unsealedCheck:{exit:1,reason:'ENOENT seal.json before gate evaluation',gateEvaluation:false},unchanged:true,noLiveMutation:true},null,2))
