import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

export type RemoteConfig = {
  host: string
  port: number
  publicOrigin: URL
  password: string
  sessionSecret: string
  sessionTtlSeconds: number
  codexBin: string
  workspaceRoots: string[]
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

  return {
    host: env.CODEX_REMOTE_HOST?.trim() || '127.0.0.1',
    port: parsePort(env.CODEX_REMOTE_PORT),
    publicOrigin,
    password,
    sessionSecret,
    sessionTtlSeconds: parseTtl(env.CODEX_REMOTE_SESSION_TTL_SECONDS),
    codexBin: env.CODEX_REMOTE_CODEX_BIN?.trim() || 'codex',
    workspaceRoots: parseWorkspaceRoots(required(env, 'CODEX_REMOTE_WORKSPACE_ROOTS')),
    production: env.NODE_ENV === 'production',
  }
}
