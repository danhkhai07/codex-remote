import test from 'node:test'
import assert from 'node:assert/strict'
import { renderNginx, HOST, PORT } from './nginx.mjs'

for (const mode of ['bootstrap', 'parked', 'active']) test(`${mode} owns only the exact new hostname`, () => {
  const text = renderNginx(mode)
  assert.deepEqual([...text.matchAll(/server_name ([^;]+);/g)].map(m => m[1]), [HOST, HOST])
  assert.equal((text.match(/return 421;/g) || []).length, 2)
  assert.ok(!text.includes('server_name *.'))
  assert.ok(!text.includes('codex.danhkhai.io.vn'))
  assert.ok(!text.includes('p2345.'))
  assert.match(text, /location \^~ \/\.well-known\/acme-challenge\//)
})
test('bootstrap/parked cannot forward private traffic', () => {
  for (const mode of ['bootstrap', 'parked']) {
    const text = renderNginx(mode)
    assert.ok(!text.includes('proxy_pass'))
    assert.match(text, /Cache-Control "no-store" always/)
    assert.match(text, /return 503/)
  }
  assert.match(renderNginx('bootstrap'), /ssl_reject_handshake on/)
  assert.match(renderNginx('parked'), /live\/codex-remote-secure\/fullchain.pem/)
})
test('active route preserves the secure tunnel limit and stripped proxy inputs', () => {
  const text = renderNginx('active')
  assert.equal((text.match(new RegExp(`proxy_pass http://127.0.0.1:${PORT};`, 'g')) || []).length, 2)
  assert.match(text, /client_max_body_size 36m/)
  assert.match(text, /proxy_request_buffering off/)
  for (const name of ['X-Forwarded-For', 'Forwarded', 'CF-Connecting-IP']) assert.equal((text.match(new RegExp(`proxy_set_header ${name} "";`, 'g')) || []).length, 2)
  assert.match(text, /location = \/workboard \{ return 303 \/services; \}/)
  assert.match(text, /proxy_set_header Connection \$codex_remote_secure_connection/)
})
test('unknown modes fail closed', () => assert.throws(() => renderNginx('legacy')))
