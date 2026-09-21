import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readVerified,sha,verifyHours,finalizeRecovery,same} from './working-hours-recovery.mjs'
test('200 headers followed by truncated body is a labeled verification failure',async()=>{
 const server=createServer((_req,res)=>{res.writeHead(200,{'Content-Length':'1000'});res.write('partial');setTimeout(()=>res.destroy(),10)})
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));try{await assert.rejects(readVerified(`http://127.0.0.1:${server.address().port}/assets/entry.js`),/\/assets\/entry.js: terminated \(UND_ERR_SOCKET\)/)}finally{await new Promise(ok=>server.close(ok))}
})
test('complete body must match expected hash',async()=>{
 const fetcher=async()=>new Response('correct');assert.equal((await readVerified('https://fixture/asset',sha('correct'),fetcher)).evidence.bytes,7)
 await assert.rejects(readVerified('https://fixture/asset',sha('wrong'),fetcher),/SHA256 mismatch/)
})
test('state, revision, pause and timer cannot silently reset; natural estimate growth allowed',()=>{
 const state={revision:2,totals:{day:1},timer:null},api={...state,autoPaused:false,totals:{day:2}}
 verifyHours(state,state,api,{totals:{day:1.5}})
 assert.throws(()=>verifyHours({...state,revision:3},state,api,{totals:{day:1.5}}),/Authoritative state/)
 assert.throws(()=>verifyHours(state,state,{...api,autoPaused:true},{totals:{day:1.5}}),/pause/)
 assert.throws(()=>verifyHours(state,state,{...api,timer:{startedAt:1}},{totals:{day:1.5}}),/timer/)
 assert.throws(()=>verifyHours(state,state,{...api,totals:{day:1}},{totals:{day:1.5}}),/decreased/)
})
test('paused computed hours cannot grow',()=>{
 const state={revision:2,totals:{day:1},timer:null,autoPaused:true}
 assert.throws(()=>verifyHours(state,state,{...state,totals:{day:2}},{totals:{day:1}}),/Paused totals/)
})
for(const fail of ['verify','services','guard'])test(`${fail} failure preserves old failed marker`,async()=>{
 let completed=false;const ops={async verify(){return {}},async services(){},async guard(){},async complete(){completed=true}};ops[fail]=()=>{throw Error('injected')}
 await assert.rejects(finalizeRecovery(ops),/injected/);assert.equal(completed,false)
})
test('completion only follows all verification, registry and final drift checks',async()=>{
 const calls=[];await finalizeRecovery({async verify(){calls.push('verified');return {pidAfter:'new'}},async services(){calls.push('registry')},async guard(){calls.push('guard')},async complete(e){calls.push('complete');assert.equal(e.servicesVerified,true);assert.equal(e.pidAfter,'new')}})
 assert.deepEqual(calls,['verified','registry','guard','complete'])
})
test('artifact set comparison rejects removed, additional and changed files',()=>{
 same({b:'2',a:'1'},{a:'1',b:'2'},'fixture');for(const x of [{a:'1'},{a:'1',b:'3'},{a:'1',b:'2',c:'3'}])assert.throws(()=>same(x,{a:'1',b:'2'},'fixture'),/mismatch/)
})
