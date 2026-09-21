import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { assertServicePolicy, cgroupEmpty } from './cutover-ops.mjs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { main } from './key-cutover.mjs'
test('R5: stop proof rejects non-control-group policy and activation triggers',()=>{
  const good={Type:'simple',KillMode:'control-group',SendSIGKILL:'yes',TriggeredBy:''};assertServicePolicy(good)
  for(const patch of [{KillMode:'process'},{KillMode:'none'},{SendSIGKILL:'no'},{TriggeredBy:'gateway.socket'},{Type:'forking'}]) assert.throws(()=>assertServicePolicy({...good,...patch}))
})
test('R5: empty parent cgroup is insufficient when a nested cgroup retains a PID',()=>{
  const root=mkdtempSync(join(tmpdir(),'r5-cgroup-'))
  try {writeFileSync(join(root,'cgroup.procs'),'');mkdirSync(join(root,'child'));writeFileSync(join(root,'child/cgroup.procs'),'424242\n');assert.equal(cgroupEmpty(root),false);writeFileSync(join(root,'child/cgroup.procs'),'');assert.equal(cgroupEmpty(root),true)} finally {rmSync(root,{recursive:true,force:true})}
})
test('R5: scoped systemctl entry rejects all other commands before loading a release',async()=>{
  for(const args of [[],['start','codex-remote.service'],['restart','nginx.service'],['restart','codex-remote.service','--force']]) await assert.rejects(main(args,'/nonexistent-fixture'),/only-accepts/)
})

test('R5: actual invocation-local executable accepts no arbitrary systemctl operation',async()=>{
  await assert.rejects(promisify(execFile)(fileURLToPath(new URL('./cutover-bin/systemctl',import.meta.url)),['restart','nginx.service']),error=>error.code===1&&error.stderr.includes('cutover-only-accepts-gateway-restart'))
})
