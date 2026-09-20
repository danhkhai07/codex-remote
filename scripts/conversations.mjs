import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { request } from 'node:http'
import { parseArgs } from 'node:util'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

// The current leader receives an expiring capability in its private turn context.
// This CLI deliberately does not load .env, impersonate a user session, or choose an actor ID.
const { values } = parseArgs({ options: { socket: { type: 'string' }, mailbox: { type: 'string' }, capability: { type: 'string' }, file: { type: 'string' } } })
if (!values.socket || !values.capability || !values.file) throw Error('Use --socket, --capability and --file from the current leader context')
const body = readFileSync(values.file)
if (body.length > 128 * 1024) throw Error('Command is too large')
JSON.parse(body.toString('utf8'))
async function socketCommand() { return new Promise((resolve, reject) => {
  const req = request({ socketPath: values.socket, path: '/command', method: 'POST', headers: {
    Authorization: `Bearer ${values.capability}`, 'Content-Type': 'application/json', 'Content-Length': body.length,
  } }, res => {
    const chunks = []
    res.on('data', chunk => chunks.push(chunk))
    res.on('end', () => {
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (res.statusCode !== 200) reject(Error(`HTTP ${res.statusCode}: ${value.error ?? 'Command failed'}`))
        else resolve(value)
      } catch (error) { reject(error) }
    })
  })
  req.setTimeout(90_000, () => req.destroy(Error('Command timed out. Check status; reuse the same requestId when retrying.')))
  req.on('error', reject)
  req.end(body)
}) }
async function mailboxCommand() {
  const id = randomUUID(), requestPath = join(values.mailbox, `${id}.request.json`), temporary = `${requestPath}.tmp`, responsePath = join(values.mailbox, `${id}.response.json`)
  writeFileSync(temporary, JSON.stringify({ capability: values.capability, command: JSON.parse(body.toString('utf8')) }), { flag: 'wx', mode: 0o600 })
  renameSync(temporary, requestPath)
  const deadline = Date.now() + 90_000
  try {
    while (Date.now() < deadline) {
      let response
      try { response = JSON.parse(readFileSync(responsePath, 'utf8')) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      if (response) {
        if (response.status !== 200) throw Error(`HTTP ${response.status}: ${response.body.error ?? 'Command failed'}`)
        return response.body
      }
      await delay(100)
    }
    throw Error('Command timed out. Check status; reuse the same requestId when retrying.')
  } finally {
    for (const path of [requestPath, responsePath]) { try { unlinkSync(path) } catch { /* The backend may already have claimed this request. */ } }
  }
}
let result
try { result = await socketCommand() }
catch (error) {
  // Fall back only when connection was refused before sending anything. Never replay an ambiguous send.
  if (values.mailbox && ['EPERM', 'EACCES', 'ECONNREFUSED', 'ENOENT'].includes(error.code)) result = await mailboxCommand()
  else throw error
}
console.log(JSON.stringify(result, null, 2))
