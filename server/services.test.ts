import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { ServicesStore, isPortListening, validateService } from './services.js'

const input = { port: 5183, name: 'Kiotclone', summary: 'Mẫu in theo chi nhánh', prLabel: 'PR #125', prUrl: 'https://github.com/example/repo/pull/125', path: '/' }
describe('services registry', () => {
  it('persists app metadata and paths, replaces only the same key, and survives restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'services-test-'))
    try {
      const file = join(directory, 'services.json')
      const store = new ServicesStore(file, async port => port === 5183)
      store.upsert(input)
      store.upsert({ ...input, port: null, path: '/working-hours', name: 'Working hours' })
      store.upsert({ ...input, port: 5194, name: 'Prototype' })
      store.upsert({ ...input, summary: 'Updated review' })
      const restarted = new ServicesStore(file, async port => port === 5183)
      const snapshot = await restarted.snapshot()
      expect(snapshot.services).toHaveLength(3)
      expect(snapshot.services.find(service => service.port === 5183)).toMatchObject({ summary: 'Updated review', running: true, prLabel: 'PR #125' })
      expect(snapshot.services.find(service => service.port === 5194)?.running).toBe(false)
      expect(snapshot.services.find(service => service.port === null)?.running).toBeNull()
      restarted.remove('path:/working-hours')
      expect(new ServicesStore(file).list()).toHaveLength(2)
      expect(() => restarted.remove('path:/missing')).toThrow('Không tìm thấy')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it('rejects invalid ports, external paths, unsafe links and missing review context', () => {
    for (const patch of [{ port: 80 }, { port: '5183' }, { port: 65536 }, { path: '//evil.test' }, { path: '/\\evil.test' }, { prUrl: 'javascript:alert(1)' }, { prUrl: 'https://user:password@example.test' }, { prLabel: '' }, { summary: '' }, { kind: 'shell' }]) {
      expect(() => validateService({ ...input, ...patch })).toThrow()
    }
    expect(() => new ServicesStore(undefined, undefined, [5183]).upsert(input)).toThrow('Codex Remote')
  })
  it('checks actual loopback listeners without sending application data', async () => {
    const server = createServer(socket => socket.on('data', () => { throw Error('Probe sent data') }))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    expect(await isPortListening(port)).toBe(true)
    await new Promise<void>(resolve => server.close(() => resolve()))
    expect(await isPortListening(port)).toBe(false)
  })
})

it('preserves registration on metadata updates but compares explicit worktree moves and invalidates replacements', () => {
  const store = new ServicesStore(), first = store.upsert({ ...input, directory: '/work/one' })
  expect(first.registrationId).toBe(store.identity(input.port))
  store.upsert({ ...input, name: 'Omitted directory' }); expect(store.identity(input.port)).toBe(first.registrationId)
  expect(store.list()[0].directory).toBe('/work/one')
  store.upsert({ ...input, directory: '/work/one', name: 'Renamed', branch: 'new', path: '/next' })
  expect(store.identity(input.port)).toBe(first.registrationId)
  store.upsert({ ...input, directory: '/work/two', expectedIdentity: first.registrationId })
  expect(store.identity(input.port)).toBe(first.registrationId)
  store.upsert({ ...input, directory: '/different-service' })
  expect(store.identity(input.port)).not.toBe(first.registrationId)
  expect(() => store.upsert({ ...input, expectedIdentity: first.registrationId })).toThrow(/registration changed/)
  const second = store.identity(input.port)
  store.remove('port:' + input.port)
  expect(() => store.upsert({ ...input, expectedIdentity: second })).toThrow(/registration changed/)
  store.upsert(input); expect(store.identity(input.port)).not.toBe(second)
  for (const controls of [{ replace: 'true' }, { expectedIdentity: 'bad' }]) expect(() => store.upsert({ ...input, ...controls })).toThrow()
})
