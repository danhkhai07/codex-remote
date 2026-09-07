import { createInterface } from 'node:readline'

const lines = createInterface({ input: process.stdin })

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

lines.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    send({ id: message.id, result: { userAgent: 'fake-codex' } })
    return
  }
  if (message.method === 'thread/list') {
    send({ id: message.id, result: { data: [], nextCursor: null } })
    send({ method: 'warning', params: { message: 'fixture notification' } })
    return
  }
  if (message.method === 'thread/start') {
    send({ id: message.id, result: { thread: { id: 'thr_fixture', cwd: message.params.cwd } } })
    send({
      method: 'item/commandExecution/requestApproval',
      id: 'approval_fixture',
      params: {
        kind: 'command',
        threadId: 'thr_fixture',
        turnId: 'turn_fixture',
        itemId: 'item_fixture',
        startedAtMs: Date.now(),
        environmentId: null,
        command: 'echo fixture',
        cwd: message.params.cwd,
      },
    })
    return
  }
  if (message.id !== undefined && message.method === undefined) {
    send({ method: 'serverRequest/resolved', params: { requestId: message.id } })
    return
  }
  if (message.id !== undefined) send({ id: message.id, result: {} })
})
