// Owned fixture only: never let root Nginx initialize compiled host paths.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, chown, writeFile, stat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)
export const tempPaths = ['client_body_temp_path', 'proxy_temp_path', 'fastcgi_temp_path', 'uwsgi_temp_path', 'scgi_temp_path']
export async function hostNginxIdentity() {
  const paths = await Promise.all(['/var/lib/nginx', ...['body', 'proxy', 'fastcgi', 'uwsgi', 'scgi'].map(name => '/var/lib/nginx/' + name)].map(async path => {
    try { const value = await stat(path); return { path, uid: value.uid, gid: value.gid, mode: value.mode, ino: value.ino } }
    catch (error) { if (error.code === 'ENOENT') return { path, missing: true }; throw error }
  }))
  const service = await exec('systemctl', ['show', 'nginx.service', '-p', 'MainPID', '-p', 'InvocationID', '-p', 'ExecMainStartTimestampMonotonic'])
  const processes = await exec('ps', ['-C', 'nginx', '-o', 'pid=,ppid=,uid=,gid=,args=']).catch(error => { if (error.code === 1) return { stdout: '' }; throw error })
  return { paths, service: service.stdout, processes: processes.stdout }
}
export async function startNginxFixture(httpConfig, binary = '/usr/sbin/nginx') {
  const root = await mkdtemp(join(tmpdir(), 'codex-nginx-fixture-'))
  const uid = 65534, gid = 65534, unit = 'codex-nginx-fixture-' + randomUUID()
  let started = false, process
  const close = async () => {
    if (started) {
      await exec('systemctl', ['stop', unit]).catch(error => { if (!String(error.stderr).includes('not loaded')) throw error })
      await process?.done
    }
    await rm(root, { recursive: true, force: true })
  }
  try {
    await chown(root, uid, gid) // Only the newly created fixture directory, never host paths.
    for (const name of tempPaths) { const path = join(root, name); await mkdir(path, { mode: 0o700 }); await chown(path, uid, gid) }
    const config = join(root, 'nginx.conf')
    await writeFile(config, `daemon off; master_process off; pid ${root}/nginx.pid; lock_file ${root}/nginx.lock; error_log ${root}/error.log error;
events { worker_connections 64; }
http { access_log ${root}/access.log; ${tempPaths.map(name => `${name} ${root}/${name};`).join('\n')}
${httpConfig}
}`)
    await chown(config, uid, gid)
    const args = ['--quiet', '--wait', '--pipe', '--collect', '-p', 'User=nobody', '-p', 'Group=nogroup', '-p', 'ProtectSystem=strict', '-p', 'ProtectHome=yes', '-p', `ReadWritePaths=${root}`, '-p', 'InaccessiblePaths=-/var/lib/nginx -/var/log/nginx -/etc/nginx', '-p', 'NoNewPrivileges=yes', '-p', 'CapabilityBoundingSet=', '-p', 'RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX', '-p', 'IPAddressDeny=any', '-p', 'IPAddressAllow=localhost', '-p', 'MemoryMax=128M', '-p', 'MemorySwapMax=0', '-p', 'TasksMax=32', '-p', 'RuntimeMaxSec=180', '-p', 'TimeoutStopSec=3', '-p', `WorkingDirectory=${root}`]
    const nginxArgs = ['-e', 'stderr', '-p', root, '-c', config]
    // Syntax initialization runs with exactly the same non-root/fs restrictions.
    await exec('systemd-run', [...args, '--unit', unit + '-syntax', binary, '-t', ...nginxArgs], { timeout: 15000 })
    const child = spawn('systemd-run', [...args, '--unit', unit, binary, ...nginxArgs], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-4096) })
    const done = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve) })
    process = { done }; started = true
    return { close, async assertIdentity() {
      const { stdout } = await exec('systemctl', ['show', unit, '-p', 'User', '-p', 'Group', '-p', 'ProtectSystem', '-p', 'MainPID'])
      assert.match(stdout, /^User=nobody$/m); assert.match(stdout, /^Group=nogroup$/m); assert.match(stdout, /^ProtectSystem=strict$/m)
      assert.equal(child.exitCode, null, stderr)
    } }
  } catch (error) { await close(); throw error }
}
