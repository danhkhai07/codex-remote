import { expect, it } from 'vitest'
import { loadConfig } from './config.js'

const env = {
  CODEX_REMOTE_PASSWORD: 'correct horse battery staple',
  CODEX_REMOTE_SESSION_SECRET: 's'.repeat(48),
  CODEX_REMOTE_PUBLIC_ORIGIN: 'https://remote.example.test',
  CODEX_REMOTE_WORKSPACE_ROOTS: '/tmp',
}
it('defaults file access to workspaces and allows an independent filesystem root', () => {
  expect(loadConfig(env).fileRoots).toEqual(['/tmp'])
  const config = loadConfig({ ...env, CODEX_REMOTE_FILE_ROOTS: '/' })
  expect(config.fileRoots).toEqual(['/'])
  expect(config.workspaceRoots).toEqual(['/tmp'])
  expect(() => loadConfig({ ...env, CODEX_REMOTE_FILE_ROOTS: 'relative' })).toThrow('absolute')
})
