// Disposable creator syscall fault injection, not a production flag/helper.
// Import the exact creator source after interposing only its first key fsync.
import fs from 'node:fs'
import { dirname, join } from 'node:path'
import { syncBuiltinESMExports } from 'node:module'
import { execFileSync } from 'node:child_process'
import { parseEnv } from 'node:util'
import { createHash } from 'node:crypto'
const release=process.argv[2], root=dirname(release), key=join(root,'private/owner-key.json')
if(!/^\/tmp\/r5-key-cutover-[^/]+$/.test(root))throw Error('owned-fixture-root-required')
const mode=fs.readFileSync(join(root,'creator-fault-mode'),'utf8'), sync=fs.fsyncSync
if(!['rotate','replace','kill'].includes(mode))throw Error('unknown-fixture-fault')
let fired=false
const digest=()=>createHash('sha256').update(fs.readFileSync(key)).digest('hex')
fs.fsyncSync=fd=>{
  sync(fd)
  if(fired||fs.readlinkSync('/proc/self/fd/'+fd)!==key)return
  fired=true
  const result={originalHash:digest()}
  fs.writeFileSync(join(root,'creator-fault-result.json'),JSON.stringify(result))
  if(mode==='kill'){process.kill(process.pid,'SIGKILL');return}
  if(mode==='replace')fs.unlinkSync(key)
  execFileSync(process.execPath,[join(release,'operator/scripts/secure-key.mjs'),mode==='replace'?'init':'rotate',key],{
    cwd:root,env:{...parseEnv(fs.readFileSync(join(root,'main/.env'),'utf8')),PATH:process.env.PATH},stdio:'ignore',timeout:15000,
  })
  result.replacementHash=digest()
  fs.writeFileSync(join(root,'creator-fault-result.json'),JSON.stringify(result))
}
syncBuiltinESMExports()
await import('./key-init-actual.mjs')
