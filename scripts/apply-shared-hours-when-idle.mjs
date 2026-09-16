import { createSession } from '../dist-server/auth.js'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const statusPath='/root/.local/share/flint-working-hours/deployment.json'
mkdirSync('/root/.local/share/flint-working-hours',{recursive:true})
const state=(status,extra={})=>writeFileSync(statusPath,JSON.stringify({status,at:new Date().toISOString(),...extra},null,2)+'\n')
const host=process.env.CODEX_REMOTE_HOST||'127.0.0.1',port=process.env.CODEX_REMOTE_PORT||'5173',base=`http://${host}:${port}`
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
function auth(){const s=createSession(process.env.CODEX_REMOTE_SESSION_SECRET,300);return {Cookie:`codex_remote_session=${s.token}`,'X-CSRF-Token':s.payload.csrf,Origin:process.env.CODEX_REMOTE_PUBLIC_ORIGIN,'Content-Type':'application/json'}}
async function idle(){const r=await fetch(base+'/api/threads',{headers:auth(),signal:AbortSignal.timeout(10000)});if(!r.ok)return false;const body=await r.json();return Array.isArray(body.data)&&body.data.every(t=>['idle','notLoaded','systemError'].includes(t.status?.type))}
state('waiting-for-idle')
try {
  const deadline=Date.now()+30*60*1000
  let ready=false
  while(Date.now()<deadline){if(await idle()){await sleep(3000);if(await idle()){ready=true;break}}await sleep(5000)}
  if(!ready)throw Error('Timed out waiting for idle turns; no restart performed')
  state('restarting')
  execFileSync('systemctl',['restart','codex-remote.service'],{timeout:30000})
  let healthy=false
  for(let i=0;i<30;i++){
    await sleep(1000)
    try{const r=await fetch(base+'/api/healthz',{signal:AbortSignal.timeout(2000)});if(r.ok){healthy=true;break}}catch{}
  }
  if(!healthy)throw Error('Gateway did not become healthy after restart')
  // Invalid input proves the new authenticated route is active without recording fake presence.
  const r=await fetch(base+'/api/working-hours',{headers:auth(),signal:AbortSignal.timeout(5000)})
  if(r.status!==200)throw Error(`Working-hours route verification failed: ${r.status}`)
  const shared=await r.json();if(!Number.isInteger(shared.revision)||!shared.totals)throw Error('Invalid shared state')
  execFileSync('/usr/bin/flock',['-n','/root/VAULTS/Flint-Software/Working-Hours/.update.lock','/usr/bin/python3','/root/VAULTS/Flint-Software/Working-Hours/update.py'],{timeout:30000})
  state('active',{health:'ok',sharedHoursRoute:'verified'})
}catch(e){state('failed',{error:e instanceof Error?e.message:String(e)});process.exitCode=1}
