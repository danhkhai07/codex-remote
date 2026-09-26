import { fileAccessMode, validFileRoot, type FileAccess } from './file-policy.js'
import { isIP } from 'node:net'
import { validatePreviewOriginTemplate } from './localhost-preview.js'
import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { homedir } from 'node:os'

export type RemoteConfig = {
  host: string
  port: number
  publicOrigin: URL
  password: string
  sessionSecret: string
  sessionTtlSeconds: number
  codexBin: string
  workspaceRoots: string[]
  fileRoots?: string[]
  fileAccess?: FileAccess
  secureApiRequired?: boolean
  secureKeyFile?: string
  sessionStateFile?: string
  trustedProxies?: string[]
  previewOriginTemplate?: string
  previewSharePorts?: number[]
  previewShareStateFile?: string
  historyNativeHome?: string
  historyIndexPath?: string
  contextVaultPath?: string
  production: boolean
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? '5173')
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('CODEX_REMOTE_PORT must be an integer between 1 and 65535')
  }
  return port
}

function parseTtl(value: string | undefined): number {
  const ttl = Number(value ?? '604800')
  if (!Number.isInteger(ttl) || ttl < 300 || ttl > 2_592_000) {
    throw new Error('CODEX_REMOTE_SESSION_TTL_SECONDS must be between 300 and 2592000')
  }
  return ttl
}

function parseWorkspaceRoots(raw: string): string[] {
  const roots = raw.split(',').map((entry) => entry.trim()).filter(Boolean)
  if (roots.length === 0) throw new Error('At least one workspace root is required')

  return [...new Set(roots.map((entry) => {
    if (!isAbsolute(entry)) throw new Error(`Workspace root must be absolute: ${entry}`)
    const canonical = realpathSync(resolve(entry))
    if (!statSync(canonical).isDirectory()) throw new Error(`Workspace root is not a directory: ${entry}`)
    return canonical
  }))]
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RemoteConfig {
  const password = required(env, 'CODEX_REMOTE_PASSWORD')
  if (password.length < 16) throw new Error('CODEX_REMOTE_PASSWORD must contain at least 16 characters')

  const sessionSecret = required(env, 'CODEX_REMOTE_SESSION_SECRET')
  if (sessionSecret.length < 32) {
    throw new Error('CODEX_REMOTE_SESSION_SECRET must contain at least 32 characters')
  }

  const publicOrigin = new URL(required(env, 'CODEX_REMOTE_PUBLIC_ORIGIN'))
  if (!['http:', 'https:'].includes(publicOrigin.protocol)) {
    throw new Error('CODEX_REMOTE_PUBLIC_ORIGIN must use http or https')
  }
  if (publicOrigin.pathname !== '/' || publicOrigin.search || publicOrigin.hash) {
    throw new Error('CODEX_REMOTE_PUBLIC_ORIGIN must not contain a path, query, or fragment')
  }

  const contextVaultPath = env.CODEX_REMOTE_CONTEXT_VAULT?.trim() || resolve(homedir(), 'VAULTS', 'Codex-Context')
  if (!isAbsolute(contextVaultPath)) throw new Error('CODEX_REMOTE_CONTEXT_VAULT must be absolute')

  const secureApiRequired = env.CODEX_REMOTE_SECURE_API === 'required' || (env.NODE_ENV === 'production' && env.CODEX_REMOTE_SECURE_API !== 'off')
  const fileAccess = fileAccessMode({ fileAccess: env.CODEX_REMOTE_FILE_ACCESS as FileAccess | undefined, secureApiRequired })
  const fileRoots = parseWorkspaceRoots(env.CODEX_REMOTE_FILE_ROOTS?.trim() || required(env, 'CODEX_REMOTE_WORKSPACE_ROOTS'))
  if (fileAccess !== 'owner-full' && fileRoots.some(root => !validFileRoot(root))) throw Error('File roots must be explicit project/data directories, not home/filesystem/system roots')
  const trustedProxies = (env.CODEX_REMOTE_TRUSTED_PROXIES ?? '').split(',').map(value => value.trim()).filter(Boolean)
  if (trustedProxies.some(value => !isIP(value))) throw Error('Trusted proxies must be exact IP addresses')
  if (env.CODEX_REMOTE_SECURE_API && !['required', 'off'].includes(env.CODEX_REMOTE_SECURE_API)) throw Error('CODEX_REMOTE_SECURE_API must be required or off')
  const previewSharePorts = (env.CODEX_REMOTE_PREVIEW_SHARE_PORTS ?? '').split(',').map(value => value.trim()).filter(Boolean).map(value => {
    if (!/^[1-9][0-9]{3,4}$/.test(value) || Number(value) < 1024 || Number(value) > 65535) throw Error('Preview share ports must be exact ports between 1024 and 65535')
    return Number(value)
  })
  return {
    secureApiRequired,
    fileAccess,
    secureKeyFile: resolve(env.CODEX_REMOTE_SECURE_KEY_FILE?.trim() || resolve(homedir(), '.local/state/codex-remote/owner-key.json')),
    previewOriginTemplate: env.CODEX_REMOTE_PREVIEW_ORIGIN_TEMPLATE?.trim() ? validatePreviewOriginTemplate(env.CODEX_REMOTE_PREVIEW_ORIGIN_TEMPLATE.trim()) : undefined,
    previewSharePorts: [...new Set(previewSharePorts)],
    ...(env.CODEX_REMOTE_PREVIEW_SHARE_STATE?.trim() ? { previewShareStateFile: resolve(env.CODEX_REMOTE_PREVIEW_SHARE_STATE.trim()) } : {}),
    contextVaultPath: resolve(contextVaultPath),
    historyNativeHome: resolve(env.CODEX_HOME || resolve(homedir(), '.codex')),
    historyIndexPath: resolve(contextVaultPath, '..', 'history-index'),
    sessionStateFile: resolve(env.CODEX_REMOTE_SESSION_STATE?.trim() || resolve(homedir(), '.local/state/codex-remote/sessions.json')),
    trustedProxies,
    host: env.CODEX_REMOTE_HOST?.trim() || '127.0.0.1',
    port: parsePort(env.CODEX_REMOTE_PORT),
    publicOrigin,
    password,
    sessionSecret,
    sessionTtlSeconds: parseTtl(env.CODEX_REMOTE_SESSION_TTL_SECONDS),
    codexBin: env.CODEX_REMOTE_CODEX_BIN?.trim() || 'codex',
    workspaceRoots: parseWorkspaceRoots(required(env, 'CODEX_REMOTE_WORKSPACE_ROOTS')),
    fileRoots: fileAccess === 'owner-full' ? ['/'] : fileRoots,
    production: env.NODE_ENV === 'production',
  }
}
