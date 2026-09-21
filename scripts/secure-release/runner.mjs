import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { assert, isIdle } from './common.mjs'
/** No rollback/resume: a failed attempt requires phase-specific operator review and a NEW seal. */
export async function execute(ops) {
  let phase = 'preflight', acquired = false
  let verifiedEvidence, unsubscribe
  const installed = []
  const step = async (name, action) => { phase = name; await ops.state({ status: 'running', phase, installed: [...installed] }); return action() }
  try {
    await ops.acquire(); acquired = true
    unsubscribe = ops.onTerminate?.(async () => {
      await ops.state({ status: 'failed', phase, installed: [...installed], reason: 'terminated', ...(verifiedEvidence ? { evidence: verifiedEvidence } : {}) })
    })
    await step('preflight', () => ops.preflight())
    const deadline = ops.now() + 12 * 60 * 60_000
    while (true) {
      assert(ops.now() < deadline, 'idle-deadline')
      await ops.drift()
      if (isIdle(await ops.oldReadiness())) {
        await ops.sleep(5000); await ops.drift()
        if (isIdle(await ops.oldReadiness())) break
      }
      await ops.sleep(10000)
    }
    // Public ingress closes before the final old-auth check. No new browser turns during copy.
    await step('private-backup', () => ops.backup())
    await step('gate-public-ingress', () => ops.gateIngress())
    await step('final-precopy-check', async () => {
      await ops.preCopy()
      assert(isIdle(await ops.oldReadiness()), 'became-busy-before-copy')
    })
    await step('stage-client-assets', () => ops.assets()) // Retains old hashes; index unchanged.
    await step('install-backend', async () => {
      for (const path of ops.modules) {
        await ops.install(path); installed.push(path)
        await ops.state({ status: 'running', phase, installed: [...installed] })
      }
      await ops.assertInstalled()
    })
    // Old runtime holds its imported modules. The OLD watcher rechecks dual ALL-idle,
    // authenticates with OLD auth/config, and performs exactly one restart itself.
    await step('activate-dependencies-config', () => ops.activateDependenciesConfig())
    await step('old-watcher-restart', () => ops.oldWatcherRestart())
    await step('verify-new-backend', () => ops.newBackend())
    await step('activate-workboard', () => ops.workboard())
    await step('publish-index-last', () => ops.index())
    await step('activate-ingress', () => ops.openIngress())
    const evidence = await step('postverify', () => ops.verify())
    verifiedEvidence = evidence
    await ops.state({ status: 'running', phase: 'postverify-complete', installed: [...installed], evidence })
    await step('bookkeeping', () => ops.bookkeeping(evidence))
    await ops.state({ status: 'complete', phase: 'complete', installed, evidence })
    return evidence
  } catch (error) {
    // No rollback, no automatic repeat of mutations, no clearing original evidence.
    if (acquired) await ops.state({ status: 'failed', phase, installed, reason: error.message, ...(verifiedEvidence ? { evidence: verifiedEvidence } : {}) })
    throw error
  } finally { unsubscribe?.(); if (acquired) await ops.release() }
}
export async function main(args) {
  assert(args.length === 1 && ['--check', '--apply'].includes(args[0]), 'usage: --check | --apply (separate signed-off activation record required)')
  const { productionOps } = await import('./production.mjs')
  const ops = productionOps(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
  if (args[0] === '--check') {
    const result = await ops.check(); console.log(JSON.stringify(result, null, 2)); if (result.blockers.length) process.exitCode = 2
  } else { await execute(ops); console.log('Publication verified; inspect private attempt evidence.') }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
