import { expect, it } from 'vitest'
import { loadConfig } from './config.js'

const env = {
  CODEX_REMOTE_PASSWORD: 'correct horse battery staple',
  CODEX_REMOTE_SESSION_SECRET: 's'.repeat(48),
  CODEX_REMOTE_PUBLIC_ORIGIN: 'https://remote.example.test',
  CODEX_REMOTE_WORKSPACE_ROOTS: '/tmp',
}
it('requires explicit file roots while preserving broad native workspace access and legacy login', () => {
  expect(loadConfig(env).fileRoots).toEqual(['/tmp'])
  const config = loadConfig({ ...env, CODEX_REMOTE_WORKSPACE_ROOTS: '/root', CODEX_REMOTE_FILE_ROOTS: '/tmp', NODE_ENV: 'production' })
  expect(config.fileRoots).toEqual(['/tmp'])
  expect(config.workspaceRoots).toEqual(['/root'])
  expect(config.password).toBe(env.CODEX_REMOTE_PASSWORD)
  expect(config.sessionSecret).toBe(env.CODEX_REMOTE_SESSION_SECRET)
  expect(config).not.toHaveProperty('secureApiRequired')
  for (const root of ['/', '/root', '/proc', '/etc']) expect(() => loadConfig({ ...env, CODEX_REMOTE_FILE_ROOTS: root })).toThrow('explicit project/data')
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
