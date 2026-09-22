// R5 inverse proof converted to real old-process / actual cutover acceptance.
// Only fake credentials, owned tempdirs and loopback child processes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, chmod, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fork, execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { createServer, Agent, request } from 'node:http'
import { connect } from 'node:net'
import { APP, SOURCE, tree, fileHash, atomicBytes } from './common.mjs'
import { processStart, provisionPlan } from './key-state.mjs'
import { receiptBinding, servicePolicy } from './cutover-ops.mjs'
import { destinationSnapshot } from './destinations.mjs'
const run = promisify(execFile), reviewed = process.env.REVIEW_RELEASE
const gatewayScript = new URL('./fixtures/key-gateway.mjs', import.meta.url), driverScript = new URL('./fixtures/key-driver.mjs', import.meta.url)
async function fixture(t, { separateRunner = false } = {}) {
  assert(reviewed, 'REVIEW_RELEASE required; R5 acceptance must not silently skip')
  const root = await mkdtemp(join(tmpdir(), 'r5-key-cutover-')), main = join(root, 'main'), release = join(root, 'release'), outside = release + '.activation'
  const key = join(root, 'private/owner-key.json'), files = join(root, 'files'), vault = join(root, 'vault'), children = new Set(), sockets = new Set()
  const agent = new Agent({ keepAlive: true })
  t.after(async () => { agent.destroy(); for (const socket of sockets) socket.destroy(); for (const child of children) { if (child.exitCode === null && child.signalCode === null) { const done = once(child, 'exit'); child.kill('SIGKILL'); await done } } await rm(root, { recursive: true, force: true }) })
  for (const path of [main, release, outside, files, vault, join(main, 'node_modules'), join(root, 'lock')]) await mkdir(path, { mode: 0o700 })
  const portServer = createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening'); const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve))
  const env = { PATH: process.env.PATH, CODEX_REMOTE_PASSWORD: 'FAKE R5 password', CODEX_REMOTE_SESSION_SECRET: 'FAKE R5 session'.repeat(5), CODEX_REMOTE_PORT: String(port), CODEX_REMOTE_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`, CODEX_REMOTE_WORKSPACE_ROOTS: files, CODEX_REMOTE_FILE_ROOTS: files, CODEX_REMOTE_CONTEXT_VAULT: vault, CODEX_REMOTE_SESSION_STATE: join(root, 'sessions.json'), CODEX_REMOTE_SECURE_API: 'required', CODEX_REMOTE_SECURE_KEY_FILE: key }
  await writeFile(join(main, '.env'), Object.entries(env).map(([k,v]) => `${k}=${v}`).join('\n')+'\n', { mode: 0o600 })
  await symlink('/root/WORKTREES/cr-secure-api-review-fixes/dist-server',join(main,'dist-server'))
  await writeFile(join(main,'source-revision'), SOURCE)
  await symlink(join(reviewed, 'operator'), join(release, 'operator'))
  const meta = { app: APP, sourceTarget: SOURCE, main, keyFile: key, fileRoots: [files], requiredEncryption: true, activationEligible: true }
  await writeFile(join(release, 'metadata.json'), JSON.stringify(meta))
  await writeFile(join(release, 'seal.json'), JSON.stringify({ app: APP, files: tree(release) }))
  const baseline = JSON.parse(await readFile(join(reviewed, 'baseline.json'), 'utf8'))
  assert.equal(fileHash('/root/RUNNING-SERVICES/codex-remote/dist-server/http-app.js'), baseline.backend['http-app.js'].sha256)
  const { createSession } = await import('/root/RUNNING-SERVICES/codex-remote/dist-server/auth.js')
  const { assertKeyLocation } = await import(join(reviewed, 'operator/dist-server/secure-key.js'))
  const session = createSession(env.CODEX_REMOTE_SESSION_SECRET, 60), cookie = `codex_remote_session=${session.token}`
  const spawnGateway = async mode => {
    const child = fork(gatewayScript, [mode, root], { stdio: ['ignore','ignore','ignore','ipc'] }); children.add(child)
    await once(child, 'message', { signal: AbortSignal.timeout(15000) }); return child
  }
  let old = await spawnGateway('old'), active = old
  const oldIdentity = { pid: old.pid, start: processStart(old.pid), cgroup: '/fixture-owned-old' }
  const policy = { Type: 'simple', KillMode: 'control-group', SendSIGKILL: 'yes', TriggeredBy: '' }
  const state = extra => atomicBytes(join(root, 'service-state.json'), JSON.stringify({ ...policy, ActiveState: active ? 'active' : 'inactive', SubState: active ? 'running' : 'dead', MainPID: String(active?.pid ?? 0), ControlPID: '0', ControlGroup: oldIdentity.cgroup, fixtureCgroupEmpty: !active, ...extra }), 0o600)
  state()
  const now = new Date().toISOString(), evidence = { fixture: { at: now, files: [] } }
  let runner
  if (separateRunner) {
    runner = spawn(process.execPath, ['-e', 'process.send({ready:true});setInterval(()=>{},1000)'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    children.add(runner); await once(runner, 'message', { signal: AbortSignal.timeout(5000) })
  }
  const runnerPid = runner?.pid ?? process.pid
  await writeFile(join(outside, 'evidence.json'), JSON.stringify(evidence)); await writeFile(join(outside, 'authorization.json'), JSON.stringify({ at: now }))
  await writeFile(join(outside, 'attempt.json'), JSON.stringify({ status: 'running', phase: 'old-watcher-restart' }))
  await writeFile(join(root, 'lock/owner.json'), JSON.stringify({ release, pid: runnerPid }))
  const permit = { app: APP, release, seal: fileHash(join(release, 'seal.json')), runner: { pid: runnerPid, start: processStart(runnerPid) }, old: oldIdentity, lock: join(root, 'lock'), port, servicePolicy: servicePolicy(policy), receipts: receiptBinding(outside, evidence), provision: provisionPlan(meta, assertKeyLocation), destinations: destinationSnapshot([join(main, '.env')]), backend: tree(join(main, 'dist-server')), dependencies: {}, stable: {} }
  await writeFile(join(outside, 'key-cutover-permit.json'), JSON.stringify(permit))
  const get = () => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/api/files/content?' + new URLSearchParams({ path: key }), agent, headers: { Cookie: cookie } }, res => { let bytes = 0; res.on('data', chunk => { bytes += chunk.length }); res.on('end', () => resolve({ status: res.statusCode, bytes })) }); req.on('error', reject); req.end()
  })
  const upgrade = async () => { const socket = connect({ host:'127.0.0.1',port }); sockets.add(socket); await once(socket, 'connect'); socket.write('GET /fixture-upgrade HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\n'); await once(socket,'data'); return socket }
  async function stop() { const exited = once(active, 'exit'); active.kill('SIGTERM'); await exited; active = null; state() }
  async function start() { active = await spawnGateway('new'); state() }
  const drive = async hook => {
    const child = fork(driverScript, [root], { stdio:['ignore','ignore','ignore','ipc'] }); children.add(child); const exited = once(child, 'exit'); let hookError
    child.on('message', async message => {
      try {
        const outcome = await hook?.(message, child)
        if (outcome === 'hold') return
        if (message.action === 'stop') await stop()
        if (message.action === 'start') await start()
        if (child.connected) child.send({ id: message.id })
      } catch(error) { if (error.fixtureFault) { if(child.connected) child.send({ id: message.id, error: error.message }) } else { hookError=error; child.kill('SIGKILL') } }
    })
    const result = await Promise.race([exited, new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('owned-driver-timeout')),30000); timer.unref()})])
    if (hookError) throw hookError
    return result
  }
  const cli = (name,args=[]) => run(process.execPath,[join(reviewed,'operator/scripts',name),...args],{cwd:root,env,timeout:15000})
  return { root,main,release,outside,key,oldIdentity,state,get,upgrade,drive,stop,start,cli,env, runner, alive: () => processStart(oldIdentity.pid) === oldIdentity.start }
}
const fault = message => Object.assign(Error(message), { fixtureFault: true })
test('R5: actual legacy Files sees no key during wait; stop closes keepalive/upgraded connections before key init; required CLI succeeds', async t => {
  const f = await fixture(t)
  for (let n=0;n<3;n++) { assert.equal((await f.get()).status,404); assert(!existsSync(f.key)) }
  const socket = await f.upgrade(); let upgradedClosed=false; socket.once('close',()=>{upgradedClosed=true})
  const [code] = await f.drive(async message => {
    if (message.phase === 'pre-stop' || message.phase === 'stopping-old') { assert(!existsSync(f.key)); assert.equal((await f.get()).status,404) }
    if (message.phase === 'generate-owner-key') { assert(!f.alive()); assert(!existsSync(f.key)); await assert.rejects(f.get()) }
    if (message.phase === 'bind-owner-key') { assert(!f.alive()); assert(existsSync(f.key)); await assert.rejects(f.get()) }
  })
  assert.equal(code,0); assert(upgradedClosed)
  const before=fileHash(f.key), receipt=JSON.parse(await readFile(join(f.outside,'key-binding.json'),'utf8')); assert.equal(receipt.oldGone,true); assert(receipt.key.digest)
  const denied=await f.get(); assert([401,403].includes(denied.status))
  const note=join(f.root,'note.md'); await writeFile(note,'FAKE CUTOVER KNOWLEDGE')
  const written=JSON.parse((await f.cli('knowledge.mjs',['write','--path','References/R5.md','--file',note,'--revision','','--actor','fixture'])).stdout)
  assert.equal(JSON.parse((await f.cli('knowledge.mjs',['read','--path','References/R5.md'])).stdout).revision,written.revision)
  assert(Array.isArray(JSON.parse((await f.cli('services.mjs',['list'])).stdout).services))
  await f.stop(); await f.start(); assert.equal(fileHash(f.key),before)
  assert(Array.isArray(JSON.parse((await f.cli('services.mjs',['list'])).stdout).services))
  assert.equal((await f.drive())[0],1,'one-use cutover cannot repeat or rotate key'); assert.equal(fileHash(f.key),before)
})
for (const phase of ['pre-stop','generate-owner-key','bind-owner-key','before-start']) test('R5: owned SIGKILL at '+phase+' cannot expose a reusable key through old HTTP',async t=>{
  const f=await fixture(t)
  const [,signal]=await f.drive((message,child)=>{if(message.phase===phase){child.kill('SIGKILL');return 'hold'}})
  assert.equal(signal,'SIGKILL')
  const state=JSON.parse(await readFile(join(f.outside,'key-cutover-state.json'),'utf8')); assert.equal(state.phase,phase)
  if(f.alive()){assert(!existsSync(f.key));assert.equal((await f.get()).status,404)}else await assert.rejects(f.get())
  if(existsSync(f.key)){assert(!f.alive());const before=fileHash(f.key);assert.equal((await f.drive())[0],1);assert.equal(fileHash(f.key),before)}
})
for(const failure of ['stop-fails','cgroup-survives','required-config-drift','key-tampered','expired-after-stop','start-fails','key-rotated','key-removed','after-await-config-drift','after-await-start-drift']) test('R5: '+failure+' fails closed and retains phase',async t=>{
  const f=await fixture(t)
  const [code]=await f.drive(async message=>{
    if(message.status==='failed')return
    if(failure==='after-await-config-drift'&&message.probe==='listener'&&message.phase==='generate-owner-key')await writeFile(join(f.main,'.env'),'CODEX_REMOTE_SECURE_API=off\n')
    if(failure==='after-await-start-drift'&&message.probe==='listener'&&message.phase==='start-required')await writeFile(join(f.main,'.env'),'CODEX_REMOTE_SECURE_API=off\n')
    if(failure==='stop-fails'&&message.action==='stop')throw fault('fixture-stop-failed')
    if(failure==='start-fails'&&message.action==='start')throw fault('fixture-start-failed')
    if(failure==='cgroup-survives'&&message.phase==='prove-old-gone')f.state({fixtureCgroupEmpty:false})
    if(failure==='required-config-drift'&&message.phase==='pre-provision')await writeFile(join(f.main,'.env'),'CODEX_REMOTE_SECURE_API=off\n')
    if(failure==='key-tampered'&&message.phase==='before-start')await chmod(f.key,0o644)
    if(failure==='key-rotated'&&message.phase==='before-start')await f.cli('secure-key.mjs',['rotate',f.key])
    if(failure==='key-removed'&&message.phase==='before-start')await unlink(f.key)
    if(failure==='expired-after-stop'&&message.phase==='pre-provision')await writeFile(join(f.outside,'authorization.json'),JSON.stringify({at:'2020-01-01T00:00:00Z'}))
  })
  assert.equal(code,1);assert.equal(JSON.parse(await readFile(join(f.outside,'key-cutover-state.json'),'utf8')).status,'failed')
  if(f.alive()){assert(!existsSync(f.key));assert.equal((await f.get()).status,404)}else await assert.rejects(f.get())
  if(!['key-tampered','start-fails','key-rotated','after-await-start-drift'].includes(failure))assert(!existsSync(f.key))
})

test('R5: graceful termination at generated-key boundary retains phase and never revives old gateway', async t => {
  const f=await fixture(t)
  const [,signal]=await f.drive((message,child)=>{if(message.phase==='before-start'){child.kill('SIGTERM');return 'hold'}})
  assert.equal(signal,'SIGTERM');assert(!f.alive());assert(existsSync(f.key));await assert.rejects(f.get())
  assert.equal(JSON.parse(await readFile(join(f.outside,'key-cutover-state.json'),'utf8')).phase,'before-start')
})

test('R5: unexpected existing key destination blocks before stop; never silently adopts/deletes/rotates it',async t=>{
  const f=await fixture(t);await mkdir(join(f.root,'private'),{mode:0o700});await writeFile(f.key,'non-secret-invalid-existing-placeholder',{mode:0o600})
  const before=fileHash(f.key);assert.equal((await f.drive())[0],1);assert(f.alive());assert.equal(fileHash(f.key),before)
  assert.equal(JSON.parse(await readFile(join(f.outside,'key-cutover-state.json'),'utf8')).phase,'pre-stop')
})

for (const boundary of ['pre-stop', 'generate-owner-key', 'start-required']) test('CR2: actual runner death at ' + boundary + ' prevents the next service/key effect', async t => {
  const f = await fixture(t, { separateRunner: true }); let killed = false, starts = 0
  const [code] = await f.drive(async message => {
    if (message.action === 'start') starts++
    if (!killed && message.phase === boundary && (boundary === 'pre-stop' || message.probe === 'listener')) {
      const exited = once(f.runner, 'exit'); f.runner.kill('SIGKILL'); await exited; killed = true
    }
  })
  assert(killed); assert.equal(code, 1); assert.equal(starts, 0)
  const state = JSON.parse(await readFile(join(f.outside, 'key-cutover-state.json'), 'utf8'))
  assert.equal(state.reason, 'cutover-runner-not-alive')
  if (boundary === 'pre-stop') { assert(f.alive()); assert(!existsSync(f.key)); assert.equal((await f.get()).status, 404) }
  else { assert(!f.alive()); await assert.rejects(f.get()); assert.equal(existsSync(f.key), boundary === 'start-required') }
})

test('CR2: withdrawing parent phase during final listener await prevents start', async t => {
  const f = await fixture(t); let changed = false, starts = 0
  const [code] = await f.drive(async message => {
    if (message.action === 'start') starts++
    if (!changed && message.phase === 'start-required' && message.probe === 'listener') {
      await writeFile(join(f.outside, 'attempt.json'), JSON.stringify({ status: 'failed', phase: 'old-watcher-restart' })); changed = true
    }
  })
  assert(changed); assert.equal(code, 1); assert.equal(starts, 0); assert(existsSync(f.key)); assert(!f.alive()); await assert.rejects(f.get())
  assert.equal(JSON.parse(await readFile(join(f.outside, 'key-cutover-state.json'), 'utf8')).reason, 'cutover-parent-phase-invalid')
})

// Inverse finding probe: green means a replacement key was silently adopted, not acceptance.
test('CR2 inverse: key replaced after init but before binding is adopted without a drift rejection', async t => {
  const f = await fixture(t); let generatedHash, replacementHash
  const [code] = await f.drive(async message => {
    if (message.phase === 'bind-owner-key' && message.status === 'running') {
      generatedHash = fileHash(f.key)
      await f.cli('secure-key.mjs', ['rotate', f.key])
      replacementHash = fileHash(f.key); assert.notEqual(replacementHash, generatedHash)
    }
  })
  assert.equal(code, 0)
  const binding = JSON.parse(await readFile(join(f.outside, 'key-binding.json'), 'utf8'))
  assert.equal(binding.key.metadata.sha256, replacementHash)
  assert.notEqual(binding.key.metadata.sha256, generatedHash)
  assert(!f.alive()); assert([401, 403].includes((await f.get()).status))
})
