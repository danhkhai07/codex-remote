// Fixture owns process controls; uses the actual cutover adapter and disk guards.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { executeKeyCutover } from '../key-cutover.mjs'
import { cutoverOps, listenerClosed } from '../cutover-ops.mjs'
import { SOURCE, assert } from '../common.mjs'
import { processStart } from '../key-state.mjs'
const [root] = process.argv.slice(2), release = join(root, 'release')
const state = () => JSON.parse(readFileSync(join(root, 'service-state.json'), 'utf8'))
let serial = 0, phase
const rpc = value => new Promise((resolve, reject) => {
  const id = ++serial, listener = message => { if (message.id === id) { process.off('message', listener); if (message.error) reject(Error(message.error)); else resolve() } }
  process.on('message', listener); process.send({ ...value, id })
})
const io = { properties: state, processStart, listenerClosed: async (...args) => { const closed=await listenerClosed(...args);await rpc({probe:'listener',phase});return closed },
  cgroupEmpty: () => state().fixtureCgroupEmpty,
  control: action => rpc({ action }), source: () => { assert(readFileSync(join(root,'main/source-revision'),'utf8')===SOURCE,'fixture-source-drift') },
}
const ops = await cutoverOps(release, io), write = ops.state
ops.state = async value => { phase=value.phase;await write(value); await rpc({ phase: value.phase, status: value.status }) }
await executeKeyCutover(ops).catch(() => { process.exitCode = 1 })
process.disconnect()
