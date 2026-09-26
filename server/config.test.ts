import { expect, it } from 'vitest'
import { loadConfig } from './config.js'

const env = {
  CODEX_REMOTE_PASSWORD: 'correct horse battery staple',
  CODEX_REMOTE_SESSION_SECRET: 's'.repeat(48),
  CODEX_REMOTE_PUBLIC_ORIGIN: 'https://remote.example.test',
  CODEX_REMOTE_WORKSPACE_ROOTS: '/tmp',
}
it('requires encrypted API in production and never silently ignores an invalid mode', () => {
  expect(loadConfig({ ...env, NODE_ENV: 'production' }).secureApiRequired).toBe(true)
  expect(loadConfig({ ...env, NODE_ENV: 'production', CODEX_REMOTE_SECURE_API: 'off' }).secureApiRequired).toBe(false)
  expect(loadConfig({ ...env, NODE_ENV: 'development', CODEX_REMOTE_SECURE_API: 'required' }).secureApiRequired).toBe(true)
  expect(() => loadConfig({ ...env, CODEX_REMOTE_SECURE_API: 'invalid' })).toThrow('required or off')
})
it('defaults file access to explicit workspaces and rejects unsafe root grants', () => {
  expect(loadConfig(env).fileRoots).toEqual(['/tmp'])
  for (const root of ['/', '/root', '/etc', '/proc', '/dev']) expect(() => loadConfig({ ...env, CODEX_REMOTE_FILE_ROOTS: root })).toThrow(/explicit project/)
  expect(() => loadConfig({ ...env, CODEX_REMOTE_FILE_ROOTS: 'relative' })).toThrow('absolute')
})

it('accepts a new absolute context vault path without requiring it to exist', () => {
  expect(loadConfig({ ...env, CODEX_REMOTE_CONTEXT_VAULT: '/tmp/new-context-vault' }).contextVaultPath).toBe('/tmp/new-context-vault')
  expect(() => loadConfig({ ...env, CODEX_REMOTE_CONTEXT_VAULT: 'relative' })).toThrow('must be absolute')
})

it('keeps previews disabled by default and accepts only origin templates with one hostname port placeholder', () => {
  expect(loadConfig(env).previewOriginTemplate).toBeUndefined()
  expect(loadConfig({ ...env, CODEX_REMOTE_PREVIEW_ORIGIN_TEMPLATE: 'https://p{port}.preview.example.test' }).previewOriginTemplate).toBe('https://p{port}.preview.example.test')
  for (const template of ['https://preview.example.test', 'https://preview.example.test/{port}', 'ftp://p{port}.preview.example.test', 'https://user:pass@p{port}.preview.example.test', 'https://p{port}.preview.example.test/path']) {
    expect(() => loadConfig({ ...env, CODEX_REMOTE_PREVIEW_ORIGIN_TEMPLATE: template })).toThrow()
  }
})

it('requires an explicit exact preview share port allowlist independently of the origin template', () => {
  expect(loadConfig(env).previewSharePorts).toEqual([])
  expect(loadConfig({ ...env, CODEX_REMOTE_PREVIEW_SHARE_PORTS: '5180, 5210,5180' }).previewSharePorts).toEqual([5180, 5210])
  for (const value of ['*', '5180-5200', '80', '1e4', '65536', 'abc', '05180']) {
    expect(() => loadConfig({ ...env, CODEX_REMOTE_PREVIEW_SHARE_PORTS: value })).toThrow(/exact ports/)
  }
  expect(loadConfig({ ...env, CODEX_REMOTE_PREVIEW_SHARE_STATE: '/tmp/owned-shares.json' }).previewShareStateFile).toBe('/tmp/owned-shares.json')
})
