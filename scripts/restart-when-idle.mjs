import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createSession } from '../dist-server/auth.js'
import { loadConfig } from '../dist-server/config.js'
import { restartReadiness } from './restart-readiness.mjs'

// One restart per invocation. Run in a separate systemd unit so gateway shutdown
// does not terminate the watcher before it verifies the new process.
const config = loadConfig()
const base = `http://${config.host}:${config.port}`
const stateDirectory = join(homedir(), '.local/state/codex-remote')
mkdirSync(stateDirectory, { recursive: true })
const state = (status, details = {}) => writeFileSync(join(stateDirectory, 'restart-when-idle.json'), JSON.stringify({ status, at: new Date().toISOString(), ...details }, null, 2) + '\n')
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function readiness() {
  const session = createSession(config.sessionSecret, 300)
  return restartReadiness(async path => {
    const response = await fetch(`${base}${path}`, {
      headers: { Cookie: `codex_remote_session=${session.token}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw Error(`Idle status returned HTTP ${response.status}`)
    return response.json()
  })
}

if (process.argv.includes('--check')) {
  console.log(JSON.stringify(await readiness()))
} else {
  state('waiting-for-idle')
  try {
    while (true) {
      try {
        const first = await readiness()
        state('waiting-for-idle', first)
        if (first.ready) {
          await sleep(5000)
          if ((await readiness()).ready) break
        }
      } catch (error) { state('waiting-for-idle', { reason: String(error) }) }
      await sleep(10_000)
    }
    state('restarting')
    execFileSync('systemctl', ['restart', 'codex-remote.service'], { timeout: 40_000 })
    let healthy = false
    for (let attempt = 0; attempt < 30; attempt++) {
      await sleep(1000)
      try {
        if ((await fetch(`${base}/api/healthz`, { signal: AbortSignal.timeout(2000) })).ok) { healthy = true; break }
      } catch { /* Wait for the replacement gateway to start listening. */ }
    }
    if (!healthy) throw Error('Gateway failed health check after restart')
    state('complete', { healthy: true })
    console.log('Restarted Codex Remote after all listed turns finished; health check passed.')
  } catch (error) {
    state('failed', { error: String(error) })
    console.error(String(error))
    process.exitCode = 1
  }
}
