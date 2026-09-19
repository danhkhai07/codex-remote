import { parseArgs } from 'node:util'
import { createSession } from '../dist-server/auth.js'
import { loadConfig } from '../dist-server/config.js'

const { values, positionals } = parseArgs({ allowPositionals: true, options: Object.fromEntries(
  ['port', 'name', 'summary', 'pr', 'pr-url', 'branch', 'directory', 'path', 'kind', 'key'].map(name => [name, { type: 'string' }]),
) })
const command = positionals[0] ?? 'list'
if (!['list', 'register', 'remove'].includes(command)) throw Error('Use list, register or remove')
const config = loadConfig()
const session = createSession(config.sessionSecret, 300)
const headers = { Cookie: `codex_remote_session=${session.token}`, Origin: config.publicOrigin.origin, 'X-CSRF-Token': session.payload.csrf, 'Content-Type': 'application/json' }
let method = 'GET', path = '/api/services', body
if (command === 'register') {
  method = 'PUT'
  if (!values.port && !values.path) throw Error('Provide --port for localhost or --path for a Codex Remote page')
  body = JSON.stringify({ port: values.port ? Number(values.port) : null, path: values.path ?? '/', name: values.name,
    summary: values.summary, prLabel: values.pr, prUrl: values['pr-url'] ?? '', branch: values.branch ?? '',
    directory: values.directory ?? '', kind: values.kind ?? 'app' })
}
if (command === 'remove') {
  if (!values.key) throw Error('Provide --key port:5183 or --key path:/example')
  method = 'DELETE'; path += `?${new URLSearchParams({ key: values.key })}`
}
const response = await fetch(`http://${config.host}:${config.port}${path}`, { method, headers, ...(body ? { body } : {}), signal: AbortSignal.timeout(10_000) })
const result = await response.json()
if (!response.ok) throw Error(result.error ?? `HTTP ${response.status}`)
console.log(JSON.stringify(result, null, 2))
