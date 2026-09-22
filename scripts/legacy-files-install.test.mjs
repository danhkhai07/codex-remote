import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseEnv } from 'node:util'
import { installAfterIdle, patchEnvironment, payloadNames } from './legacy-files-install.mjs'

test('environment transform preserves all other values and literal private strings', () => {
  const input = '# example\nCODEX_REMOTE_PASSWORD="FAKE $value with spaces"\nCODEX_REMOTE_SESSION_SECRET=FAKE-long-session-value\nCODEX_REMOTE_WORKSPACE_ROOTS=/root\nCODEX_REMOTE_FILE_ROOTS=/\nNODE_ENV=production\n'
  const result = patchEnvironment(input, ['/root/GITHUB', '/root/VAULTS'])
  assert.equal(result.replace('CODEX_REMOTE_FILE_ROOTS=/root/GITHUB,/root/VAULTS', 'CODEX_REMOTE_FILE_ROOTS=/'), input)
  assert.equal(parseEnv(result).CODEX_REMOTE_WORKSPACE_ROOTS, '/root')
  assert(!result.includes('SECURE_API'))
})
test('environment transform rejects duplicate assignments and unsafe root syntax', () => {
  assert.throws(() => patchEnvironment('CODEX_REMOTE_FILE_ROOTS=/\nCODEX_REMOTE_FILE_ROOTS=/tmp\n', ['/root/GITHUB']))
  for (const roots of [['/'], ['/root'], [], ['/safe\nCODEX_REMOTE_PASSWORD=changed']]) assert.throws(() => patchEnvironment('', roots))
  assert.equal(patchEnvironment('VALUE=FAKE', ['/root/GITHUB']), 'VALUE=FAKE\nCODEX_REMOTE_FILE_ROOTS=/root/GITHUB\n')
})
function fixture(readiness, failure) {
  const trace = []; let calls = 0
  return { trace, ops: {
    phase: (phase, proof) => trace.push({ phase, ...(proof ? { proof } : {}) }),
    preflight: () => { trace.push('guard'); if (failure === 'guard' && ++calls === 2) throw Error('drift') },
    ready: async () => { const value = readiness.shift(); assert.equal(typeof value, 'boolean'); trace.push('ready:' + value); return { ready: value } },
    pause: async ms => trace.push('pause:' + ms),
    backup: () => { trace.push('backup'); if (failure === 'backup') throw Error('backup failed') },
    publish: () => { trace.push('publish'); if (failure === 'publish') throw Error('publication uncertain') },
    restart: async () => { trace.push('stock-watcher'); if (failure === 'restart') throw Error('watcher failed') },
    verify: async () => { trace.push('verify'); if (failure === 'verify') throw Error('verification failed'); return { freshPid: true } },
  } }
}
test('busy or pending work postpones all mutations; dual stable idle and final check precede publish', async () => {
  const f = fixture([false, true, false, true, true, false, true, true, true])
  await installAfterIdle(f.ops)
  const index = f.trace.indexOf('backup')
  assert.deepEqual(f.trace.slice(index - 4, index), ['guard', 'ready:true', 'guard', { phase: 'backup' }])
  assert.equal(f.trace.filter(value => value === 'publish').length, 1)
  assert.equal(f.trace.filter(value => value === 'stock-watcher').length, 1)
  assert.equal(f.trace.at(-1).phase, 'complete')
})
test('drift after idle and backup failures never copy files or invoke restart', async () => {
  for (const failure of ['guard', 'backup']) {
    const f = fixture([true, true, true], failure)
    await assert.rejects(installAfterIdle(f.ops)); assert(!f.trace.includes('publish')); assert(!f.trace.includes('stock-watcher'))
  }
})
test('publication failure preserves unknown outcome, never restarts or marks complete', async () => {
  const f = fixture([true, true, true], 'publish')
  await assert.rejects(installAfterIdle(f.ops)); assert(!f.trace.includes('stock-watcher')); assert(!f.trace.some(value => value.phase === 'complete'))
})
test('watcher or final verification failure cannot produce complete', async () => {
  for (const failure of ['restart', 'verify']) {
    const f = fixture([true, true, true], failure)
    await assert.rejects(installAfterIdle(f.ops)); assert(!f.trace.some(value => value.phase === 'complete'))
    assert.equal(f.trace.filter(value => value === 'publish').length, 1)
  }
})
test('payload allowlist includes only the six Files-related module/map pairs', () => {
  assert.equal(payloadNames.length, 12)
  for (const name of ['work-hours.js', 'controller.js', 'auth.js', 'localhost-preview.js']) assert(!payloadNames.includes(name))
})
