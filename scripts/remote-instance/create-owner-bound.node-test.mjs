import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createBoundOwner} from './create-owner-bound.mjs'
for(const scenario of ['success','boundary-denied','replace-after-bind','existing-key','start-failed'])test('creator identity '+scenario, async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'owner-identity-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.chmodSync(dir,0o700)
 const file=path.join(dir,'owner-key.json');let starts=0, bound
 if(scenario==='existing-key')fs.writeFileSync(file,'existing fake owner\n',{mode:0o600})
 const run=()=>createBoundOwner({file,assertLocation:p=>assert.equal(p,file),boundary:async()=>{if(scenario==='boundary-denied')throw Error('403 proof missing')},bind:async identity=>{bound=identity;if(scenario==='replace-after-bind'){fs.renameSync(file,file+'.original');fs.writeFileSync(file,'replacement',{mode:0o600})}},start:async(verify)=>{verify();starts++;if(scenario==='start-failed')throw Error('owned startup failed')}})
 if(scenario==='success'){const result=await run();assert.equal(starts,1);assert.deepEqual(result,bound);assert.equal(Object.hasOwn(result,'key'),false)}
 else {await assert.rejects(run());assert.equal(starts,scenario==='start-failed'?1:0);if(scenario==='boundary-denied')assert(!fs.existsSync(file));if(scenario==='existing-key')assert.equal(fs.readFileSync(file,'utf8'),'existing fake owner\n');if(scenario==='start-failed'){assert(fs.existsSync(file));await assert.rejects(run());assert.equal(starts,1)}}
})
