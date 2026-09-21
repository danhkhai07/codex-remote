import { assert } from './common.mjs'
/** The same transition machine runs against real systemd and owned fixture processes. */
export async function executeKeyCutover(ops) {
  let phase = 'pre-stop', binding
  const save = (status, extra = {}) => ops.state({ status, phase, ...(binding ? { binding } : {}), ...extra })
  const step = async (name, action) => { phase = name; await save('running'); return action() }
  await ops.claim() // Exclusive one-use attempt; never resume an unknown prior effect.
  try {
    await step('pre-stop', () => ops.preStop())
    await step('stopping-old', () => ops.stop())
    await step('prove-old-gone', () => ops.isolated())
    await step('pre-provision', () => ops.preProvision())
    await step('generate-owner-key', () => ops.init())
    binding = await step('bind-owner-key', () => ops.bind())
    await step('before-start', () => ops.beforeStart())
    await step('start-required', () => ops.start())
    await save('started') // Not deployment complete; watcher/runner must prove new API.
  } catch (error) { await save('failed', { reason: error.message }); throw error }
}
export async function main(args, release) {
  assert(args.length === 2 && args[0] === 'restart' && args[1] === 'codex-remote.service', 'cutover-only-accepts-gateway-restart')
  const { cutoverOps } = await import('./cutover-ops.mjs')
  await executeKeyCutover(await cutoverOps(release))
}
