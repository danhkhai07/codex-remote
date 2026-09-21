// Test-only stdio RPC process. No model, tools, filesystem effects or environment reads.
import { createInterface } from 'node:readline'
const send = value => process.stdout.write(JSON.stringify(value) + '\n')
const effects = []
let initialize
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') { initialize = message.id; send({ method: 'fixture/initializing', params: {} }); return }
  if (message.method === 'fixture/release') { send({ id: initialize, result: {} }); return }
  if (message.method === 'fixture/effects') { send({ id: message.id, result: effects }); return }
  if (message.method === 'thread/start') { effects.push(message.method); send({ id: message.id, result: { thread: { id: 'FAKE-ONLY', cwd: message.params.cwd, turns: [] } } }); return }
  if (message.id !== undefined) send({ id: message.id, result: {} })
})
