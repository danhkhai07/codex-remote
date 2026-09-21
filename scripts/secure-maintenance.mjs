import { SecureTransport } from '../dist-server/secure-client.js'
import { readOwnerKey } from '../dist-server/secure-key.js'
import { createSession } from '../dist-server/auth.js'
import { maintenanceCookie } from './session-cookie.mjs'
/** Same authenticated tunnel as the browser; never silently falls back in required mode. */
export async function maintenanceClient(config, issueSession = createSession) {
  const session = issueSession(config.sessionSecret, 300, config.password)
  const base = `http://${config.host}:${config.port}`
  const headers = { Cookie: maintenanceCookie(session.token, config.publicOrigin.protocol === 'https:'), Origin: config.publicOrigin.origin }
  const transport = new SecureTransport(fetch, base, headers)
  // npm maintenance commands need not inherit NODE_ENV from the systemd server.
  // Discovery can require encryption; it can never downgrade an explicit requirement.
  const setup = await transport.setup()
  const required = config.secureApiRequired || setup.required
  if (config.secureApiRequired && !setup.required) throw Error('Required secure API is unavailable; use a matching release')
  if (required) await transport.unlock(readOwnerKey(config.secureKeyFile, [...(config.fileRoots ?? config.workspaceRoots), ...(config.contextVaultPath ? [config.contextVaultPath] : [])]).key)
  return {
    async fetch(path, init = {}) {
      const privateHeaders = new Headers(init.headers)
      if (!['GET', 'HEAD'].includes(init.method ?? 'GET')) privateHeaders.set('X-CSRF-Token', session.payload.csrf)
      if (init.body && !privateHeaders.has('Content-Type')) privateHeaders.set('Content-Type', 'application/json')
      if (required) return (await transport.request(path, { ...init, headers: privateHeaders })).response
      return fetch(base + path, { ...init, headers: { ...headers, ...Object.fromEntries(privateHeaders.entries()) } })
    },
    close() { transport.lock() },
  }
}
