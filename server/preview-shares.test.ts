import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { PreviewShares, SHARE_COOKIE } from './preview-shares.js'
import { ServicesStore } from './services.js'
import { SessionRegistry } from './session-registry.js'

const cleanup: Array<() => void> = []
afterEach(() => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) close() })
const service = { port: 5180, name: 'Fixture', path: '/app', summary: 'fake service', prLabel: 'no PR' }
function fixture(persist = true) {
  const root = mkdtempSync(join(tmpdir(), 'preview-share-test-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  const servicesFile = join(root, 'services.json'), file = join(root, 'shares.json')
  const services = new ServicesStore(servicesFile, async () => true); services.upsert(service)
  const options = { services, file: persist ? file : undefined, ports: [5180, 5181, 5174], blockedPorts: [5174], secret: 'synthetic signing secret', originTemplate: 'https://p{port}.preview.test', publicOrigin: 'https://owner.test' }
  const shares = new PreviewShares(options); cleanup.push(() => shares.close())
  const create = (ttlSeconds = 3600) => shares.create({ port: 5180, ttlSeconds })
  const open = (link = create()) => { const ticket = shares.exchange(new URL(link.url!).hash.slice(1)); return shares.redeem(ticket.ticket, 5180).cookie.split(';')[0] }
  return { root, file, servicesFile, services, shares, create, open, options }
}
it('binds multi-use links and browser cookies across restart without storing raw capabilities', async () => {
  const f = fixture(), link = f.create(), cap = new URL(link.url!).hash.slice(1), cookie = f.open(link)
  expect(new URL(link.url!).search).toBe(''); expect(new URL(link.url!).pathname).toBe('/preview/share')
  expect(cap.length).toBe(80); expect(readFileSync(f.file, 'utf8')).not.toContain(cap)
  expect(statSync(f.file).mode & 0o777).toBe(0o600)
  const restarted = new PreviewShares({ ...f.options, services: new ServicesStore(f.servicesFile, async () => true) }); cleanup.push(() => restarted.close())
  expect((await restarted.list()).links[0].url).toBe(link.url)
  expect(restarted.access(cookie, 5180)?.valid()).toBe(true)
  expect(restarted.exchange(cap).ticket).not.toBe(restarted.exchange(cap).ticket)
  expect(restarted.access(cookie, 5181)).toBeNull()
  expect(restarted.access(cookie + '; ' + cookie, 5180)).toBeNull()
  expect(restarted.access(cookie + 'x', 5180)).toBeNull()
})
it('revokes independently on one port, closes listeners and survives restart; revoke retry is idempotent', async () => {
  const f = fixture(), one = f.create(), two = f.create(), a = f.open(one), b = f.open(two), close = vi.fn()
  f.shares.access(a, 5180)!.watch(close)
  const pending = f.shares.exchange(new URL(one.url!).hash.slice(1))
  f.shares.revoke(one.id); f.shares.revoke(one.id)
  expect(close).toHaveBeenCalledTimes(1)
  expect(f.shares.access(a, 5180)).toBeNull(); expect(f.shares.access(b, 5180)?.valid()).toBe(true)
  expect(() => f.shares.redeem(pending.ticket, 5180)).toThrow()
  expect(() => f.shares.exchange(new URL(one.url!).hash.slice(1))).toThrow()
  const restarted = new PreviewShares(f.options); cleanup.push(() => restarted.close())
  const listed = (await restarted.list()).links.find(x => x.id === one.id)!
  expect(listed.status).toBe('revoked'); expect(listed.url).toBeUndefined()
  expect(restarted.access(a, 5180)).toBeNull()
})
it('bounds expiry to 24h, closes active access on expiry and never renews from cookies', async () => {
  const f = fixture()
  for (const ttlSeconds of [0, -1, 86401, 1.5, '3600', null, Infinity]) expect(() => f.shares.create({ port: 5180, ttlSeconds })).toThrow()
  const full = f.create(86400); expect(Date.parse(full.expiresAt) - Date.parse(full.createdAt)).toBe(86400_000)
  const short = f.create(1), cookie = f.open(short), close = vi.fn()
  f.shares.access(cookie, 5180)!.watch(close)
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce(), { timeout: 1800, interval: 50 })
  expect(f.shares.access(cookie, 5180)).toBeNull()
  expect(() => f.shares.exchange(new URL(short.url!).hash.slice(1))).toThrow()
  expect((await f.shares.list()).links.find(l => l.id === short.id)?.status).toBe('expired')
})
it('service update/removal/recreate invalidates grants while exact no-op registration does not', async () => {
  const f = fixture(), link = f.create(), cookie = f.open(link), id = f.services.identity(5180), close = vi.fn()
  f.shares.access(cookie, 5180)!.watch(close)
  f.services.upsert(service); expect(f.services.identity(5180)).toBe(id); expect(close).not.toHaveBeenCalled()
  f.services.upsert({ ...service, directory: '/different' }); expect(close).toHaveBeenCalledOnce()
  expect((await f.shares.list()).links[0].status).toBe('unavailable')
  f.services.upsert(service); expect(f.shares.access(cookie, 5180)).toBeNull()
  const next = f.create(), nextCookie = f.open(next)
  f.services.remove('port:5180'); f.services.upsert(service)
  expect(f.shares.access(nextCookie, 5180)).toBeNull()
  expect(f.services.list()[0]).not.toHaveProperty('identity')
})
it('migrates legacy service generation once and rejects a corrupt generation', () => {
  const f = fixture(), saved = JSON.parse(readFileSync(f.servicesFile, 'utf8')); delete saved.services[0].identity
  writeFileSync(f.servicesFile, JSON.stringify(saved))
  const old = new ServicesStore(f.servicesFile), id = old.identity(5180)
  expect(new ServicesStore(f.servicesFile).identity(5180)).toBe(id)
  saved.services[0].identity = 'corrupt'; writeFileSync(f.servicesFile, JSON.stringify(saved))
  expect(() => new ServicesStore(f.servicesFile)).toThrow(/identity/)
})
it('requires registered allowlisted ports, HTTPS and safe navigation; never grants gateway/internal routes', async () => {
  const f = fixture()
  f.services.upsert({ ...service, port: null, path: '/files' })
  f.services.upsert({ ...service, port: 5174 }); f.services.upsert({ ...service, port: 5999 })
  for (const port of [null, '/files', 5174, 5999, 5181, 22, '5180']) expect(() => f.shares.create({ port, ttlSeconds: 60 })).toThrow()
  for (const path of ['//evil.test', '/\\evil.test', 'https://evil.test', '/x\n', '/x/../__codex_preview__/launch']) expect(() => f.shares.create({ port: 5180, ttlSeconds: 60, path })).toThrow()
  expect((await f.shares.list()).services.map(s => s.port)).toEqual([5180])
  for (const patch of [{ ports: [] }, { publicOrigin: 'http://owner.test' }, { originTemplate: 'http://p{port}.preview.test' }]) {
    const closed = new PreviewShares({ ...f.options, ...patch }); cleanup.push(() => closed.close())
    expect(() => closed.create({ port: 5180, ttlSeconds: 60 })).toThrow()
  }
})
it('does not bind intentional grants to owner session or emit owner credentials in either capability', () => {
  const f = fixture(), link = f.create(), cookie = f.open(link), sessions = new SessionRegistry(f.options.secret)
  const owner = { credentialVersion: sessions.credentialVersion, nonce: 'owner', expiresAt: Math.floor(Date.now() / 1000) + 600 }
  sessions.revoke(owner)
  expect(f.shares.access(cookie, 5180)?.valid()).toBe(true)
  expect(f.shares.exchange(new URL(link.url!).hash.slice(1)).ticket).toBeTruthy()
  expect(cookie).toMatch(new RegExp('^' + SHARE_COOKIE + '=')); expect(cookie).not.toContain('owner')
})
it('has one-use port-bound 60s handoffs; capabilities and cookies are not interchangeable', () => {
  const f = fixture(), link = f.create(), cap = new URL(link.url!).hash.slice(1), handoff = f.shares.exchange(cap)
  expect(() => f.shares.redeem(handoff.ticket, 5181)).toThrow()
  const cookie = f.shares.redeem(handoff.ticket, 5180).cookie.split(';')[0]
  expect(() => f.shares.redeem(handoff.ticket, 5180)).toThrow()
  expect(() => f.shares.exchange(cookie)).toThrow()
  expect(f.shares.access(SHARE_COOKIE + '=' + cap, 5180)).toBeNull()
  const pending = f.shares.exchange(cap), now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 60_001)
  expect(() => f.shares.redeem(pending.ticket, 5180)).toThrow()
})
it('bounds active grants/history/admission without evicting a valid grant', async () => {
  const f = fixture(false), first = f.create(), cookie = f.open(first)
  for (let i = 1; i < 128; i++) f.create()
  expect(() => f.create()).toThrow(/Too many active/); expect(f.shares.access(cookie, 5180)?.valid()).toBe(true)
  const cap = new URL(first.url!).hash.slice(1)
  for (let i = 0; i < 1024; i++) f.shares.exchange(cap)
  expect(() => f.shares.exchange(cap)).toThrow(/Too many pending/)
  const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 61_000)
  expect(f.shares.exchange(cap).ticket).toBeTruthy()
  vi.restoreAllMocks()
  for (let i = 0; i < 520; i++) { f.shares.revoke(first.id); const link = f.create(); f.shares.revoke(link.id) }
  expect((await f.shares.list()).links.length).toBeLessThanOrEqual(512)
})
it('fails closed on corrupt persisted state and persistence failure closes existing grants', () => {
  const f = fixture(), link = f.create(), cookie = f.open(link), close = vi.fn()
  f.shares.access(cookie, 5180)!.watch(close)
  writeFileSync(f.file, '{bad'); expect(() => new PreviewShares(f.options)).toThrow()
  // Make the owned parent unusable: no production paths involved.
  rmSync(f.root, { recursive: true }); writeFileSync(f.root, 'owned fixture obstruction')
  expect(() => f.shares.revoke(link.id)).toThrow()
  // mkdir can fail before the atomic writer; failure must never keep access alive.
  expect(f.shares.access(cookie, 5180)).toBeNull(); expect(close).toHaveBeenCalledOnce()
})
it('rechecks owner liveness and registry after asynchronous service probes', async () => {
  const f = fixture(); let finish!: (value: boolean) => void
  const services = new ServicesStore(undefined, () => new Promise(resolve => { finish = resolve })); services.upsert(service)
  const shares = new PreviewShares({ ...f.options, file: undefined, services }); cleanup.push(() => shares.close())
  let live = true
  const result = shares.list(() => { if (!live) throw Error('owner revoked') }); live = false; finish(true)
  await expect(result).rejects.toThrow('owner revoked')
  const changed = shares.list(); services.remove('port:5180'); finish(true)
  expect((await changed).services).toEqual([])
  vi.useFakeTimers({ toFake: ['Date'] }); cleanup.push(() => vi.useRealTimers())
  services.upsert(service)
  const link = shares.create({ port: 5180, ttlSeconds: 60 }), before = services.list()
  const replaced = shares.list(); services.remove('port:5180'); services.upsert(service)
  expect(services.list()).toEqual(before) // Identical public metadata and timestamp.
  finish(true)
  const resultAfterRecreate = await replaced
  expect(resultAfterRecreate.services).toEqual([])
  expect(resultAfterRecreate.links.find(item => item.id === link.id)?.status).toBe('unavailable')
})

it('fails sharing closed if a registry update cannot be persisted', () => {
  const f = fixture(), cookie = f.open(), close = vi.fn()
  f.shares.access(cookie, 5180)!.watch(close)
  rmSync(f.root, { recursive: true }); writeFileSync(f.root, 'owned fixture obstruction')
  expect(() => f.services.remove('port:5180')).toThrow()
  expect(f.shares.access(cookie, 5180)).toBeNull(); expect(close).toHaveBeenCalledOnce()
  expect(() => f.create()).toThrow(/registered/)
})

it('bounds active watched streams, releases slots and invalidates all grants on signing-secret change', () => {
  const f = fixture(false), link = f.create(), cookie = f.open(link), access = f.shares.access(cookie, 5180)!
  const off = Array.from({ length: 2048 }, () => access.watch(() => {}))
  expect(() => access.watch(() => {})).toThrow(/Too many active share connections/)
  off.pop()!(); expect(access.watch(() => {})).toBeTypeOf('function')
  const durable = fixture(), oldLink = durable.create(), oldCookie = durable.open(oldLink)
  const rotated = new PreviewShares({ ...durable.options, secret: 'different synthetic signing secret' }); cleanup.push(() => rotated.close())
  expect(rotated.access(oldCookie, 5180)).toBeNull()
  expect(() => rotated.exchange(new URL(oldLink.url!).hash.slice(1))).toThrow()
})
