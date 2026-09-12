import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distRoot = resolve(packageRoot, 'dist')

async function read(relativePath) {
  return readFile(resolve(distRoot, relativePath))
}

function pngSize(buffer) {
  assert.equal(buffer.toString('hex', 0, 8), '89504e470d0a1a0a', 'Expected a PNG file')
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

const manifest = JSON.parse(await read('manifest.webmanifest'))
assert.equal(manifest.id, '/')
assert.equal(manifest.start_url, '/')
assert.equal(manifest.scope, '/')
assert.equal(manifest.display, 'standalone')

const expectedIcons = new Map([
  ['/icon-192.png', { width: 192, height: 192, purpose: 'any' }],
  ['/icon-512.png', { width: 512, height: 512, purpose: 'any' }],
  ['/icon-maskable-512.png', { width: 512, height: 512, purpose: 'maskable' }],
])

for (const icon of manifest.icons ?? []) {
  const expected = expectedIcons.get(icon.src)
  if (!expected) continue
  assert.equal(icon.purpose, expected.purpose)
  assert.deepEqual(pngSize(await read(icon.src.slice(1))), {
    width: expected.width,
    height: expected.height,
  })
  expectedIcons.delete(icon.src)
}
assert.equal(expectedIcons.size, 0, `Missing required PWA icons: ${[...expectedIcons.keys()].join(', ')}`)

assert.deepEqual(pngSize(await read('apple-touch-icon.png')), { width: 180, height: 180 })

const html = (await read('index.html')).toString('utf8')
assert.match(html, /rel="manifest"/)
assert.match(html, /rel="apple-touch-icon"/)

const client = (await Promise.all(
  [...html.matchAll(/src="(\/assets\/[^"?#]+\.js)"/g)].map(match => read(match[1].slice(1))),
)).map(buffer => buffer.toString('utf8')).join('\n')
assert.match(client, /\/sw\.js\?v=/)
assert.match(client, /updateViaCache:\s*["'\x60]none["'\x60]/)

const worker = (await read('sw.js')).toString('utf8')
assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/)
assert.match(worker, /SKIP_WAITING/)
assert.match(worker, /notificationclick/)

console.log('PWA manifest, icons, metadata, and service worker are valid')
