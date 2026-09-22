// New service only. Validate required mode and independent paths BEFORE native startup.
// This does not replace the independently checked legacy Files/key exposure boundary.
import assert from 'node:assert/strict'
import { realpathSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { loadConfig } from '../../dist-server/config.js'
import { readOwnerKey } from '../../dist-server/secure-key.js'
const root = '/root/.local/state/codex-remote-secure'
const config = loadConfig()
const expected = {
  CODEX_HOME: root + '/native', CODEX_SQLITE_HOME: root + '/native',
  CODEX_REMOTE_CONTEXT_VAULT: root + '/vault',
  CODEX_REMOTE_SESSION_STATE: root + '/sessions.json',
  CODEX_REMOTE_READ_STATE_FILE: root + '/read-state.json',
  CODEX_REMOTE_PUSH_STATE: root + '/push.json',
  CODEX_REMOTE_SERVICES_FILE: root + '/services.json',
  CODEX_REMOTE_WORK_HOURS_FILE: root + '/hours/working-hours-state.json',
  CODEX_REMOTE_SECURE_KEY_FILE: root + '/secure-owner/owner-key.json',
  TMPDIR: root + '/tmp',
}
assert.equal(config.publicOrigin.origin, 'https://remote.danhkhai.io.vn')
assert.equal(config.host, '127.0.0.1'); assert.equal(config.port, 5174)
assert.equal(process.env.CODEX_REMOTE_SECURE_API, 'required')
assert.equal(config.secureApiRequired, true)
for (const [name, value] of Object.entries(expected)) assert.equal(process.env[name], value, 'Independent state path required: ' + name)
for (const path of [root, expected.CODEX_HOME, config.contextVaultPath, expected.TMPDIR]) {
  assert.equal(realpathSync(path), path, 'No state aliases/symlinks')
  const st = statSync(path); assert(st.isDirectory()); assert.equal(st.uid, process.getuid()); assert.equal(st.mode & 0o077, 0)
}
// TOML sqlite_home takes precedence over CODEX_SQLITE_HOME. No config content
// or child stderr is printed when parsing fails.
try {
  execFileSync('python3', ['-c', 'import pathlib,sys,tomllib; p=pathlib.Path(sys.argv[1]); a=tomllib.loads((p/"config.toml").read_text()); assert pathlib.Path(a.get("sqlite_home",str(p))).resolve()==p', expected.CODEX_HOME], { stdio: 'ignore', timeout: 5000 })
} catch { throw Error('Native sqlite_home is invalid or points outside the independent home') }
assert(config.password && !config.password.startsWith('REPLACE_'))
assert(config.sessionSecret && !config.sessionSecret.startsWith('REPLACE_'))
readOwnerKey(config.secureKeyFile, [...config.fileRoots, config.contextVaultPath])
console.log('New-instance required mode, independent paths and private key format validated.')
