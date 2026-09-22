// Read-only provenance checks plus copies into THIS review checkout for fixtures.
// Run through codex-heavy. No production publication or compilation.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, lstatSync, unlinkSync, cpSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const candidate='/root/WORKTREES/cr-leader-resolution-history-security', previous='/root/WORKTREES/cr-leader-capacity-model-security'
const security='/root/.local/state/codex-remote/releases/secure-api-80843c0-review-r6-dc9ee20'
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex')
function files(at,prefix='',output={}) {
  for(const name of readdirSync(join(at,prefix)).sort()){
    const path=join(prefix,name),stat=lstatSync(join(at,path))
    if(stat.isDirectory())files(at,path,output)
    else {assert(stat.isFile(),'nonregular fixture artifact');output[path]=hash(join(at,path))}
  }
  return output
}
const git=(at,...args)=>execFileSync('git',['-C',at,...args],{encoding:'utf8',maxBuffer:24*1024*1024}).trimEnd()
assert.equal(git(candidate,'rev-parse','HEAD'),'100381eaabe7c54a55cc051a03f9a5499f6fe297')
assert.equal(git(previous,'rev-parse','HEAD'),'d07206aeaefc591f7d4ae35a4b858883c154e53d')
assert.equal(git(candidate,'status','--porcelain'),'');assert.equal(git(previous,'status','--porcelain'),'')
const names=readdirSync(join(candidate,'dist-server')).sort(), priorDelta=[]
assert.equal(names.length,90)
for(const name of names)if(hash(join(candidate,'dist-server',name))!==hash(join(previous,'dist-server',name)))priorDelta.push(name)
assert.deepEqual(priorDelta,['http-app.js','http-app.js.map','orchestration.js','orchestration.js.map'])
const inventory=JSON.parse(readFileSync(join(security,'inventory.json'),'utf8')), securityDelta=[]
for(const item of inventory.groups.backend)if(hash(join(candidate,item.path))!==item.sha256)securityDelta.push(item.path.slice(12))
assert.deepEqual(securityDelta.sort(),['controller.js','controller.js.map',...priorDelta].sort())
// Narrow source-to-JS checks do not repeat the whole app build/typecheck.
for(const name of ['controller','http-app','orchestration']) {
  const source=readFileSync(join(candidate,'server',name+'.ts'),'utf8')
  const emitted=ts.transpileModule(source,{fileName:name+'.ts',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,esModuleInterop:true,sourceMap:true}})
  assert.equal(readFileSync(join(candidate,'dist-server',name+'.js'),'utf8'),emitted.outputText,name+' emitted JS differs from exact source')
}
const hours={js:hash(join(candidate,'dist-server/work-hours.js')),map:hash(join(candidate,'dist-server/work-hours.js.map'))}
assert.equal(hours.js,'b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93')
assert.equal(hours.map,'6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8')
assert.equal(git(candidate,'diff','--name-only','d07206a','100381e','--','server/work-hours.ts','scripts/working-hours*','**/update.py','**/dashboard.template.html'),'')
for(const name of ['package.json','package-lock.json'])assert.equal(hash(join(candidate,name)),hash(join(security,'dependencies',name)))
const html=readFileSync(join(candidate,'dist/index.html'),'utf8')
const entries=[...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(m=>'dist'+m[1])
assert(entries.some(p=>/index-.+\.js$/.test(p)))
const pending=[...entries],seen=new Set(),checkedSources=new Set();let sources=0
const allAssets=new Set(readdirSync(join(candidate,'dist/assets')).map(name=>'dist/assets/'+name))
const allFiles=new Set([...allAssets,...readdirSync(join(candidate,'dist')).filter(name=>lstatSync(join(candidate,'dist',name)).isFile()).map(name=>'dist/'+name)])
while(pending.length){
  const name=pending.pop();if(seen.has(name))continue;seen.add(name);assert(allFiles.has(name),'missing client graph file: '+name)
  if(/\.(js|css)$/.test(name)){
    const body=readFileSync(join(candidate,name),'utf8')
    for(const m of body.matchAll(/["'`]([./\w-]+\.(?:js|css))["'`]/g)){
      const p=m[1].startsWith('/')?'dist'+m[1]:m[1].startsWith('assets/')?'dist/'+m[1]:join(dirname(name),m[1])
      if(allFiles.has(p))pending.push(p)
      else assert(!/-[\w-]{8}\.(js|css)$/.test(m[1]),'missing hashed dependency: '+p)
    }
    if(allAssets.has(name+'.map')){
      const map=JSON.parse(readFileSync(join(candidate,name+'.map'),'utf8'))
      for(let i=0;i<map.sources.length;i++){
        const local=resolve(dirname(join(candidate,name+'.map')),map.sources[i])
        if(local.startsWith(candidate+'/src/')){assert.equal(readFileSync(local,'utf8'),map.sourcesContent[i]);checkedSources.add(local.slice(candidate.length+1));sources++}
      }
    }
  }
}
for(const name of ['src/ConversationTeam.tsx','src/teamTaskSelection.ts','src/App.tsx','src/api.ts'])assert(checkedSources.has(name),'missing current application map: '+name)
assert.equal(hash(join(candidate,'dist/sw.js')),hash(join(candidate,'public/sw.js')))
// These are read-only artifact copies used by the owned browser process.
assert(root==='/root/WORKTREES/cr-leader-resolution-history-review')
for(const name of ['dist','dist-server']){
  const to=join(root,name),stat=lstatSync(to)
  if(stat.isSymbolicLink()){unlinkSync(to);cpSync(join(candidate,name),to,{recursive:true,errorOnExist:true,force:false})}
  else assert(stat.isDirectory(),'unexpected fixture output')
  assert.deepEqual(files(to),files(join(candidate,name)),name+' fixture copy drift')
}
console.log(JSON.stringify({candidate:git(candidate,'rev-parse','HEAD'),backendCompared:names.length,priorDelta,securityDelta,
  narrowSourceEmissionMatch:true,clientEntries:entries,clientGraph:[...seen].sort(),currentMapSources:sources,checkedSources:[...checkedSources].sort(),
  completeClient:files(join(candidate,'dist')),backendHashes:files(join(candidate,'dist-server')),
  retainedUnreferencedAssets:allAssets.size-[...seen].filter(path=>allAssets.has(path)).reduce((n,path)=>n+1+Number(allAssets.has(path+'.map')),0),
  hours,unchangedDependencies:true,reusedFullCheck:{path:'/tmp/cr-leader-history-full-check.log',sha256:hash('/tmp/cr-leader-history-full-check.log')},noProductionWrites:true}))
