import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { createSession } from '../dist-server/auth.js'
import { maintenanceCookie } from './session-cookie.mjs'
import { loadConfig } from '../dist-server/config.js'

const { values, positionals } = parseArgs({ allowPositionals: true, options: Object.fromEntries(
  ['path', 'file', 'revision', 'actor', 'id', 'thread', 'text'].map(name => [name, { type: 'string' }]),
) })
const command = positionals[0] ?? 'list'
const routes = { list: '', read: '/note', write: '/note', versions: '/versions', version: '/version', restore: '/restore', traces: '/traces', preview: '/preview' }
if (!(command in routes)) throw Error('Use list, read, write, versions, version, restore, traces or preview')
const query = new URLSearchParams()
if (values.path) query.set('path', values.path)
if (values.id) query.set('id', values.id)
if (values.thread) query.set('threadId', values.thread)
let method = 'GET', body
if (command === 'write') {
  if (!values.path || !values.file || values.revision === undefined) throw Error('write requires --path, --file and --revision (empty for a new note)')
  method = 'PUT'; body = { path: values.path, content: readFileSync(values.file, 'utf8'), revision: values.revision, actor: values.actor ?? 'agent' }
}
if (command === 'restore') {
  if (!values.path || !values.id || values.revision === undefined) throw Error('restore requires --path, --id and --revision')
  method = 'POST'; body = { path: values.path, versionId: values.id, revision: values.revision, actor: values.actor ?? 'agent' }
}
if (command === 'preview') {
  if (!values.thread || values.text === undefined) throw Error('preview requires --thread and --text')
  method = 'POST'; body = { threadId: values.thread, text: values.text }
}
const config = loadConfig(), session = createSession(config.sessionSecret, 300, config.password)
const response = await fetch(`http://${config.host}:${config.port}/api/knowledge${routes[command]}?${query}`, {
  method, headers: { Cookie: maintenanceCookie(session.token, config.publicOrigin.protocol === 'https:'), Origin: config.publicOrigin.origin, 'X-CSRF-Token': session.payload.csrf, 'Content-Type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000),
})
const result = await response.json()
if (!response.ok) throw Error(`HTTP ${response.status}: ${result.error ?? 'Knowledge request failed'}`)
console.log(JSON.stringify(result, null, 2))
